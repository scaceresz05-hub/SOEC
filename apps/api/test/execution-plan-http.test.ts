/**
 * INTEGRACIÓN HTTP REAL de GET /medicion/execution-plan?detail=intents (Fastify inject). Captura el bug de
 * producción: la respuesta serializada DEBE incluir `intents` con schema completo. Read-only, sin secretos,
 * sin provider mutate. Golpea la ruta real, no sólo el servicio.
 */
import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { DeterministicIntelligenceProvider } from '@soec/intelligence';
import { buildApp } from '../src/app';
import { ActorId, OrganizationId, type Attribution, type EventStore, type RequestContext } from '@soec/contracts';
import { ObservacionService, type EntradaObservacionReal } from '@soec/motor-medicion';
import { adsSnapshotStreamId, EVENTO_ADS_SNAPSHOT } from '../src/ingesta/ingesta-google-ads-service';
import { ORG_SMILEFLOW as ORG } from '../src/plataforma';
import { CampaignOperatorDryRunService } from '../src/campana/campaign-operator-service';
import { DiagnosisEvidenceService } from '../src/campana/diagnosis-evidence-service';
import { EnvelopeService } from '../src/campana/envelope-service';
import type { MarketingReadiness } from '../src/campana/diagnosis-evidence';

const T = '2026-08-25T12:00:00.000Z';
const ATR: Attribution = { source: 't', purpose: 't', assumptions: [], claimType: 'observational', regime: 'empirical', uncertainty: 'baja' };
const ctx = (org: string): RequestContext => ({ organizationId: OrganizationId(org), actor: ActorId('seed'), scope: { organizationId: OrganizationId(org), permissions: ['events:append', 'events:read'] }, correlationId: 'c' });
async function seed(store: EventStore): Promise<void> {
  const c = ctx(ORG);
  const ev = await store.readStream(c, adsSnapshotStreamId(ORG));
  await store.append(c, adsSnapshotStreamId(ORG), ev.length, [{ type: EVENTO_ADS_SNAPSHOT, payload: { campaignId: '24120966895', campaignName: 'SmileFlow Search Chile', status: 'PAUSED', impressions: 1361, clicks: 50, cost: 30137, at: T }, attribution: ATR, occurredAt: T }]);
  const obs = new ObservacionService(store as never, {} as never);
  const term = (t: string, m: string, v: number): EntradaObservacionReal => ({ provider: 'google-ads', externalEventId: `st:${t}:${m}`, eventName: 'ads_search_term', occurredAt: T, kpiId: m, metrica: m, valor: v, unidad: 'conteo', calidad: 'alta', cobertura: 1, source: 'google-ads', utmContent: t, diagnostico: false });
  for (const f of [{ t: 'administracion clinica dental', i: 300, cl: 12 }, { t: 'dentalink precios', i: 160, cl: 9 }, { t: 'exocad', i: 50, cl: 1 }]) {
    await obs.registrarReal(ctx(ORG), term(f.t, 'search_term_impressions', f.i).externalEventId, term(f.t, 'search_term_impressions', f.i), ATR, T);
    await obs.registrarReal(ctx(ORG), term(f.t, 'search_term_clicks', f.cl).externalEventId, term(f.t, 'search_term_clicks', f.cl), ATR, T);
  }
  const READY: MarketingReadiness = {
    landing: { status: 'PASS' }, firstPartyTracking: { status: 'PASS' }, googleAdsAttribution: { status: 'ACTIVE' }, sitelinks: { status: 'PASS' }, mobile: { status: 'PASS' },
    diagnosisCompletedAt: T, evidenceSource: 'chrome', findings: [],
    validatedDestinations: [{ url: 'https://smileflowclinic.cl/#plans-trial', intent: 'plans', validated: true, public: true, available: true }, { url: 'https://smileflowclinic.cl/#features-how', intent: 'features', validated: true, public: true, available: true }],
    valueProps: [{ id: '1', capability: 'Agenda dental inteligente' }, { id: '2', capability: 'Relleno automático de agenda' }, { id: '3', capability: 'Ficha e historial clínico' }], brandName: 'SmileFlow',
  };
  await new DiagnosisEvidenceService(store).registrar(ORG, READY, T);
  const r = await new CampaignOperatorDryRunService(store, undefined, {} as NodeJS.ProcessEnv).planificar(ORG, T, { objetivo: 'Conseguir clínicas dentales interesadas en SmileFlow', presupuestoTotal: 30000, periodoDias: 10 });
  await new EnvelopeService(store).crearDesdePlan(ORG, r.plan, `plan:${ORG}:${r.at}`, T);
}
const H = { 'x-organization-id': ORG, 'x-actor-id': 'humano-test', 'x-scope': 'events:read', 'x-permissions': '' };

