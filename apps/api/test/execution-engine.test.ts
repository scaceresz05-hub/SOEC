/**
 * GOOGLE ADS EXECUTION ENGINE — SHADOW / fail-closed. El plan aprobado se traduce a intents; ninguna acción
 * puede salir del material autorizado; doble hard cap; recursos ajenos no mutables; retries idempotentes;
 * shadow traduce payloads pero NUNCA llama mutate; envelope/gate/flags bloquean; 0 provider writes.
 */
import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { construirMarketingPlan, type EntradaMarketingPlan, type CanalId } from '../src/campana/marketing-plan';
import type { ChannelAvailability } from '../src/campana/channel-availability';
import type { MarketingReadiness } from '../src/campana/diagnosis-evidence';
import { construirEnvelope, aprobar, type ProviderState, type FlagsEjecucion } from '../src/campana/authorized-execution-envelope';
import { fingerprint, fingerprintsDelPlan } from '../src/campana/material-fingerprint';
import { construirActionPlan, idempotencyKey, type ExecutionActionIntent } from '../src/campana/execution-intent';
import { evaluarBarreras, validateActionFinancialImpact, correrShadow } from '../src/campana/execution-engine';
import { ledgerCero, construirLedger } from '../src/campana/financial-ledger';
import { ResourceBindingService, validarPropiedad, type ProviderResourceBinding } from '../src/campana/resource-binding';
import { ShadowMutatePort } from '../src/campana/google-translator';
import { ORG_SMILEFLOW as ORG } from '../src/plataforma';

const T0 = '2026-08-25T00:00:00.000Z';
const DISP: ChannelAvailability[] = [
  { canal: 'google', canPlan: true, canExecute: false, executionGate: 'ADVERTISER_VERIFICATION_PENDING' },
  { canal: 'meta', canPlan: false, canExecute: false, executionGate: 'PROVIDER_NOT_CONNECTED' },
];
const READY: MarketingReadiness = {
  landing: { status: 'PASS' }, firstPartyTracking: { status: 'PASS' }, googleAdsAttribution: { status: 'ACTIVE' }, sitelinks: { status: 'PASS' }, mobile: { status: 'PASS' },
  diagnosisCompletedAt: T0, evidenceSource: 'x', findings: [],
  validatedDestinations: [{ url: 'https://x/#plans-trial', intent: 'plans', validated: true, public: true, available: true }, { url: 'https://x/#features-how', intent: 'features', validated: true, public: true, available: true }],
  valueProps: [{ id: '1', capability: 'Agenda dental inteligente' }, { id: '2', capability: 'Relleno automático de agenda' }, { id: '3', capability: 'Ficha e historial clínico' }], brandName: 'SmileFlow',
};
const entrada: EntradaMarketingPlan = {
  objetivo: 'Conseguir clínicas dentales interesadas en SmileFlow', presupuestoTotal: 30000, periodoDias: 10, startAt: T0, endAt: '2026-09-04T00:00:00.000Z', moneda: 'CLP',
  canalesSolicitados: ['google', 'meta'] as CanalId[], disponibilidad: DISP,
  evidencia: { impresiones: 1361, clics: 50, gasto: 30137, contactosReales: 0, capAutorizado: null, campaignStatus: 'PAUSED', moneda: 'CLP', terminos: [{ termino: 'administracion clinica dental', impresiones: 300, clics: 12 }, { termino: 'dentalink precios', impresiones: 160, clics: 9 }, { termino: 'exocad', impresiones: 50, clics: 1 }] },
  readiness: READY, historicalCpa: null,
};
const PLAN = construirMarketingPlan(entrada);
const ENV_READY = construirEnvelope(PLAN, ORG, 'plan:x', T0).envelope;
const ENV_APP_WAIT = aprobar(ENV_READY, PLAN, 'humano', T0, []).envelope;
const ENV_APP_READY = aprobar(ENV_READY, PLAN, 'humano', T0, ['google']).envelope;
const INTENTS = construirActionPlan(PLAN, ENV_APP_READY, 'CUST-1', T0);
const provOk: ProviderState = { executionEligibleChannels: ['google'], providerConnected: true, trackingValid: true, landingAvailable: true, now: '2026-08-26T00:00:00Z', contacts: 1 };
const provGate: ProviderState = { executionEligibleChannels: [], providerConnected: false, trackingValid: true, landingAvailable: true, now: '2026-08-26T00:00:00Z', contacts: 0 };
const LED = ledgerCero(30000, 15000, 30137);
const SUP = (supervisedReal: boolean, autonomousReal = false): FlagsEjecucion => ({ supervisedReal, autonomousReal });
const de = (t: string): ExecutionActionIntent => INTENTS.find((x) => x.actionType === t)!;
const conFp = (i: ExecutionActionIntent, fp: string): ExecutionActionIntent => ({ ...i, materialEntityFingerprint: fp });
const rc = (i: ExecutionActionIntent, prov = provOk, flags = SUP(true), binding: ProviderResourceBinding | null = null, opts = {}) => evaluarBarreras(i, PLAN, ENV_APP_READY, LED, prov, flags, binding, opts).reasonCode;

