/**
 * CAMPAIGN BUILDER publicable: clasificación de intención fina (competidor comprador vs navegacional/
 * institucional/desconocido; "software para dentistas" ≠ paciente), keywords activas vs OBSERVE_NO_SPEND,
 * copy desde valueProps persistidas y destino validado. Caso real SmileFlow.
 */
import { describe, expect, it } from 'vitest';
import { construirMarketingPlan, type EntradaMarketingPlan, type CanalId } from '../src/campana/marketing-plan';
import { construirEnvelopeDraft, validateEnvelope } from '../src/campana/execution-envelope';
import type { ChannelAvailability } from '../src/campana/channel-availability';
import { clasificarTermino } from '../src/campana/intent-classifier';
import type { MarketingReadiness } from '../src/campana/diagnosis-evidence';
import { AUTONOMOUS_REAL } from '@soec/cia';

const TERMINOS = [
  { termino: 'administracion clinica dental', impresiones: 300, clics: 12 }, // gestión → TARGET
  { termino: 'software para dentistas', impresiones: 200, clics: 8 },        // gestión (software+profesional) → TARGET
  { termino: 'dentalink precios', impresiones: 180, clics: 9 },             // competidor comprador → SEGMENT
  { termino: 'dentalink demo', impresiones: 120, clics: 6 },                // competidor comprador → SEGMENT
  { termino: 'dentalink ingreso', impresiones: 90, clics: 5 },              // navegacional → no gasto
  { termino: 'dentalink uchile', impresiones: 70, clics: 2 },               // institucional → no gasto
  { termino: 'dentalink', impresiones: 60, clics: 3 },                      // marca sola → unknown → no gasto
  { termino: 'software dental', impresiones: 400, clics: 18 },              // genérico ambiguo → no gasto
  { termino: 'archform software', impresiones: 90, clics: 3 },              // tech clínico → excluir
  { termino: 'exocad', impresiones: 50, clics: 1 },                         // tech clínico → excluir
];
const DISPONIBILIDAD: ChannelAvailability[] = [
  { canal: 'google', canPlan: true, canExecute: false, executionGate: 'ADVERTISER_VERIFICATION_PENDING' },
  { canal: 'meta', canPlan: false, canExecute: false, executionGate: 'PROVIDER_NOT_CONNECTED' },
];
const READINESS_FULL: MarketingReadiness = {
  landing: { status: 'PASS' }, firstPartyTracking: { status: 'PASS' }, googleAdsAttribution: { status: 'ACTIVE' },
  sitelinks: { status: 'PASS' }, mobile: { status: 'PASS' }, diagnosisCompletedAt: '2026-08-25T00:00:00.000Z',
  evidenceSource: 'external-audit', findings: ['26% de clics fuera de intención'],
  validatedDestinations: [
    { url: 'https://smileflowclinic.cl/#plans-trial', intent: 'plans', validated: true, public: true, available: true },
    { url: 'https://smileflowclinic.cl/#features-how', intent: 'features', validated: true, public: true, available: true },
  ],
  valueProps: [
    { id: 'vp1', capability: 'Agenda inteligente para tu clínica', evidence: 'landing:features' },
    { id: 'vp2', capability: 'Recordatorios automáticos 24h antes', evidence: 'landing:features' },
    { id: 'vp3', capability: 'Relleno automático de agenda', evidence: 'landing:features' },
    { id: 'vp4', capability: 'Prueba 15 días sin cotización', evidence: 'landing:hero' },
  ],
  brandName: 'SmileFlow',
};
const BASE: Omit<EntradaMarketingPlan, 'evidencia' | 'readiness'> = {
  objetivo: 'Conseguir clínicas dentales interesadas en SmileFlow', presupuestoTotal: 30000, periodoDias: 10,
  startAt: '2026-08-25T00:00:00.000Z', endAt: '2026-09-04T00:00:00.000Z', moneda: 'CLP',
  canalesSolicitados: ['google', 'meta'] as CanalId[], disponibilidad: DISPONIBILIDAD, historicalCpa: null,
};
const EVIDENCIA = { impresiones: 1361, clics: 50, gasto: 30137, contactosReales: 0, capAutorizado: null, campaignStatus: 'PAUSED', moneda: 'CLP', terminos: TERMINOS } as const;
const plan = construirMarketingPlan({ ...BASE, evidencia: { ...EVIDENCIA }, readiness: READINESS_FULL });
const activeTexts = plan.activeKeywords.map((k) => k.text);
const observeTexts = plan.observeNoSpendKeywords.map((k) => k.text);

describe('clasificación de intención', () => {
  it('software_para_dentistas_is_not_patient_intent', () => {
    const c = clasificarTermino('software para dentistas').category;
    expect(c).not.toBe('PATIENT_INTENT');
    expect(c).toBe('CLINIC_MANAGEMENT_INTENT');
  });
  it('competidor se sub-clasifica por intención', () => {
    expect(clasificarTermino('dentalink precios').category).toBe('COMPETITOR_BUYER_INTENT');
    expect(clasificarTermino('dentalink demo').category).toBe('COMPETITOR_BUYER_INTENT');
    expect(clasificarTermino('dentalink ingreso').category).toBe('COMPETITOR_NAVIGATIONAL');
    expect(clasificarTermino('dentalink uchile').category).toBe('COMPETITOR_EDUCATIONAL_OR_INSTITUTIONAL');
    expect(clasificarTermino('dentalink').category).toBe('COMPETITOR_UNKNOWN');
  });
});

