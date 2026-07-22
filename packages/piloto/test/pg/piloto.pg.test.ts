import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { makePool, runMigrations, PgEventStore, PgOutbox } from '@soec/event-store/pg';
import { migracionesHastaCapacidades } from '@soec/capacidades/pg';
import { operacionalMigrations } from '@soec/operacional/pg';
import { marketingMigrations } from '@soec/marketing/pg';
import { contenidoMigrations } from '@soec/contenido/pg';
import { canalesMigrations } from '@soec/canales/pg';
import { medicionMigrations } from '@soec/medicion/pg';
import { controlMigrations } from '@soec/control/pg';
import { reconstruirOrg, orgStreamId } from '../../src';
import { pilotoMigrations, PgEnsProjectionStore, PgExpProjectionStore, PgOrgProjectionStore, drenarPiloto, reconstruirProyeccionesPiloto } from '../../src/pg';
import { attr, ctxFor, now, sembrarOrg } from '../helpers';
import { montar } from '../helpers';

const CADENA = [...migracionesHastaCapacidades, ...operacionalMigrations, ...marketingMigrations, ...contenidoMigrations, ...canalesMigrations, ...medicionMigrations, ...controlMigrations, ...pilotoMigrations];
const CONN = process.env.DATABASE_URL ?? 'postgres://soec:soec@localhost:5544/soec';
const pool = makePool(CONN);
const store = new PgEventStore(pool);

beforeAll(async () => {
  await runMigrations(pool, CADENA);
});
afterAll(async () => {
  await pool.end();
});
beforeEach(async () => {
  await pool.query(`truncate table events, outbox, projection_checkpoints, proj_org_current, proj_expediente_current, proj_ensayo_current restart identity cascade`);
});

describe('Preparación de piloto sobre PostgreSQL real', () => {
  it('persiste organización + expediente; proyecta y reconstruye idéntico', async () => {
    const m = montar(store);
    const ctx = await sembrarOrg(m, 'org-1');
    await m.exp.crear(ctx, 'exp-1', { orgRef: 'org-1', departamento: 'marketing', entorno: 'sandbox', objetivo: 'o', duracionDias: 14, criteriosExito: [], criteriosSuspension: [], rollback: [] }, attr, now);
    await m.ens.registrar(ctx, 'ens-1', { orgRef: 'org-1', escenario: 'exitoso', pasos: [], incidencias: [], rollbackVerificado: true, resultado: 'apto_para_activacion' }, attr, now);

    const outbox = new PgOutbox(pool);
    const stores = { organizacion: new PgOrgProjectionStore(pool), expediente: new PgExpProjectionStore(pool), ensayo: new PgEnsProjectionStore(pool) };
    const n = await drenarPiloto(outbox, stores);
    expect(n).toBeGreaterThan(0);
    expect((await stores.organizacion.list('orgA')).length).toBe(1);
    expect((await stores.expediente.list('orgA')).length).toBe(1);

    const antes = await stores.organizacion.list('orgA');
    await reconstruirProyeccionesPiloto(pool);
    expect(await stores.organizacion.list('orgA')).toEqual(antes);
  });

  it('la activación real queda bloqueada y persistida; aislamiento y migración idempotente', async () => {
    const m = montar(store);
    const ctx = await sembrarOrg(m, 'org-1');
    await m.exp.crear(ctx, 'exp-1', { orgRef: 'org-1', departamento: 'marketing', entorno: 'real_preparado', objetivo: 'o', duracionDias: 14, criteriosExito: [], criteriosSuspension: [], rollback: [] }, attr, now);
    const r = await m.exp.intentarActivacion(ctx, 'exp-1', 'real_preparado', attr, now);
    expect(r.permitida).toBe(false);
    expect((await m.exp.cargar(ctx, 'exp-1')).estado).not.toBe('autorizado');
    // Aislamiento.
    const otra = reconstruirOrg('org-1', 'orgB', await store.readStream(ctxFor('orgB'), orgStreamId('org-1')));
    expect(otra.existe).toBe(false);
    expect(await runMigrations(pool, CADENA)).toEqual([]);
  });
});
