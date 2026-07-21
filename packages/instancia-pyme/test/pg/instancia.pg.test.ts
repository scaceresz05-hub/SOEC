import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { makePool, runMigrations, PgEventStore, PgOutbox } from '@soec/event-store/pg';
import { migracionesHastaOperaciones } from '@soec/operaciones/pg';
import { capMigrations, PgCapExecProjectionStore, PgCapDefProjectionStore, drenarCapacidades } from '@soec/capacidades/pg';
import { IDS, ejecutarComprenderEstado, instanciarPyme } from '../../src';
import { cadena, ctxFor, seedOpts } from '../helpers';

const CONN = process.env.DATABASE_URL ?? 'postgres://soec:soec@localhost:5544/soec';
const pool = makePool(CONN);
const store = new PgEventStore(pool);
const e = cadena(store);

beforeAll(async () => {
  await runMigrations(pool, [...migracionesHastaOperaciones, ...capMigrations]);
});
afterAll(async () => {
  await pool.end();
});
beforeEach(async () => {
  await pool.query(
    'truncate table events, outbox, projection_checkpoints, proj_med_current, proj_mdm_current, proj_ece_current, proj_oi_current, proj_capdef_current, proj_capexec_current restart identity cascade',
  );
});

describe('Primer dominio real sobre PostgreSQL', () => {
  it('instancia la pyme, ejecuta la capacidad y persiste un producto compuesto', async () => {
    const ctx = ctxFor('pyme-a');
    await instanciarPyme(ctx, e, seedOpts);
    const r = await ejecutarComprenderEstado(ctx, e.orchestrator, 'ce-1', seedOpts);
    expect(r.producto.operacionesEjecutadas.map((p) => p.operacion)).toEqual(['detectar', 'esclarecer']);
    expect(r.producto.bindingDecision).toBe(false);

    const prod = await e.capQuery.producto(ctx, 'ce-1');
    expect(prod?.contradiccionesAbiertas.length).toBeGreaterThan(0);
    expect((await e.capQuery.ejecucion(ctx, 'ce-1')).estado).toBe('compuesta');
  });

  it('aísla por organización: otra pyme no ve la instanciación', async () => {
    await instanciarPyme(ctxFor('pyme-a'), e, seedOpts);
    expect((await e.eceQuery.estadoActual(ctxFor('pyme-b'), IDS.ece)).existe).toBe(false);
  });

  it('el worker proyecta la definición y la ejecución de la capacidad', async () => {
    const ctx = ctxFor('pyme-a');
    await instanciarPyme(ctx, e, seedOpts);
    await ejecutarComprenderEstado(ctx, e.orchestrator, 'ce-1', seedOpts);

    const outbox = new PgOutbox(pool);
    const stores = { def: new PgCapDefProjectionStore(pool), exec: new PgCapExecProjectionStore(pool) };
    const n = await drenarCapacidades(outbox, stores);
    expect(n).toBeGreaterThan(0);
    const proj = (await stores.exec.list('pyme-a')).find((s) => s.executionId === 'ce-1');
    expect(proj?.estado).toBe('compuesta');
    expect(proj).toEqual(await e.capQuery.ejecucion(ctx, 'ce-1'));
  });

  it('no requiere migraciones nuevas: el dominio es instanciación sobre el esquema existente', async () => {
    const applied = await runMigrations(pool, [...migracionesHastaOperaciones, ...capMigrations]);
    expect(applied).toEqual([]);
  });
});