describe('campaign builder · gasto sólo por intención defendible', () => {
  it('competitor_buyer_intent_can_receive_spend', () => {
    expect(activeTexts).toContain('dentalink precios');
    const seg = plan.campaigns[0]!.adGroups.find((g) => g.action === 'SEGMENT')!;
    expect(seg.keywords.every((k) => k.matchType === 'EXACT')).toBe(true);
  });
  it('competitor_login_intent_does_not_receive_spend', () => {
    expect(activeTexts).not.toContain('dentalink ingreso');
    expect(observeTexts).toContain('dentalink ingreso');
  });
  it('competitor_institutional_intent_does_not_receive_spend', () => {
    expect(activeTexts).not.toContain('dentalink uchile');
    expect(observeTexts).toContain('dentalink uchile');
  });
  it('competitor_unknown_does_not_receive_spend', () => {
    expect(activeTexts).not.toContain('dentalink');
    expect(observeTexts).toContain('dentalink');
  });
  it('unknown genérico y tech clínico no se activan', () => {
    expect(activeTexts).not.toContain('software dental');
    expect(plan.campaignCompleteness.unknownActiveKeywords).toBe(0);
    expect(plan.campaigns[0]!.negativeKeywords.map((n) => n.text)).toContain('exocad');
  });
  it('active_keyword_has_explicit_match_type + negative_keyword_has_explicit_match_type', () => {
    expect(plan.activeKeywords.length).toBeGreaterThan(0);
    expect(plan.activeKeywords.every((k) => ['EXACT', 'PHRASE', 'BROAD'].includes(k.matchType))).toBe(true);
    expect(plan.campaigns[0]!.negativeKeywords.every((n) => ['EXACT', 'PHRASE', 'BROAD'].includes(n.matchType) && n.rationale)).toBe(true);
  });
});

describe('campaign builder · copy/destino desde readiness persistida', () => {
  it('campaign_copy_generated_from_persisted_value_props + no_pending_copy_when_readiness_complete', () => {
    expect(plan.campaignCompleteness.pendingCopyCount).toBe(0);
    const heads = plan.campaigns[0]!.adGroups.flatMap((g) => g.ads.flatMap((a) => a.headlines));
    expect(heads.some((h) => h.includes('Agenda inteligente'))).toBe(true);
    expect(heads.every((h) => !/PENDING/i.test(h))).toBe(true);
  });
  it('campaign_destination_generated_from_persisted_validated_destination + no_pending_destination_when_readiness_complete', () => {
    expect(plan.campaignCompleteness.pendingDestination).toBe(false);
    const core = plan.campaigns[0]!.adGroups.find((g) => g.action === 'TARGET')!;
    expect(core.finalDestination).toBe('https://smileflowclinic.cl/#plans-trial');
  });
  it('estados y guardrails intactos', () => {
    expect(plan.strategyStatus).toBe('READY');
    expect(plan.campaignDraftStatus).toBe('READY_FOR_APPROVAL');
    expect(plan.executionStatus).toBe('EXTERNAL_GATE_BLOCKED');
    expect(plan.recommendedChannelMix.find((m) => m.canal === 'google')!.presupuesto).toBeLessThanOrEqual(15000);
    expect(plan.recommendedChannelMix.find((m) => m.canal === 'meta')!.presupuesto).toBe(0);
    expect(plan.maxSpendWithoutContact.value).toBeLessThanOrEqual(7500);
    expect(plan.targetCpa.kind).toBe('UNDEFINED_INSUFFICIENT_EVIDENCE');
  });
});

describe('completitud rechaza incompletos', () => {
  it('ready_for_approval_rejects_pending_copy', () => {
    const p = construirMarketingPlan({ ...BASE, evidencia: { ...EVIDENCIA }, readiness: { ...READINESS_FULL, valueProps: [] } });
    expect(p.campaignDraftStatus).toBe('INCOMPLETE');
    expect(p.campaignCompleteness.pendingCopyCount).toBeGreaterThan(0);
    expect(p.strategyStatus).toBe('READY');
  });
  it('ready_for_approval_rejects_pending_destination', () => {
    const p = construirMarketingPlan({ ...BASE, evidencia: { ...EVIDENCIA }, readiness: { ...READINESS_FULL, validatedDestinations: [] } });
    expect(p.campaignDraftStatus).toBe('INCOMPLETE');
    expect(p.campaignCompleteness.pendingDestination).toBe(true);
  });
});

describe('envelope', () => {
  it('no_provider_mutation + autonomous_real_remains_false', () => {
    const draft = construirEnvelopeDraft(plan, 'org-smileflow', 'plan:test');
    expect(AUTONOMOUS_REAL).toBe(false);
    expect(draft.status).toBe('DRAFT');
    expect(draft.executionEligibleChannels).toEqual([]);
    expect(validateEnvelope({ canal: 'google', tipo: 'CREATE_CAMPAIGN' }, draft).within).toBe(false);
  });
});