describe('GET /medicion/execution-plan HTTP', () => {
  it('execution_plan_route_accepts_detail_intents + returns_intents (serializados) + schema completo', async () => {
    const store = new InMemoryEventStore();
    await seed(store);
    const app = buildApp({ store, intelligence: new DeterministicIntelligenceProvider(), legacyDemoAccess: true });
    const res = await app.inject({ method: 'GET', url: '/medicion/execution-plan?detail=intents', headers: H });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(Array.isArray(b.intents)).toBe(true);               // el bug productivo: intents faltaba
    expect(b.intents.length).toBeGreaterThan(0);
    expect(b.intents.length).toBe(b.summary.executionActionCount); // reconcilia con el resumen
    for (const it of b.intents) {
      expect(it.id).toBeTruthy();
      expect(it.materialEntityFingerprint).toBeTruthy();
      expect(it.idempotencyKey).toBeTruthy();
      expect(it.status).toBeTruthy();
      expect(it.validation.decision).toBeTruthy();
      expect(typeof it.financialImpact.projectedCommitment).toBe('number');
      expect(it.providerPayload.operation).toBeTruthy();
    }
    // sin secretos en la RESPUESTA SERIALIZADA + campaña histórica no referenciada
    expect(/token|secret|authorization|bearer|refresh|developer|cookie|password/i.test(res.body)).toBe(false);
    expect(res.body.includes('SmileFlow Search Chile')).toBe(false);
    // UNICIDAD tras serializar: ids/fingerprints/idempotencyKeys todos distintos (sin colisión de los 2 ads).
    const n = b.intents.length;
    expect(new Set(b.intents.map((i: { id: string }) => i.id)).size).toBe(n);
    expect(new Set(b.intents.map((i: { materialEntityFingerprint: string }) => i.materialEntityFingerprint)).size).toBe(n);
    expect(new Set(b.intents.map((i: { idempotencyKey: string }) => i.idempotencyKey)).size).toBe(n);
    // Parent binding serializado: cada CREATE_AD y ADD_KEYWORD referencia su AD GROUP padre.
    const ads = b.intents.filter((i: { actionType: string }) => i.actionType === 'CREATE_AD');
    expect(ads.every((a: { parent?: { materialFingerprint?: string } }) => !!a.parent?.materialFingerprint)).toBe(true);
    expect(new Set(ads.map((a: { parent: { materialFingerprint: string } }) => a.parent.materialFingerprint)).size).toBe(ads.length); // padres distintos
    const kws = b.intents.filter((i: { actionType: string }) => i.actionType === 'ADD_KEYWORD');
    expect(kws.every((k: { parent?: { materialFingerprint?: string } }) => !!k.parent?.materialFingerprint)).toBe(true);
    await app.close();
  });

  it('material literal serializado (keywords/negativas/ads) + create_campaign projected_commitment', async () => {
    const store = new InMemoryEventStore();
    await seed(store);
    const app = buildApp({ store, intelligence: new DeterministicIntelligenceProvider(), legacyDemoAccess: true });
    const b = (await app.inject({ method: 'GET', url: '/medicion/execution-plan?detail=intents', headers: H })).json();
    const kw = b.intents.find((i: { actionType: string }) => i.actionType === 'ADD_KEYWORD');
    expect(kw.providerPayload.fields.text).toBeTruthy();
    expect(['EXACT', 'PHRASE', 'BROAD']).toContain(kw.providerPayload.fields.matchType);
    const neg = b.intents.find((i: { actionType: string }) => i.actionType === 'ADD_NEGATIVE_KEYWORD');
    expect(neg.providerPayload.fields.matchType).toBeTruthy();
    const ad = b.intents.find((i: { actionType: string }) => i.actionType === 'CREATE_AD');
    expect(ad.providerPayload.fields.headlines.length).toBeGreaterThan(0);
    expect(ad.providerPayload.fields.finalUrl).toContain('#');
    const cc = b.intents.find((i: { actionType: string }) => i.actionType === 'CREATE_CAMPAIGN');
    expect(cc.financialImpact.projectedCommitment).toBeLessThanOrEqual(b.ledger.remainingExperimentCap);
    await app.close();
  });

  it('sin detail ⇒ resumen (compat) SIN intents · detail_get_is_side_effect_free · gate unificado', async () => {
    const store = new InMemoryEventStore();
    await seed(store);
    const app = buildApp({ store, intelligence: new DeterministicIntelligenceProvider(), legacyDemoAccess: true });
    const resumen = (await app.inject({ method: 'GET', url: '/medicion/execution-plan', headers: H })).json();
    expect(resumen.intents).toBeUndefined();
    expect(resumen.shadowPlanCreated).toBe(true);
    // dos GET consecutivos ⇒ mismos ids/fingerprints (side-effect free)
    const a = (await app.inject({ method: 'GET', url: '/medicion/execution-plan?detail=intents', headers: H })).json();
    const b = (await app.inject({ method: 'GET', url: '/medicion/execution-plan?detail=intents', headers: H })).json();
    expect(a.intents.map((i: { id: string }) => i.id)).toEqual(b.intents.map((i: { id: string }) => i.id));
    // gate unificado: ambos endpoints ⇒ ENVELOPE_NOT_APPROVED
    expect(a.realExecutionReason).toBe('ENVELOPE_NOT_APPROVED');
    const env = (await app.inject({ method: 'GET', url: '/medicion/envelope', headers: H })).json();
    expect(env.executionAllowed.reasonCode).toBe('ENVELOPE_NOT_APPROVED');
    expect(a.providerMutateCalls).toBe(0);
    await app.close();
  });
});
