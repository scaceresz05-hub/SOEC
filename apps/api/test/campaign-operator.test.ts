/**
 * CAMPAIGN OPERATOR (DRY-RUN) E2E — transición diagnóstico → plan operable. Registrada la READINESS por la
 * vía soportada, el planner deja de exigir diagnóstico y genera un experimento aprobable con la ejecución
 * bloqueada por el gate externo de Google. Nada se ejecuta ni se gasta.
 */
import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { ActorId, OrganizationId, type Attribution, type EventStore, type RequestContext } from '@soec/contracts';
import { ObservacionService, type EntradaObservacionReal } from '@soec/motor-medicion';
import { adsSnapshotStreamId, EVENTO_ADS_SNAPSHOT } from '../src/ingesta/ingesta-google-ads-service';
import { ORG_SMILEFLOW as ORG_REAL } from '../src/plataforma';
import { CampaignOperatorDryRunService } from '../src/campana/campaign-operator-service';
import { DiagnosisEvidenceService } from '../src/campana/diagnosis-evidence-service';
import type { MarketingReadiness } from '../src/campana/diagnosis-evidence';

const AHORA = '2026-08-24T12:00:00.000Z';
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
const term = (t: string, metrica: string, valor: number): EntradaObservacionReal => ({
  provider: 'google-ads', externalEventId: `google-ads:searchterm:${t}:${metrica}`, eventName: 'ads_search_term',
  occurredAt: AHORA, kpiId: metrica, metrica, valor, unidad: 'conteo', calidad: 'alta', cobertura: 1,
  source: 'google-ads', utmContent: t, diagnostico: false,
});
async function seedTerminos(store: InMemoryEventStore, filas: { t: string; impr: number; clics: number }[]): Promise<void> {
  const svc = new ObservacionService(store, {} as never);
  for (const f of filas) {
    await svc.registrarReal(ctx(ORG_REAL), term(f.t, 'search_term_impressions', f.impr).externalEventId, term(f.t, 'search_term_impressions', f.impr), ATR, AHORA);
    await svc.registrarReal(ctx(ORG_REAL), term(f.t, 'search_term_clicks', f.clics).externalEventId, term(f.t, 'search_term_clicks', f.clics), ATR, AHORA);
  }
}
const READINESS_OK: MarketingReadiness = {
  landing: { status: 'PASS' }, firstPartyTracking: { status: 'PASS' }, googleAdsAttribution: { status: 'ACTIVE' },
  sitelinks: { status: 'PASS' }, mobile: { status: 'PASS' },
  diagnosisCompletedAt: AHORA, evidenceSource: 'external-audit',
  findings: ['26% de clics fuera de intención principal', 'intención competidor presente', '0 contactos first-party'],
};
const ENTRADA = { objetivo: 'Conseguir clínicas dentales interesadas en SmileFlow', presupuestoTotal: 30000, periodoDias: 10, landingUrl: 'https://smileflow/#plans-trial' };

async function escenarioResuelto(): Promise<InMemoryEventStore> {
  const store = new InMemoryEventStore();
  await seedSnapshot(store);
  await seedTerminos(store, [
    { t: 'software dental', impr: 400, clics: 18 }, { t: 'administracion clinica dental', impr: 300, clics: 12 },
    { t: 'dentalink', impr: 250, clics: 10 }, { t: 'exocad', impr: 180, clics: 4 }, { t: 'cariogram', impr: 111, clics: 2 },
  ]);
  await new DiagnosisEvidenceService(store).registrar(ORG_REAL, READINESS_OK, AHORA);
  return store;
}

describe('CampaignOperator · diagnóstico registrado ⇒ plan operable (env sin overrides ⇒ gate por defecto)', () => {
  it('diagnosis_evidence_can_be_recorded (persistencia auditable, tenant-scoped)', async () => {
    const store = new InMemoryEventStore();
    const svc = new DiagnosisEvidenceService(store);
    await svc.registrar(ORG_REAL, READINESS_OK, AHORA);
    const leido = await svc.leerUltima(ORG_REAL);
    expect(leido?.diagnosisCompletedAt).toBe(AHORA);
    expect(leido?.landing.status).toBe('PASS');
    expect(await svc.leerUltima('org-otra')).toBeNull(); // aislamiento de tenant
  });

  it('caso real: PLAN=READY_FOR_APPROVAL, EXECUTION=EXTERNAL_GATE_BLOCKED, draft con keywords/negativas', async () => {
    const store = await escenarioResuelto();
    const svc = new CampaignOperatorDryRunService(store, undefined, {} as NodeJS.ProcessEnv);
    const r = await svc.planificar(ORG_REAL, AHORA, ENTRADA);

    expect(r.autonomousReal).toBe(false);
    expect(r.plan.planStatus).toBe('READY_FOR_APPROVAL');
    expect(r.plan.executionStatus).toBe('EXTERNAL_GATE_BLOCKED');
    expect(r.plan.channelExecutionAvailability.find((c) => c.canal === 'google')!.executionGate).toBe('ADVERTISER_VERIFICATION_PENDING');
    expect(r.plan.selectedHypothesis).not.toBeNull();
    expect(r.plan.campaigns.length).toBeGreaterThanOrEqual(1);
    const kw = r.plan.campaigns[0]!.adGroups.reduce((a, g) => a + g.keywords.length, 0);
    expect(kw).toBeGreaterThan(0);
    expect(r.plan.campaigns[0]!.negativeKeywords.length).toBeGreaterThan(0);
    // allocation
    expect(r.plan.recommendedChannelMix.find((m) => m.canal === 'google')!.presupuesto).toBeGreaterThan(0);
    expect(r.plan.recommendedChannelMix.find((m) => m.canal === 'meta')!.presupuesto).toBe(0);
    expect(r.plan.recommendedChannelMix.reduce((a, m) => a + m.presupuesto, 0)).toBeLessThanOrEqual(30000);
    // guardrails
    expect(r.plan.maxSpendWithoutContact.value).toBeGreaterThan(0);
    expect(r.plan.targetCpa.kind).toBe('UNDEFINED_INSUFFICIENT_EVIDENCE');
    // envelope
    expect(r.envelopeDraft.status).toBe('DRAFT');
    expect(r.envelopeDraft.executionEligibleChannels).toEqual([]);
    expect(r.envelopeDraft.allowedChannelsPlanned).toContain('google');
  });

  it('sin readiness ⇒ el operador aún exige diagnóstico', async () => {
    const store = new InMemoryEventStore();
    await seedSnapshot(store);
    const r = await new CampaignOperatorDryRunService(store, undefined, {} as NodeJS.ProcessEnv).planificar(ORG_REAL, AHORA, ENTRADA);
    expect(r.plan.planStatus).toBe('DIAGNOSIS_REQUIRED');
    expect(r.plan.campaigns).toEqual([]);
  });
});