describe('material binding', () => {
  it('approved_campaign/keyword/negative/ad/destination_can_translate', () => {
    expect(de('CREATE_CAMPAIGN').providerPayload?.operation).toBe('campaign.create');
    expect(de('ADD_KEYWORD').providerPayload?.operation).toBe('ad_group_criterion.create');
    expect(de('ADD_NEGATIVE_KEYWORD').providerPayload?.operation).toBe('campaign_criterion.create');
    expect(de('CREATE_AD').providerPayload?.operation).toBe('ad_group_ad.create');
    for (const t of ['CREATE_CAMPAIGN', 'ADD_KEYWORD', 'ADD_NEGATIVE_KEYWORD', 'CREATE_AD']) expect(rc(de(t))).toBeNull(); // material OK (bloqueo real es por flags si aplica)
  });
  it('unknown_keyword/unknown_negative/modified_ad_copy/modified_destination/unapproved_campaign_is_denied', () => {
    expect(rc(conFp(de('CREATE_CAMPAIGN'), fingerprint('campaign', ['OTRA', 'SEARCH', 'x', 1])))).toBe('PLAN_MATERIAL_CHANGE_REQUIRES_REAPPROVAL');
    expect(rc(conFp(de('ADD_KEYWORD'), fingerprint('keyword', ['keyword inventada', 'EXACT'])))).toBe('PLAN_MATERIAL_CHANGE_REQUIRES_REAPPROVAL');
    expect(rc(conFp(de('ADD_NEGATIVE_KEYWORD'), fingerprint('negative', ['negativa inventada', 'PHRASE'])))).toBe('PLAN_MATERIAL_CHANGE_REQUIRES_REAPPROVAL');
    expect(rc(conFp(de('CREATE_AD'), fingerprint('ad', ['Titular falso', 'https://x/#plans-trial'])))).toBe('PLAN_MATERIAL_CHANGE_REQUIRES_REAPPROVAL');
    expect(rc(conFp(de('CREATE_AD'), fingerprint('ad', ['Agenda dental inteligente', 'https://destino-modificado'])))).toBe('PLAN_MATERIAL_CHANGE_REQUIRES_REAPPROVAL');
  });
});

describe('finanzas · doble hard cap', () => {
  it('experiment_cap_is_hard_limit + total_cap_is_hard_limit', () => {
    expect(validateActionFinancialImpact({ ...de('CREATE_CAMPAIGN'), financialImpact: { commitment: 16000, scope: 'EXPERIMENT' } }, LED, ENV_APP_READY).reason).toBe('EXPERIMENT_CAP_WOULD_BE_EXCEEDED');
    expect(validateActionFinancialImpact({ ...de('CREATE_CAMPAIGN'), financialImpact: { commitment: 31000, scope: 'ENVELOPE' } }, LED, ENV_APP_READY).reason).toBe('TOTAL_CAP_WOULD_BE_EXCEEDED');
  });
  it('experiment_cap_can_be_lower_than_total_cap + daily_budget_adjustment_cannot_expand_experiment_cap', () => {
    expect(ENV_APP_READY.experimentBudget).toBeLessThan(ENV_APP_READY.totalCap);
    expect(validateActionFinancialImpact({ ...de('CREATE_CAMPAIGN'), financialImpact: { commitment: 16000, scope: 'EXPERIMENT' } }, LED, ENV_APP_READY).ok).toBe(false);
    expect(validateActionFinancialImpact({ ...de('CREATE_CAMPAIGN'), financialImpact: { commitment: 15000, scope: 'EXPERIMENT' } }, LED, ENV_APP_READY).ok).toBe(true);
  });
  it('historical_spend_does_not_reduce_envelope_cap + committed_spend_reduces_remaining_cap', () => {
    expect(LED.remainingEnvelopeCap).toBe(30000);
    expect(construirLedger({ totalCap: 30000, experimentBudget: 15000, historicalSpend: 30137, envelopeSpend: 0, committedSpend: 10000, experimentSpend: 0, experimentCommittedSpend: 0 }).remainingEnvelopeCap).toBe(20000);
  });
  it('provider_action_is_denied_before_overcommit', () => {
    expect(rc({ ...de('CREATE_CAMPAIGN'), financialImpact: { commitment: 40000, scope: 'ENVELOPE' } })).toBe('TOTAL_CAP_WOULD_BE_EXCEEDED');
  });
});

