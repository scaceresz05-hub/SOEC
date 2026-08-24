/**
 * CAMPAIGN OPERATOR (DRY-RUN) E2E: objetivo + presupuesto + período + evidencia real → plan + envelope DRAFT,
 * persistido, SIN gasto ni escritura. Caso SmileFlow ⇒ DIAGNOSIS_REQUIRED. SOEC_CAMPAIGN_OPERATOR_DRY_RUN.
 */
import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { ActorId, OrganizationId, type Attribution, type EventStore, type RequestContext } from '@soec/contracts';
import { adsSnapshotStreamId, EVENTO_ADS_SNAPSHOT } from '../src/ingesta/ingesta-google-ads-service';
import { ORG_SMILEFLOW as ORG_REAL } from '../src/plataforma';
import { CampaignOperatorDryRunService } from '../src/campana/campaign-operator-service';

const AHORA = '2026-08-23T12:00:00.000Z';
const ATR: Attribution = { source: 't', purpose: 't', assumptions: [], claimType: 'observational', regime: 'empirical', uncertainty: 'baja' };
function ctx(org: string): RequestContext {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('seed'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: 'c' };
}
async function seedSnapshot(store: EventStore): Promise<void> {
  const c = ctx(ORG_REAL);
  const ev = await store.readStream(c, adsSnapshotStreamId(ORG_REAL));
  await store.append(c, adsSnapshotStreamId(ORG_REAL), ev.length, [{
    type: EVENTO_ADS_SNAPSHOT,
    payload: { campaignId: '24120966895', campaignName: 'SmileFlow Search Chile', status: 'PAUSED', impressions: 1361, clicks: 50, cost: 30137, at: AHORA },
    attribution: ATR, occurredAt: AHORA,
  }]);
}
const ENTRADA = { objetivo: 'Conseguir clínicas interesadas en SmileFlow', presupuestoTotal: 30000, periodoDias: 10 };

describe('CampaignOperatorDryRunService.planificar (SmileFlow actual)', () => {
  it('produce MARKETING_PLAN=DIAGNOSIS_REQUIRED, spend 0, envelope DRAFT, sin gasto', async () => {
    const store = new InMemoryEventStore();
    await seedSnapshot(store);

    const svc = new CampaignOperatorDryRunService(store, undefined, { META_AVAILABLE: undefined } as NodeJS.ProcessEnv);
    const r = await svc.planificar(ORG_REAL, AHORA, ENTRADA);

    expect(r.modo).toBe('DRY_RUN');
    expect(r.autonomousReal).toBe(false);
    expect(r.plan.status).toBe('DIAGNOSIS_REQUIRED');
    expect(r.plan.totalSpendRecommended).toBe(0);
    expect(r.plan.spendRecommendation).toBe('0 CLP UNTIL DIAGNOSIS');
    expect(r.plan.auditFunnel).toBe('REQUIRED');
    // Envelope DRAFT, sin aprobar, y sin canales de gasto habilitados (nada real por autorizar aún).
    expect(r.envelopeDraft.status).toBe('DRAFT');
    expect(r.envelopeDraft.approvedBy).toBeNull();
    expect(r.envelopeDraft.allowedChannels).toEqual([]);
    expect(r.envelopeDraft.totalBudget).toBe(30000);
    // Invariante de soberanía: nunca excede el tope humano.
    expect(r.plan.recommendedChannelMix.reduce((a, m) => a + m.presupuesto, 0)).toBeLessThanOrEqual(30000);
  });

  it('persiste el plan (leerUltimo lo recupera)', async () => {
    const store = new InMemoryEventStore();
    await seedSnapshot(store);
    const svc = new CampaignOperatorDryRunService(store);
    await svc.planificar(ORG_REAL, AHORA, ENTRADA);

    const ultimo = await svc.leerUltimo(ORG_REAL);
    expect(ultimo?.plan.status).toBe('DIAGNOSIS_REQUIRED');
    expect(ultimo?.envelopeDraft.status).toBe('DRAFT');
  });

  it('Meta permanece DORMANT salvo gate externo (META_AVAILABLE)', async () => {
    const store = new InMemoryEventStore();
    await seedSnapshot(store);
    const svc = new CampaignOperatorDryRunService(store, undefined, {} as NodeJS.ProcessEnv);
    const r = await svc.planificar(ORG_REAL, AHORA, ENTRADA);
    expect(r.plan.channelAvailability.meta).toBe(false);
    expect(r.plan.channelAvailability.google).toBe(true);
  });
});
