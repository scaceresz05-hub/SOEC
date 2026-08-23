import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { makeTestPool, ejecutarDestructivoDePrueba } from '@soec/event-store/test-db';
import { runMigrations } from '@soec/event-store/pg';
import { budgetAuthorizationMigrations, PgBudgetAuthorizationRepo, type BudgetAuthorization } from '../src/autonomia-ads/budget-authorization-pg';

const pool = makeTestPool();
const repo = new PgBudgetAuthorizationRepo(pool);
const AHORA = '2026-08-19T12:00:00.000Z';

function auth(org: string, campaignId: string, monto: number): BudgetAuthorization {
  return { organizationId: org, provider: 'google-ads', campaignId, authorizedTotalAmount: monto, currency: 'CLP', periodStart: null, periodEnd: null, createdBy: 'user-owner', createdAt: AHORA, status: 'ACTIVE' };
}

beforeEach(async () => {
  await runMigrations(pool, budgetAuthorizationMigrations);
  await ejecutarDestructivoDePrueba(pool, 'truncate table google_ads_budget_authorization');
});
afterAll(async () => {
  await pool.end();
});

describe('autorización de presupuesto — tenant + campaña', () => {
  it('authorized_cap_is_tenant_and_campaign_scoped', async () => {
    await repo.guardar(auth('org-a', 'camp-1', 30000));
    expect((await repo.obtenerVigente('org-a', 'camp-1'))?.authorizedTotalAmount).toBe(30000);
    expect(await repo.obtenerVigente('org-b', 'camp-1')).toBeNull(); // otro tenant
    expect(await repo.obtenerVigente('org-a', 'camp-2')).toBeNull(); // otra campaña
  });

  it('no_historical_cap_is_invented: SmileFlow no tiene cap registrado (tabla vacía ⇒ null)', async () => {
    // No se inserta nada para org-smileflow: la verdad del incidente es HISTORICAL_AUTHORIZED_CAP = NONE.
    expect(await repo.obtenerVigente('org-smileflow', '24120966895')).toBeNull();
  });

  it('sólo devuelve autorizaciones ACTIVE (REVOKED no vigente)', async () => {
    await repo.guardar({ ...auth('org-a', 'camp-1', 30000), status: 'REVOKED' });
    expect(await repo.obtenerVigente('org-a', 'camp-1')).toBeNull();
  });
});
