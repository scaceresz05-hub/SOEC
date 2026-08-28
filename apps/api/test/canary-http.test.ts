/**
 * FASE 2B — INTEGRACIÓN HTTP del entry point del canary (Fastify inject). Prueba el wiring productivo: requiere
 * auth (A), exige business.manage, y con el envelope NO canónico del test el CONTEXTO fijo DENIEGA (fail-closed)
 * sin tocar el proveedor (0 mutate/bindings). En producción, el envelope canónico llega al gate SUPERVISED_REAL.
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

const T = '2026-08-27T12:00:00.000Z';
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
const AUTH = { 'x-organization-id': ORG, 'x-actor-id': 'humano-test', 'x-scope': 'events:read', 'x-permissions': 'business.manage' };

describe('POST /medicion/canary-execute (entry point)', () => {
  it('A: sin autenticación ⇒ rechazado (no ejecuta)', async () => {
    const store = new InMemoryEventStore();
    await seed(store);
    const app = buildApp({ store, intelligence: new DeterministicIntelligenceProvider(), legacyDemoAccess: true });
    const res = await app.inject({ method: 'POST', url: '/medicion/canary-execute', headers: { 'content-type': 'application/json' }, payload: {} });
    expect([401, 403]).toContain(res.statusCode);
    await app.close();
  });

  it('sin business.manage ⇒ 403', async () => {
    const store = new InMemoryEventStore();
    await seed(store);
    const app = buildApp({ store, intelligence: new DeterministicIntelligenceProvider(), legacyDemoAccess: true });
    const res = await app.inject({ method: 'POST', url: '/medicion/canary-execute', headers: { ...AUTH, 'x-permissions': '' }, payload: {} });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('autenticado + business.manage ⇒ LIVE, DENY por contexto (envelope no canónico), 0 provider writes', async () => {
    const store = new InMemoryEventStore();
    await seed(store);
    const app = buildApp({ store, intelligence: new DeterministicIntelligenceProvider(), legacyDemoAccess: true });
    const res = await app.inject({ method: 'POST', url: '/medicion/canary-execute', headers: AUTH, payload: {} });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.decision).toBe('DENY'); // el envelope del test (3 términos) ≠ env:...:842a5165b22c462d ⇒ ENVELOPE_ID_MISMATCH
    expect(b.reason).toBe('ENVELOPE_ID_MISMATCH');
    expect(b.executionTriggerScope).toBe('FULL_APPROVED_PLAN');
    expect(b.providerMutateAttempts).toBe(0);
    expect(b.providerBindings).toBe(0);
    expect(Array.isArray(b.providerAttempts)).toBe(true);
    expect(b.providerAttempts.length).toBe(0); // DENY por contexto ⇒ el transporte nunca se invocó
    expect(b.supervisedReal).toBe(false);
    expect(b.autonomousReal).toBe(false);
    // sin secretos ni payloads de proveedor en la respuesta
    expect(/token|secret|refresh|bearer|developer/i.test(res.body)).toBe(false);
    await app.close();
  });

  it('GET /medicion/canary-attempts ⇒ 200 con attempts (durable; vacío sin intentos)', async () => {
    const store = new InMemoryEventStore();
    await seed(store);
    const app = buildApp({ store, intelligence: new DeterministicIntelligenceProvider(), legacyDemoAccess: true });
    const res = await app.inject({ method: 'GET', url: '/medicion/canary-attempts', headers: AUTH });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().attempts)).toBe(true);
    // sin business.manage ⇒ 403
    expect((await app.inject({ method: 'GET', url: '/medicion/canary-attempts', headers: { ...AUTH, 'x-permissions': '' } })).statusCode).toBe(403);
    await app.close();
  });
});

describe('operationalMode ⇒ supervisedReal (read model + executor, misma fuente)', () => {
  const nuevoApp = async () => {
    const store = new InMemoryEventStore();
    await seed(store);
    return buildApp({ store, intelligence: new DeterministicIntelligenceProvider(), legacyDemoAccess: true });
  };
  const envelopeConModo = async (app: Awaited<ReturnType<typeof nuevoApp>>, mode?: string) =>
    (await app.inject({ method: 'GET', url: '/medicion/envelope', headers: mode ? { ...AUTH, 'x-operational-mode': mode } : AUTH })).json();

  it('A: PILOT ⇒ envelope.supervisedReal=false', async () => {
    const app = await nuevoApp();
    expect((await envelopeConModo(app, 'PILOT')).supervisedReal).toBe(false);
    await app.close();
  });
  it('B: SUPERVISED_REAL ⇒ envelope.supervisedReal=true', async () => {
    const app = await nuevoApp();
    expect((await envelopeConModo(app, 'SUPERVISED_REAL')).supervisedReal).toBe(true);
    await app.close();
  });
  it('E: modo ausente/desconocido ⇒ false (fail-closed)', async () => {
    const app = await nuevoApp();
    expect((await envelopeConModo(app)).supervisedReal).toBe(false);
    expect((await envelopeConModo(app, 'OTRO')).supervisedReal).toBe(false);
    await app.close();
  });
  it('H: autonomousReal siempre false', async () => {
    const app = await nuevoApp();
    expect((await envelopeConModo(app, 'SUPERVISED_REAL')).autonomousReal).toBe(false);
    await app.close();
  });
  it('I: el executor (canary-execute) recibe el mismo supervisedReal derivado del modo', async () => {
    const app = await nuevoApp();
    const b = (await app.inject({ method: 'POST', url: '/medicion/canary-execute', headers: { ...AUTH, 'x-operational-mode': 'SUPERVISED_REAL' }, payload: {} })).json();
    expect(b.supervisedReal).toBe(true);       // la misma fuente llega al executor
    expect(b.decision).toBe('DENY');            // pero DENY por contexto (envelope de test ≠ canónico)
    expect(b.reason).toBe('ENVELOPE_ID_MISMATCH');
    expect(b.providerMutateAttempts).toBe(0);      // 0 writes
    await app.close();
  });
  it('G: el body NO puede falsificar el modo (sólo cuenta la cabecera del gateway)', async () => {
    const app = await nuevoApp();
    const b = (await app.inject({ method: 'POST', url: '/medicion/canary-execute', headers: AUTH, payload: { mode: 'SUPERVISED_REAL', supervisedReal: true } })).json();
    expect(b.supervisedReal).toBe(false); // sin x-operational-mode ⇒ false; el body se ignora
    await app.close();
  });
});
