/**
 * HOTFIX P0 — EXECUTION-PLAN con ENVELOPE LEGACY (schema anterior). Un envelope/plan persistido ANTES del modelo
 * CAMPAIGN TOTAL BUDGET (sin budgetPolicy / sin authorizedDurationDays / con ADJUST_DAILY_BUDGET) hacía 500 en
 * GET /medicion/execution-plan (traducir lanzaba CREATE_CAMPAIGN_SIN_BUDGET_POLICY). Ahora falla CERRADO con
 * ENVELOPE_MATERIAL_REFRESH_REQUIRED, HTTP 200, sin inferir CAMPAIGN_TOTAL, sin generar intents, SIN mutar nada.
 * El nuevo schema sigue funcionando. Read-only, sin provider writes.
 */
import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { DeterministicIntelligenceProvider } from '@soec/intelligence';
import { buildApp } from '../src/app';
import { ActorId, OrganizationId, type Attribution, type EventStore, type RequestContext } from '@soec/contracts';
import { construirMarketingPlan, type EntradaMarketingPlan, type CanalId, type MarketingPlan } from '../src/campana/marketing-plan';
import { construirEnvelope, type AuthorizedExecutionEnvelope } from '../src/campana/authorized-execution-envelope';
import type { ChannelAvailability } from '../src/campana/channel-availability';
import type { MarketingReadiness } from '../src/campana/diagnosis-evidence';
import { EVENTO_CAMPAIGN_OPERATOR, campaignOperatorStreamId } from '../src/campana/campaign-operator-service';
import { EVENTO_ENVELOPE, envelopeStreamId, envelopeAuditStreamId, EVENTO_ENVELOPE_AUDIT } from '../src/campana/envelope-service';
import { ORG_SMILEFLOW as ORG } from '../src/plataforma';

const T = '2026-08-25T00:00:00.000Z';
const ATR: Attribution = { source: 't', purpose: 't', assumptions: [], claimType: 'observational', regime: 'empirical', uncertainty: 'baja' };
const ctx = (org: string): RequestContext => ({ organizationId: OrganizationId(org), actor: ActorId('seed'), scope: { organizationId: OrganizationId(org), permissions: ['events:append', 'events:read'] }, correlationId: 'c' });
const DISP: ChannelAvailability[] = [
  { canal: 'google', canPlan: true, canExecute: false, executionGate: 'ADVERTISER_VERIFICATION_PENDING' },
  { canal: 'meta', canPlan: false, canExecute: false, executionGate: 'PROVIDER_NOT_CONNECTED' },
];
const READY: MarketingReadiness = {
  landing: { status: 'PASS' }, firstPartyTracking: { status: 'PASS' }, googleAdsAttribution: { status: 'ACTIVE' }, sitelinks: { status: 'PASS' }, mobile: { status: 'PASS' },
  diagnosisCompletedAt: T, evidenceSource: 'x', findings: [],
  validatedDestinations: [{ url: 'https://x/#plans-trial', intent: 'plans', validated: true, public: true, available: true }, { url: 'https://x/#features-how', intent: 'features', validated: true, public: true, available: true }],
  valueProps: [{ id: '1', capability: 'Agenda dental inteligente' }, { id: '2', capability: 'Relleno automático de agenda' }, { id: '3', capability: 'Ficha e historial clínico' }], brandName: 'SmileFlow',
};
const entrada: EntradaMarketingPlan = {
  objetivo: 'Conseguir clínicas dentales interesadas en SmileFlow', presupuestoTotal: 30000, periodoDias: 10, startAt: T, endAt: '2026-09-04T00:00:00.000Z', moneda: 'CLP',
  canalesSolicitados: ['google', 'meta'] as CanalId[], disponibilidad: DISP,
  evidencia: { impresiones: 1361, clics: 50, gasto: 30137, contactosReales: 0, capAutorizado: null, campaignStatus: 'PAUSED', moneda: 'CLP', terminos: [{ termino: 'administracion clinica dental', impresiones: 300, clics: 12 }, { termino: 'dentalink precios', impresiones: 160, clics: 9 }, { termino: 'exocad', impresiones: 50, clics: 1 }] },
  readiness: READY, historicalCpa: null,
};
const H = { 'x-organization-id': ORG, 'x-actor-id': 'humano-test', 'x-scope': 'events:read', 'x-permissions': '' };
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