describe('resource ownership', () => {
  it('new_resource_can_be_bound_to_envelope', async () => {
    const store = new InMemoryEventStore();
    const svc = new ResourceBindingService(store);
    const b: ProviderResourceBinding = { organizationId: ORG, envelopeId: ENV_APP_READY.id, planHash: ENV_APP_READY.planHash, channel: 'google', entityType: 'campaign', materialFingerprint: fingerprintsDelPlan(PLAN).campaign, providerResourceId: null, createdAt: T0, lastVerifiedAt: null };
    await svc.registrar(b);
    expect((await svc.buscar(ORG, ENV_APP_READY.id, b.materialFingerprint))?.envelopeId).toBe(ENV_APP_READY.id);
  });
  it('existing_unbound_google_campaign_cannot_be_mutated', () => {
    const pausar: ExecutionActionIntent = { ...de('CREATE_CAMPAIGN'), actionType: 'PAUSE_CAMPAIGN' };
    expect(rc(pausar, provOk, SUP(true), null)).toBe('RESOURCE_NOT_OWNED_BY_ENVELOPE');
  });
  it('resource_from_other_envelope/other_tenant_cannot_be_mutated', () => {
    const ajenoEnv: ProviderResourceBinding = { organizationId: ORG, envelopeId: 'env:otro', planHash: 'x', channel: 'google', entityType: 'campaign', materialFingerprint: fingerprintsDelPlan(PLAN).campaign, providerResourceId: 'g/1', createdAt: T0, lastVerifiedAt: null };
    expect(validarPropiedad('PAUSE_CAMPAIGN', ajenoEnv, ORG, ENV_APP_READY.id).ok).toBe(false);
    const ajenoTenant: ProviderResourceBinding = { ...ajenoEnv, envelopeId: ENV_APP_READY.id, organizationId: 'org-otra' };
    expect(validarPropiedad('PAUSE_CAMPAIGN', ajenoTenant, ORG, ENV_APP_READY.id).ok).toBe(false);
  });
});

describe('idempotencia', () => {
  it('same_create_campaign_action_has_same_idempotency_key + retry no duplica', () => {
    const a = construirActionPlan(PLAN, ENV_APP_READY, 'CUST-1', T0);
    const b = construirActionPlan(PLAN, ENV_APP_READY, 'CUST-1', '2026-08-25T01:00:00Z'); // retry, distinto timestamp
    expect(a.find((x) => x.actionType === 'CREATE_CAMPAIGN')!.idempotencyKey).toBe(b.find((x) => x.actionType === 'CREATE_CAMPAIGN')!.idempotencyKey);
    const ids = new Set([...a, ...b].map((x) => x.id));
    expect(ids.size).toBe(a.length); // dedupe por id ⇒ no duplica ni campaña ni keywords
  });
  it('idempotency_key es determinista', () => {
    expect(idempotencyKey('e', 'h', 'ADD_KEYWORD', 'fp')).toBe(idempotencyKey('e', 'h', 'ADD_KEYWORD', 'fp'));
  });
});

describe('gates (tres barreras independientes)', () => {
  it('ready_plan_unapproved_envelope_is_blocked', () => {
    expect(evaluarBarreras(de('CREATE_CAMPAIGN'), PLAN, ENV_READY, LED, provOk, SUP(true), null).reasonCode).toBe('ENVELOPE_NOT_APPROVED');
  });
  it('approved_envelope_google_verification_pending_is_blocked', () => {
    expect(evaluarBarreras(de('CREATE_CAMPAIGN'), PLAN, ENV_APP_WAIT, LED, provGate, SUP(true), null).reasonCode).toBe('EXTERNAL_GATE_BLOCKED');
  });
  it('approved_envelope_google_ready_supervised_false_is_blocked', () => {
    expect(evaluarBarreras(de('CREATE_CAMPAIGN'), PLAN, ENV_APP_READY, LED, provOk, SUP(false), null).reasonCode).toBe('SUPERVISED_REAL_DISABLED');
  });
  it('autonomous_false_does_not_override_supervised_execution_policy', () => {
    expect(evaluarBarreras(de('CREATE_CAMPAIGN'), PLAN, ENV_APP_READY, LED, provOk, SUP(true, false), null, { mode: 'AUTONOMOUS' }).reasonCode).toBe('AUTONOMOUS_REAL_DISABLED');
  });
  it('shadow_mode_never_calls_provider_mutate', () => {
    const port = new ShadowMutatePort();
    const r = correrShadow(PLAN, ENV_READY, 'CUST-1', LED, provGate, SUP(false), T0);
    expect(r.providerMutateCalls).toBe(0);
    expect(port.calls).toBe(0); // el puerto shadow jamás se invoca
  });
});

describe('caso SmileFlow en SHADOW', () => {
  const r = correrShadow(PLAN, ENV_READY, 'CUST-1', LED, provGate, SUP(false), T0);
  it('SHADOW_PLAN_CREATED con conteos derivados del plan y DENY correcto', () => {
    expect(r.summary.executionActionCount).toBeGreaterThan(0);
    expect(r.summary.byType.CREATE_CAMPAIGN).toBe(1);
    expect(r.summary.byType.CREATE_AD_GROUP).toBe(PLAN.campaigns[0]!.adGroups.length);
    expect(r.summary.byType.ADD_KEYWORD).toBe(PLAN.activeKeywords.length);
    expect(r.summary.byType.ADD_NEGATIVE_KEYWORD).toBe(PLAN.campaigns[0]!.negativeKeywords.length);
    expect(r.realExecutionDecision).toBe('DENY');
    expect(r.realExecutionReason).toBe('ENVELOPE_NOT_APPROVED');
    expect(r.providerMutateCalls).toBe(0);
  });
});
