import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ConcurrencyError } from '@soec/contracts';
import { runMigrations, PgEventStore, PgOutbox } from '@soec/event-store/pg';
import { MedService, MdmService } from '@soec/models';
import { EceBuildService, EceQueryService } from '@soec/ece';
import {
  MecanismoDeterministico,
  MecanismoSimuladoIA,
  OperacionesService,
} from '@soec/operaciones';
import { migracionesHastaOperaciones } from '@soec/operaciones/pg';
import { CapabilitiesOrchestrator, CapabilityQueryService, CapabilityRegistry } from '../../src';
import { capexecStreamId } from '../../src/domain/aggregate-execution';
import {
  capMigrations,
  PgCapDefProjectionStore,
  PgCapExecProjectionStore,
  drenarCapacidades,
  reconstruirProyeccionesCap,
} from '../../src/pg';
import { attr, cmdBase, ctxFor, defDetectarOrientar, defEsclarecerSimple } from '../helpers';
import { makeTestPool, ejecutarDestructivoDePrueba } from '@soec/event-store/test-db';

const pool = makeTestPool();
const store = new PgEventStore(pool);
const med = new MedService(store);
const mdm = new MdmService(store);
const eceBuild = new EceBuildService(store, med, mdm);
const eceQuery = new EceQueryService(store, med, mdm);
const operaciones = new OperacionesService(store, eceQuery, [
  new MecanismoDeterministico(),
  new MecanismoSimuladoIA(),
]);
const registry = new CapabilityRegistry(store);
const orchestrator = new CapabilitiesOrchestrator(store, registry, operaciones);
const query = new CapabilityQueryService(store);
const ambito = { proposito: 'p', representa: 'r', excluye: 'x', supuestos: [] };
const vigencia = { desde: '2026-01-01T00:00:00.000Z', hasta: null };

beforeAll(async () => {
  await runMigrations(pool, [...migracionesHastaOperaciones, ...capMigrations]);
});
afterAll(async () => {
  await pool.end();
});
beforeEach(async () => {
  await ejecutarDestructivoDePrueba(
    pool,
    'truncate table events, outbox, projection_checkpoints, proj_med_current, proj_mdm_current, proj_ece_current, proj_oi_current, proj_capdef_current, proj_capexec_current restart identity cascade',
  );
});

async function ece(ctx = ctxFor('orgA')) {
  await med.crear(ctx, { instanceId: 'm1', ambito, vigencia, ...cmdBase });
  await med.emitirAfirmacion(ctx, {
    instanceId: 'm1',
    afirmacionId: 'a1',
    enunciado: 'x',
    dimension: 'hace',
    incertidumbre: 'media',
    ...cmdBase,
  });
  await med.incorporarEvidencia(ctx, {
    instanceId: 'm1',
    evidenciaId: 's',
    afirmacionId: 'a1',
    relacion: 'sostiene',
    procedencia: 'A',
    contenido: 'c',
    ...cmdBase,
  });
  await med.incorporarEvidencia(ctx, {
    instanceId: 'm1',
    evidenciaId: 'n',
    afirmacionId: 'a1',
    relacion: 'debilita',
    procedencia: 'B',
    contenido: 'c',
    ...cmdBase,
  });
  await mdm.crear(ctx, { instanceId: 'w1', ambito, vigencia, ...cmdBase });
  await eceBuild.construir(ctx, {
    eceId: 'ece1',
    medInstanceId: 'm1',
    mdmInstanceId: 'w1',
    ...cmdBase,
  });
  return ctx;
}
async function prep(ctx: ReturnType<typeof ctxFor>, capId = 'cap') {
  await registry.registrarVersion(ctx, capId, defDetectarOrientar());
  await registry.publicar(ctx, capId, 1);
}
const req = (extra: object) => ({ capabilityId: 'cap', eceId: 'ece1', ...cmdBase, ...extra });

describe('Capacidades sobre PostgreSQL real', () => {
  it('compone operaciones, persiste y relee el producto compuesto', async () => {
    const ctx = await ece();
    await prep(ctx);
    const r = await orchestrator.ejecutar(ctx, 'x1', req({}));
    expect(r.producto.operacionesEjecutadas).toHaveLength(2);
    const prod = await query.producto(ctx, 'x1');
    expect(prod?.operacionesEjecutadas.map((p) => p.operacion)).toEqual(['detectar', 'orientar']);
    expect((await query.ejecucion(ctx, 'x1')).estado).toBe('compuesta');
  });

  it('concurrencia optimista sobre el stream de ejecución', async () => {
    const ctx = await ece();
    await prep(ctx);
    await orchestrator.ejecutar(ctx, 'x1', req({}));
    await expect(
      store.append(ctx, capexecStreamId('x1'), 0, [
        {
          type: 'capexec.solicitada',
          payload: {},
          attribution: attr,
          occurredAt: cmdBase.occurredAt,
        },
      ]),
    ).rejects.toBeInstanceOf(ConcurrencyError);
  });

  it('idempotencia por identidad de ejecución', async () => {
    const ctx = await ece();
    await prep(ctx);
    const r1 = await orchestrator.ejecutar(ctx, 'x1', req({ idempotencyKey: 'k1' }));
    const r2 = await orchestrator.ejecutar(ctx, 'x1', req({ idempotencyKey: 'k1' }));
    expect(r2.state.version).toBe(r1.state.version);
  });

  it('aislamiento organizacional', async () => {
    const ctx = await ece(ctxFor('orgA'));
    await prep(ctx);
    await orchestrator.ejecutar(ctx, 'x1', req({}));
    expect((await query.ejecucion(ctxFor('orgB'), 'x1')).existe).toBe(false);
  });

  it('versionado: la ejecución antigua no se recalcula al publicar una nueva versión', async () => {
    const ctx = await ece();
    await registry.registrarVersion(ctx, 'cap', defEsclarecerSimple());
    await registry.publicar(ctx, 'cap', 1);
    await orchestrator.ejecutar(
      ctx,
      'x1',
      req({ objetivos: { e1: 'der:contradiccion:MED:m1:a1' } }),
    );
    await registry.registrarVersion(ctx, 'cap', defDetectarOrientar());
    await registry.publicar(ctx, 'cap', 2);
    const x1 = await query.producto(ctx, 'x1');
    expect(x1?.version).toBe(1);
    expect(x1?.operacionesEjecutadas.map((p) => p.operacion)).toEqual(['esclarecer']);
  });

  it('worker: proyecta definiciones y ejecuciones; reconstruye desde cero idéntico', async () => {
    const ctx = await ece();
    await prep(ctx);
    await orchestrator.ejecutar(ctx, 'x1', req({}));

    const outbox = new PgOutbox(pool);
    const stores = {
      def: new PgCapDefProjectionStore(pool),
      exec: new PgCapExecProjectionStore(pool),
    };
    const n = await drenarCapacidades(outbox, stores);
    expect(n).toBeGreaterThan(0);
    expect(await drenarCapacidades(outbox, stores)).toBe(0);

    expect((await stores.exec.list('orgA'))[0]).toEqual(await query.ejecucion(ctx, 'x1'));
    const antesDef = await stores.def.list('orgA');
    await reconstruirProyeccionesCap(pool);
    expect(await stores.def.list('orgA')).toEqual(antesDef);
  });

  it('la migración desde base vacía es idempotente', async () => {
    const applied = await runMigrations(pool, [...migracionesHastaOperaciones, ...capMigrations]);
    expect(applied).toEqual([]);
  });
});