async function append(store: EventStore, sid: string, type: string, payload: unknown): Promise<void> {
  const c = ctx(ORG);
  const prev = await store.readStream(c, sid);
  await store.append(c, sid, prev.length, [{ type, payload, attribution: ATR, occurredAt: T }]);
}

/** Siembra un plan + envelope. Si `legacy`, degrada al schema anterior (sin budgetPolicy/authorizedDurationDays + ADJUST_DAILY_BUDGET). */
async function seed(store: EventStore, legacy: boolean): Promise<AuthorizedExecutionEnvelope> {
  const planActual = construirMarketingPlan(entrada);
  const envActual = construirEnvelope(planActual, ORG, `plan:${ORG}:${T}`, T).envelope;
  const plan: MarketingPlan = clone(planActual);
  let env: AuthorizedExecutionEnvelope = clone(envActual);
  if (legacy) {
    delete (plan.campaigns[0] as { budgetPolicy?: unknown }).budgetPolicy; // plan del schema anterior
    const legacyEnv = clone(envActual) as Record<string, unknown>;
    delete legacyEnv.authorizedDurationDays;
    legacyEnv.startsAt = T; legacyEnv.expiresAt = '2026-09-04T00:00:00.000Z'; // fechas absolutas legacy
    legacyEnv.authorizedActionTypes = ['CREATE_CAMPAIGN', 'CREATE_AD_GROUP', 'CREATE_AD', 'ADD_KEYWORD', 'ADD_NEGATIVE_KEYWORD', 'PAUSE_CAMPAIGN', 'RESUME_CAMPAIGN', 'ADJUST_DAILY_BUDGET', 'PAUSE_AD_GROUP', 'PAUSE_KEYWORD', 'STOP_CAMPAIGN'];
    env = legacyEnv as unknown as AuthorizedExecutionEnvelope;
  }
  await append(store, campaignOperatorStreamId(ORG), EVENTO_CAMPAIGN_OPERATOR, { modo: 'DRY_RUN', autonomousReal: false, plan, envelopeDraft: env, at: T });
  await append(store, envelopeStreamId(ORG), EVENTO_ENVELOPE, env);
  return env;
}

