/**
 * V2 PRE-REAL · RECONCILIATION PG — reserva atómica idempotente y no-duplicación bajo concurrencia.
 * La segunda reserva con la misma (org, key) NO crea; el adapter real usa esto para no duplicar campaña/ad.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { makeTestPool, ejecutarDestructivoDePrueba } from '@soec/event-store/test-db';
import { runMigrations } from '@soec/event-store/pg';
import { metaWriteMigrations, PgReconciliacionRepo } from '../src/campana/meta-write-pg';

const pool = makeTestPool();
const repo = new PgReconciliacionRepo(pool);

beforeEach(async () => {
  await runMigrations(pool, metaWriteMigrations);
  await ejecutarDestructivoDePrueba(pool, 'truncate table meta_write_reconciliation');
});
afterAll(async () => { await pool.end(); });

describe('reconciliation PG', () => {
  it('reservar es atómico: primera crea PENDING, segunda no crea y devuelve el previo', async () => {
    const r1 = await repo.reservar('org-a', 'k1', 'CREATE_CAMPAIGN');
    expect(r1.creado).toBe(true);
    const r2 = await repo.reservar('org-a', 'k1', 'CREATE_CAMPAIGN');
    expect(r2.creado).toBe(false);
    expect(r2.previo!.estado).toBe('PENDING');
  });

  it('completar persiste externalRef reconciliable; reusable en retry', async () => {
    await repo.reservar('org-a', 'k2', 'CREATE_AD');
    await repo.completar('org-a', 'k2', 'ad_999');
    const x = await repo.obtener('org-a', 'k2');
    expect(x!.estado).toBe('COMPLETED');
    expect(x!.externalRef).toBe('ad_999');
  });

  it('reservas concurrentes con la misma key: exactamente una crea', async () => {
    const res = await Promise.all(Array.from({ length: 8 }, () => repo.reservar('org-a', 'race', 'CREATE_CAMPAIGN')));
    expect(res.filter((r) => r.creado).length).toBe(1); // sólo una gana
  });

  it('aislamiento por tenant: misma key en otra org es independiente', async () => {
    await repo.reservar('org-a', 'k3', 'CREATE_AD');
    const otra = await repo.reservar('org-b', 'k3', 'CREATE_AD');
    expect(otra.creado).toBe(true);
  });
});
