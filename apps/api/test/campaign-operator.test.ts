/**
 * CAMPAIGN OPERATOR (DRY-RUN) E2E — diagnóstico → plan → CAMPAÑA publicable. Con readiness completa (destinos
 * validados + capacidades reales) el draft queda READY_FOR_APPROVAL con la ejecución bloqueada por gate externo.
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

const AHORA = '2026-08-25T12:00:00.000Z';
const ATR: Attribution = { source: 't', purpose: 't', assumptions: [], claimType: 'observational', regime: 'empirical', uncertainty: 'baja' };
function ctx(org: string): RequestContext {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('seed'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: 'c' };
}
async function seedSnapshot(store: EventStore): Promise<void> {
  const c = ctx(ORG_REAL);
  const ev = await store.readStream(c, adsSnapshotStreamId(ORG_REAL));
  await store.append(c, adsSnapshotStreamId(ORG_REAL), ev.length, [{ type: EVENTO_ADS_SNAPSHOT, payload: { campaignId: '24120966895', campaignName: 'SmileFlow Search Chile', status: 'PAUSED', impressions: 1361, clicks: 50, cost: 30137, at: AHORA }, attribution: ATR, occurredAt: AHORA }]);
}
const term = (t: string, metrica: string, valor: number): EntradaObservacionReal => ({ provider: 'google-ads', externalEventId: `google-ads:searchterm:${t}:${metrica}`, eventName: 'ads_search_term', occurredAt: AHORA, kpiId: metrica, metrica, valor, unidad: 'conteo', calidad: 'alta', cobertura: 1, source: 'google-ads', utmContent: t, diagnostico: false });
async function seedTerminos(store: InMemoryEventStore, filas: { t: string; impr: number; clics: number }[]): Promise<void> {
  const svc = new ObservacionService(store, {} as never);
  for (const f of filas) {
    await svc.registrarReal(ctx(ORG_REAL), term(f.t, 'search_term_impressions', f.impr).externalEventId, term(f.t, 'search_term_impressions', f.impr), ATR, AHORA);
    await svc.registrarReal(ctx(ORG_REAL), term(f.t, 'search_term_clicks', f.clics).externalEventId, term(f.t, 'search_term_clicks', f.clics), ATR, AHORA);
  }
}
const READINESS_OK: MarketingReadiness = {
  landing: { status: 'PASS' }, firstPartyTracking: { status: 'PASS' }, googleAdsAttribution: { status: 'ACTIVE' },
  sitelinks: { status: 'PASS' }, mobile: { status: 'PASS' }, diagnosisCompletedAt: AHORA, evidenceSource: 'external-audit',
  findings: ['26% de clics fuera de intención principal', 'intención competidor presente'],
  validatedDestinations: [
    { url: 'https://smileflowclinic.cl/#plans-trial', intent: 'plans', validated: true, public: true, available: true },
    { url: 'https://smileflowclinic.cl/#features-how', intent: 'features', validated: true, public: true, available: true },
  ],
  valueProps: ['Agenda inteligente para tu clínica', 'Recordatorios automáticos 24h', 'Relleno automático de agenda', 'Prueba 15 días sin cotización'],
  brandName: 'SmileFlow',
};
const ENTRADA = { objetivo: 'Conseguir clínicas dentales interesadas en SmileFlow', presupuestoTotal: 30000, periodoDias: 10 };

async function escenario(readiness?: MarketingReadiness): Promise<InMemoryEventStore> {
  const store = new InMemoryEventStore();
  await seedSnapshot(store);
  await seedTerminos(store, [
    { t: 'administracion clinica dental', impr: 300, clics: 12 }, { t: 'software agenda dental', impr: 220, clics: 9 },
    { t: 'dentalink', impr: 250, clics: 10 }, { t: 'software dental', impr: 400, clics: 18 },
    { t: 'archform software', impr: 90, clics: 3 }, { t: 'exocad', impr: 50, clics: 1 },
  ]);
  if (readiness) await new DiagnosisEvidenceService(store).registrar(ORG_REAL, readiness, AHORA);
  return store;
}

describe('CampaignOperator · campaña publicable', () => {
  it('diagnosis_evidence_can_be_recorded (tenant-scoped)', async () => {
    const store = new InMemoryEventStore();
    const svc = new DiagnosisEvidenceService(store);
    await svc.registrar(ORG_REAL, READINESS_OK, AHORA);
    expect((await svc.leerUltima(ORG_REAL))?.landing.status).toBe('PASS');
    expect(await svc.leerUltima('org-otra')).toBeNull();
  });

  it('caso real: STRATEGY READY, CAMPAIGN READY_FOR_APPROVAL, EXECUTION EXTERNAL_GATE_BLOCKED', async () => {
    const store = await escenario(READINESS_OK);
    const r = await new CampaignOperatorDryRunService(store, undefined, {} as NodeJS.ProcessEnv).planificar(ORG_REAL, AHORA, ENTRADA);
    expect(r.autonomousReal).toBe(false);
    expect(r.plan.strategyStatus).toBe('READY');
    expect(r.plan.campaignDraftStatus).toBe('READY_FOR_APPROVAL');
    expect(r.plan.executionStatus).toBe('EXTERNAL_GATE_BLOCKED');
    // sin placeholders ni destino pendiente, sin UNKNOWN activo
    expect(r.plan.campaignCompleteness.pendingCopyCount).toBe(0);
    expect(r.plan.campaignCompleteness.pendingDestination).toBe(false);
    expect(r.plan.campaignCompleteness.unknownActiveKeywords).toBe(0);
    // tech clínico excluido, competidor en grupo EXACT
    expect(r.plan.campaigns[0]!.negativeKeywords.some((n) => n.text === 'exocad')).toBe(true);
    expect(r.plan.campaigns[0]!.adGroups.find((g) => g.action === 'SEGMENT')!.keywords.every((k) => k.matchType === 'EXACT')).toBe(true);
    // presupuesto/guardrails
    expect(r.plan.recommendedChannelMix.find((m) => m.canal === 'google')!.presupuesto).toBeLessThanOrEqual(15000);
    expect(r.plan.recommendedChannelMix.find((m) => m.canal === 'meta')!.presupuesto).toBe(0);
    expect(r.plan.maxSpendWithoutContact.value).toBeLessThanOrEqual(7500);
    // envelope
    expect(r.envelopeDraft.status).toBe('DRAFT');
    expect(r.envelopeDraft.executionEligibleChannels).toEqual([]);
  });

  it('sin copy/destino en readiness ⇒ estrategia lista pero campaña INCOMPLETE', async () => {
    const store = await escenario({ ...READINESS_OK, valueProps: [], validatedDestinations: [] });
    const r = await new CampaignOperatorDryRunService(store, undefined, {} as NodeJS.ProcessEnv).planificar(ORG_REAL, AHORA, ENTRADA);
    expect(r.plan.strategyStatus).toBe('READY');
    expect(r.plan.campaignDraftStatus).toBe('INCOMPLETE');
  });

  it('sin readiness ⇒ diagnóstico requerido', async () => {
    const store = await escenario();
    const r = await new CampaignOperatorDryRunService(store, undefined, {} as NodeJS.ProcessEnv).planificar(ORG_REAL, AHORA, ENTRADA);
    expect(r.plan.strategyStatus).toBe('DIAGNOSIS_REQUIRED');
    expect(r.plan.campaigns).toEqual([]);
  });
});