describe('GET /medicion/execution-plan · envelope LEGACY (hotfix P0)', () => {
  it('legacy_envelope_execution_plan_does_not_500 + returns_material_refresh_required (DENY, HTTP 200)', async () => {
    const store = new InMemoryEventStore();
    await seed(store, true);
    const app = buildApp({ store, intelligence: new DeterministicIntelligenceProvider(), legacyDemoAccess: true });
    const res = await app.inject({ method: 'GET', url: '/medicion/execution-plan', headers: H });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.shadowPlanCreated).toBe(false);
    expect(b.realExecutionDecision).toBe('DENY');
    expect(b.realExecutionReason).toBe('ENVELOPE_MATERIAL_REFRESH_REQUIRED');
    expect(b.envelopeCompatibility).toEqual({ compatible: false, reasonCode: 'ENVELOPE_MATERIAL_REFRESH_REQUIRED' });
    expect(b.summary).toBeNull();
    expect(b.providerMutateCalls).toBe(0);
    await app.close();
  });

  it('legacy_envelope_detail_intents_does_not_500 + no_current_policy_intents + no_inferred_campaign_total/duration', async () => {
    const store = new InMemoryEventStore();
    await seed(store, true);
    const app = buildApp({ store, intelligence: new DeterministicIntelligenceProvider(), legacyDemoAccess: true });
    const res = await app.inject({ method: 'GET', url: '/medicion/execution-plan?detail=intents', headers: H });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.realExecutionReason).toBe('ENVELOPE_MATERIAL_REFRESH_REQUIRED');
    expect(Array.isArray(b.intents)).toBe(true);
    expect(b.intents.length).toBe(0); // legacy NO genera los 59 bajo la política nueva
    expect(res.body).not.toContain('CAMPAIGN_TOTAL');    // no infiere presupuesto total
    expect(res.body).not.toContain('CUSTOM_PERIOD');
    expect(res.body).not.toContain('totalAmountMicros'); // no infiere micros
    await app.close();
  });

  it('legacy_execution_plan_get_does_not_mutate/supersede/audit + calls_no_provider_mutate (2 GET side-effect free)', async () => {
    const store = new InMemoryEventStore();
    const env0 = await seed(store, true);
    const auditAntes = (await store.readStream(ctx(ORG), envelopeAuditStreamId(ORG))).filter((e) => e.type === EVENTO_ENVELOPE_AUDIT).length;
    const envStreamAntes = (await store.readStream(ctx(ORG), envelopeStreamId(ORG))).length;
    const app = buildApp({ store, intelligence: new DeterministicIntelligenceProvider(), legacyDemoAccess: true });
    await app.inject({ method: 'GET', url: '/medicion/execution-plan', headers: H });
    await app.inject({ method: 'GET', url: '/medicion/execution-plan?detail=intents', headers: H });
    // El envelope legacy NO fue tocado por el GET: mismo stream, sin nuevos eventos, sin auditoría, mismo id/hash.
    const envs = (await store.readStream(ctx(ORG), envelopeStreamId(ORG))).filter((e) => e.type === EVENTO_ENVELOPE);
    const ultimo = envs[envs.length - 1]!.payload as AuthorizedExecutionEnvelope;
    expect((await store.readStream(ctx(ORG), envelopeStreamId(ORG))).length).toBe(envStreamAntes);
    expect((await store.readStream(ctx(ORG), envelopeAuditStreamId(ORG))).filter((e) => e.type === EVENTO_ENVELOPE_AUDIT).length).toBe(auditAntes);
    expect(ultimo.id).toBe(env0.id);
    expect(ultimo.planHash).toBe(env0.planHash);
    expect((ultimo as Record<string, unknown>).authorizedDurationDays).toBeUndefined(); // sigue legacy, no migrado on-read
    expect(ultimo.authorizedActionTypes).toContain('ADJUST_DAILY_BUDGET'); // no se le quitó in-memory
    expect(env0.status).toBe('READY_FOR_HUMAN_APPROVAL');
    await app.close();
  });

  it('CURRENT_SCHEMA_REGRESSION: envelope compatible sigue generando CAMPAIGN_TOTAL + intents (sin regresión)', async () => {
    const store = new InMemoryEventStore();
    await seed(store, false); // schema NUEVO
    const app = buildApp({ store, intelligence: new DeterministicIntelligenceProvider(), legacyDemoAccess: true });
    const b = (await app.inject({ method: 'GET', url: '/medicion/execution-plan?detail=intents', headers: H })).json();
    expect(b.shadowPlanCreated).toBe(true);
    expect(b.envelopeCompatibility).toEqual({ compatible: true, reasonCode: null });
    expect(b.intents.length).toBeGreaterThan(0);
    const ccFields = b.intents.find((i: { actionType: string }) => i.actionType === 'CREATE_CAMPAIGN').providerPayload.fields;
    expect(ccFields.budgetPolicy).toBe('CAMPAIGN_TOTAL');
    expect(ccFields.budget.period).toBe('CUSTOM_PERIOD');
    expect(ccFields.budget.totalAmountMicros).toBe(15_000_000_000);
    expect(b.realExecutionReason).toBe('ENVELOPE_NOT_APPROVED'); // no aprobado, pero YA no es incompatibilidad
    await app.close();
  });
});
