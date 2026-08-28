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
import { fingerprint, fingerprintsDelPlan, adGroupFingerprint, keywordFingerprint } from '../src/campana/material-fingerprint';
import { construirActionPlan, idempotencyKey, type ExecutionActionIntent } from '../src/campana/execution-intent';
import { evaluarBarreras, validateActionFinancialImpact, correrShadow, evaluarGateEnvelope, detalleIntent, sanitizarPayload } from '../src/campana/execution-engine';
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
  evidencia: { impresiones: 1361, clics: 50, gasto: 30137, contactosReales: 0, capAutorizado: null, campaignStatus: 'PAUSED', moneda: 'CLP', terminos: [{ termino: 'agenda clinica dental', impresiones: 300, clics: 12 }, { termino: 'dentalink precios', impresiones: 160, clics: 9 }, { termino: 'exocad', impresiones: 50, clics: 1 }] },
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

describe('execution detail inspeccionable + sanitización', () => {
  const shadow = correrShadow(PLAN, ENV_READY, 'CUST-1', LED, provGate, SUP(false), T0);
  const fps = fingerprintsDelPlan(PLAN);
  const detalles = shadow.intents.map((it) => detalleIntent(it, fps, ENV_READY.currency));

  it('execution_detail_exposes_all_intents con schema completo', () => {
    expect(detalles.length).toBe(shadow.intents.length);
    for (const d of detalles) {
      expect(d.materialEntityFingerprint).toBeTruthy();        // every_intent_has_material_fingerprint
      expect(d.idempotencyKey).toBeTruthy();                   // every_intent_has_idempotency_key
      expect(d.status).toBeTruthy();                           // execution_detail_exposes_intent_status
      expect(d.validation.decision).toBeTruthy();              // execution_detail_exposes_validation_reason
      expect(typeof d.financialImpact.projectedCommitment).toBe('number'); // execution_detail_exposes_financial_impact
      expect(d.providerPayload?.operation).toBeTruthy();       // execution_detail_exposes_translated_google_payload
      expect(d.materialBinding.approved).toBe(true);           // no_unapproved_material_in_execution_detail
    }
  });
  it('execution_detail_never_exposes_provider_secrets', () => {
    const s = sanitizarPayload({ customerId: 'C', operation: 'campaign.create', fields: { name: 'x' }, refreshToken: 'SECRET', authorization: 'Bearer y', developerToken: 'D', client_secret: 'z' });
    expect(s).toEqual({ customerId: 'C', operation: 'campaign.create', fields: { name: 'x' } });
    const blob = JSON.stringify(detalles);
    expect(/token|secret|authorization|bearer|refresh|developer|cookie|password/i.test(blob)).toBe(false);
  });
  it('approved_keywords/negatives/matchtypes/ads/destinations expuestos literalmente', () => {
    const kw = detalles.find((d) => d.actionType === 'ADD_KEYWORD')!;
    const f = kw.providerPayload!.fields as { text: string; matchType: string };
    expect(f.text).toBeTruthy(); expect(['EXACT', 'PHRASE', 'BROAD']).toContain(f.matchType);
    const neg = detalles.find((d) => d.actionType === 'ADD_NEGATIVE_KEYWORD')!;
    expect((neg.providerPayload!.fields as { matchType: string }).matchType).toBeTruthy();
    const ad = detalles.find((d) => d.actionType === 'CREATE_AD')!;
    const af = ad.providerPayload!.fields as { headlines: string[]; finalUrl: string };
    expect(af.headlines.length).toBeGreaterThan(0); expect(af.finalUrl).toContain('#'); // destino aprobado
  });
  it('create_campaign_projected_commitment_within_experiment_and_total_cap', () => {
    const cc = detalles.find((d) => d.actionType === 'CREATE_CAMPAIGN')!;
    expect(cc.financialImpact.projectedCommitment).toBeLessThanOrEqual(LED.remainingExperimentCap);
    expect(cc.financialImpact.projectedCommitment).toBeLessThanOrEqual(LED.remainingEnvelopeCap);
    expect(cc.financialImpact.scope).toBe('EXPERIMENT');
  });
  it('provider_resource_ids_not_fabricated_in_shadow + historical_campaign_not_referenced', () => {
    const blob = JSON.stringify(detalles);
    expect(blob.includes('24120966895')).toBe(false);       // id de la campaña histórica
    expect(blob.includes('SmileFlow Search Chile')).toBe(false);
  });
  it('execution_detail_get_is_side_effect_free + retry byte-stable', () => {
    const a = correrShadow(PLAN, ENV_READY, 'CUST-1', LED, provGate, SUP(false), T0).intents.map((it) => detalleIntent(it, fps, 'CLP'));
    const b = correrShadow(PLAN, ENV_READY, 'CUST-1', LED, provGate, SUP(false), T0).intents.map((it) => detalleIntent(it, fps, 'CLP'));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('gate unificado', () => {
  it('envelope_and_execution_plan_use_same_gate_evaluator', () => {
    const gate = evaluarGateEnvelope(ENV_READY, PLAN, provGate, SUP(false));
    const shadow = correrShadow(PLAN, ENV_READY, 'CUST-1', LED, provGate, SUP(false), T0);
    expect(shadow.realExecutionReason).toBe(gate.reasonCode);
    expect(gate.reasonCode).toBe('ENVELOPE_NOT_APPROVED'); // unapproved_envelope_reason_is_envelope_not_approved
  });
  it('approved_google_pending / approved_google_ready_supervised_false (precedencia unificada)', () => {
    expect(evaluarGateEnvelope(ENV_APP_WAIT, PLAN, provGate, SUP(true)).reasonCode).toBe('EXTERNAL_GATE_BLOCKED');
    expect(evaluarGateEnvelope(ENV_APP_READY, PLAN, provOk, SUP(false)).reasonCode).toBe('SUPERVISED_REAL_DISABLED');
  });
});

describe('parent resource binding (ad group → ad / keyword)', () => {
  const ads = INTENTS.filter((i) => i.actionType === 'CREATE_AD');
  const kws = INTENTS.filter((i) => i.actionType === 'ADD_KEYWORD');
  it('same_copy_same_destination_different_adgroups_have_different_fingerprints/ids/idempotency_keys', () => {
    expect(ads.length).toBeGreaterThanOrEqual(2);
    expect(new Set(ads.map((a) => a.materialEntityFingerprint)).size).toBe(ads.length);
    expect(new Set(ads.map((a) => a.id)).size).toBe(ads.length);
    expect(new Set(ads.map((a) => a.idempotencyKey)).size).toBe(ads.length);
  });
  it('create_ad_contains_parent_adgroup_fingerprint + payload_reference + dependency', () => {
    for (const a of ads) {
      expect(a.parent?.entityType).toBe('AD_GROUP');
      expect(a.parent?.materialFingerprint).toBeTruthy();
      expect(fingerprintsDelPlan(PLAN).adGroupSet.has(a.parent!.materialFingerprint)).toBe(true);
      expect((a.providerPayload as { parentAdGroup?: { materialFingerprint: string } }).parentAdGroup?.materialFingerprint).toBe(a.parent!.materialFingerprint);
      expect(a.dependsOn.some((d) => d.actionType === 'CREATE_AD_GROUP' && d.materialFingerprint === a.parent!.materialFingerprint)).toBe(true);
    }
  });
  it('keyword_contains_parent_adgroup_fingerprint + reference + dependency; parent points to correct group', () => {
    for (const k of kws) {
      expect(k.parent?.materialFingerprint).toBeTruthy();
      const g = PLAN.campaigns[0]!.adGroups.find((x) => x.name === k.parent!.logicalName)!;
      expect(adGroupFingerprint(g)).toBe(k.parent!.materialFingerprint); // parent correcto por grupo
      expect((k.providerPayload as { parentAdGroup?: { materialFingerprint: string } }).parentAdGroup?.materialFingerprint).toBe(k.parent!.materialFingerprint);
    }
  });
  it('same_keyword_same_matchtype_different_adgroups_have_different_fingerprints/keys', () => {
    const fpA = 'ADGROUP_A'; const fpB = 'ADGROUP_B';
    const k = { text: 'software dental', matchType: 'PHRASE' } as never;
    expect(keywordFingerprint(fpA, k)).not.toBe(keywordFingerprint(fpB, k));
  });
  it('missing_adgroup_parent_denies_ad_and_keyword (fail-closed)', () => {
    const adBadParent = { ...ads[0]!, parent: { entityType: 'AD_GROUP' as const, materialFingerprint: 'FP_INEXISTENTE' } };
    expect(rc(adBadParent)).toBe('PARENT_RESOURCE_NOT_IN_APPROVED_PLAN');
    const kwBadParent = { ...kws[0]!, parent: { entityType: 'AD_GROUP' as const, materialFingerprint: 'FP_INEXISTENTE' } };
    expect(rc(kwBadParent)).toBe('PARENT_RESOURCE_NOT_IN_APPROVED_PLAN');
  });
  it('todos los intents con fingerprint/id/idempotencyKey ÚNICOS (sin colisión)', () => {
    expect(new Set(INTENTS.map((i) => i.materialEntityFingerprint)).size).toBe(INTENTS.length);
    expect(new Set(INTENTS.map((i) => i.id)).size).toBe(INTENTS.length);
    expect(new Set(INTENTS.map((i) => i.idempotencyKey)).size).toBe(INTENTS.length);
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
