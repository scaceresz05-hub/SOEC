import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ConcurrencyError } from '@soec/contracts';
import { makePool, runMigrations, PgEventStore, PgOutbox } from '@soec/event-store/pg';
import { migracionesHastaCapacidades } from '@soec/capacidades/pg';
import { accStreamId } from '../../src/domain/action';
import {
  operacionalMigrations,
  PgPolicyProjectionStore,
  PgAccionProjectionStore,
  drenarOperacional,
  reconstruirProyeccionesOperacional,
} from '../../src/pg';
import { OperationalService, PolicyService, AdaptadorSimulado } from '../../src';
import { accionOk, attr, ctxFor, now, politicaBase } from '../helpers';

const CONN = process.env.DATABASE_URL ?? 'postgres://soec:soec@localhost:5544/soec';
const pool = makePool(CONN);
const store = new PgEventStore(pool);
const policies = new PolicyService(store);
const op = new OperationalService(store, [new AdaptadorSimulado()]);
const cmd = (over: object) => ({ attribution: attr, occurredAt: now, ...over });

beforeAll(async () => {
  await runMigrations(pool, [...migracionesHastaCapacidades, ...operacionalMigrations]);
});
afterAll(async () => {
  await pool.end();
});
beforeEach(async () => {
  await pool.query(
    'truncate table events, outbox, projection_checkpoints, proj_med_current, proj_mdm_current, proj_ece_current, proj_oi_current, proj_capdef_current, proj_capexec_current, proj_policy_current, proj_accion_current restart identity cascade',
  );
});

async function politicaVigente(ctx = ctxFor('orgA'), policyId = 'pol-1', contenido = politicaBase) {
  const r = await policies.registrarVersion(ctx, policyId, contenido, attr, now);
  await policies.publicar(ctx, policyId, r.version, attr, now);
  return policyId;
}

describe('Plano operativo sobre PostgreSQL real', () => {
  it('ejecuta y persiste una acción autorizada (efecto simulado)', async () => {
    const ctx = ctxFor('orgA');
    await politicaVigente(ctx);
    const r = await op.ejecutar(ctx, cmd({ executionId: 'a1', policyId: 'pol-1', accion: accionOk }) as never);
    expect(r.state.estado).toBe('verificada');
    expect(r.state.efecto?.simulado).toBe(true);
    const relee = await op.accion(ctx, 'a1');
    expect(relee.verificado).toBe(true);
    expect(relee.policyVersion).toBe(1);
  });

  it('deniega sin efecto y lo persiste', async () => {
    const ctx = ctxFor('orgA');
    await politicaVigente(ctx);
    const r = await op.ejecutar(ctx, cmd({ executionId: 'a1', policyId: 'pol-1', accion: { ...accionOk, tipo: 'enviar_masivo' } }) as never);
    expect(r.state.estado).toBe('denegada');
    expect(r.state.efecto).toBeNull();
  });

  it('concurrencia optimista sobre el stream de la acción', async () => {
    const ctx = ctxFor('orgA');
    await politicaVigente(ctx);
    await op.ejecutar(ctx, cmd({ executionId: 'a1', policyId: 'pol-1', accion: accionOk }) as never);
    await expect(
      store.append(ctx, accStreamId('a1'), 0, [{ type: 'acc.solicitada', payload: {}, attribution: attr, occurredAt: now }]),
    ).rejects.toBeInstanceOf(ConcurrencyError);
  });

  it('idempotencia por identidad de ejecución', async () => {
    const ctx = ctxFor('orgA');
    await politicaVigente(ctx);
    const r1 = await op.ejecutar(ctx, cmd({ executionId: 'a1', policyId: 'pol-1', accion: accionOk, idempotencyKey: 'k1' }) as never);
    const r2 = await op.ejecutar(ctx, cmd({ executionId: 'a1', policyId: 'pol-1', accion: accionOk, idempotencyKey: 'k1' }) as never);
    expect(r2.state.version).toBe(r1.state.version);
  });

  it('aislamiento organizacional', async () => {
    await politicaVigente(ctxFor('orgA'));
    await op.ejecutar(ctxFor('orgA'), cmd({ executionId: 'a1', policyId: 'pol-1', accion: accionOk }) as never);
    expect((await op.accion(ctxFor('orgB'), 'a1')).existe).toBe(false);
  });

  it('worker: proyecta políticas y acciones; reconstruye desde cero idéntico', async () => {
    const ctx = ctxFor('orgA');
    await politicaVigente(ctx);
    await op.ejecutar(ctx, cmd({ executionId: 'a1', policyId: 'pol-1', accion: accionOk }) as never);

    const outbox = new PgOutbox(pool);
    const stores = { policy: new PgPolicyProjectionStore(pool), accion: new PgAccionProjectionStore(pool) };
    const n = await drenarOperacional(outbox, stores);
    expect(n).toBeGreaterThan(0);
    expect(await drenarOperacional(outbox, stores)).toBe(0);

    expect((await stores.accion.list('orgA'))[0]?.estado).toBe('verificada');
    const antesPol = await stores.policy.list('orgA');
    await reconstruirProyeccionesOperacional(pool);
    expect(await stores.policy.list('orgA')).toEqual(antesPol);
  });

  it('la migración desde base vacía es idempotente', async () => {
    const applied = await runMigrations(pool, [...migracionesHastaCapacidades, ...operacionalMigrations]);
    expect(applied).toEqual([]);
  });
});
