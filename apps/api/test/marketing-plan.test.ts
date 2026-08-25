/**
 * CAMPAIGN BUILDER publicable: separación STRATEGY/CAMPAIGN_DRAFT/EXECUTION, clasificación de intención fina,
 * keywords activas vs OBSERVE_NO_SPEND, copy final sin placeholders y destino validado. Caso real SmileFlow.
 */
import { describe, expect, it } from 'vitest';
import { construirMarketingPlan, type EntradaMarketingPlan, type CanalId } from '../src/campana/marketing-plan';
import { construirEnvelopeDraft, validateEnvelope } from '../src/campana/execution-envelope';
import type { ChannelAvailability } from '../src/campana/channel-availability';
import { clasificarTermino } from '../src/campana/intent-classifier';
import type { MarketingReadiness } from '../src/campana/diagnosis-evidence';
import { AUTONOMOUS_REAL } from '@soec/cia';

const TERMINOS = [
  { termino: 'administracion clinica dental', impresiones: 300, clics: 12 },   // gestión → activa
  { termino: 'software agenda dental', impresiones: 220, clics: 9 },           // gestión (agenda) → activa
  { termino: 'dentalink', impresiones: 250, clics: 10 },                       // competidor → segment
  { termino: 'eaglesoft', impresiones: 120, clics: 4 },                        // competidor → segment
  { termino: 'software dental', impresiones: 400, clics: 18 },                 // genérico ambiguo → UNKNOWN
  { termino: 'archform software', impresiones: 90, clics: 3 },                 // tech clínico → excluir
  { termino: 'cs imaging software', impresiones: 80, clics: 2 },               // tech clínico → excluir
  { termino: 'nemo studio software', impresiones: 70, clics: 1 },              // tech clínico → excluir
  { termino: 'nemocast software', impresiones: 60, clics: 1 },                 // tech clínico → excluir
  { termino: 'exocad', impresiones: 50, clics: 1 },                            // tech clínico → excluir
];
const DISPONIBILIDAD: ChannelAvailability[] = [
  { canal: 'google', canPlan: true, canExecute: false, executionGate: 'ADVERTISER_VERIFICATION_PENDING' },
  { canal: 'meta', canPlan: false, canExecute: false, executionGate: 'PROVIDER_NOT_CONNECTED' },
];
const READINESS_FULL: MarketingReadiness = {
  landing: { status: 'PASS' }, firstPartyTracking: { status: 'PASS' }, googleAdsAttribution: { status: 'ACTIVE' },
  sitelinks: { status: 'PASS' }, mobile: { status: 'PASS' }, diagnosisCompletedAt: '2026-08-25T00:00:00.000Z',
  evidenceSource: 'external-audit', findings: ['26% de clics fuera de intención principal', 'intención competidor presente'],
  validatedDestinations: [
    { url: 'https://smileflowclinic.cl/#plans-trial', anchor: 'plans-trial', intent: 'plans', validated: true, public: true, available: true },
    { url: 'https://smileflowclinic.cl/#features-how', anchor: 'features-how', intent: 'features', validated: true, public: true, available: true },
  ],
  valueProps: ['Agenda inteligente para tu clínica', 'Recordatorios automáticos 24h antes', 'Relleno automático de agenda', 'Ficha e historial clínico', 'Prueba 15 días sin cotización'],
  brandName: 'SmileFlow',
};
const READINESS_NO_COPY: MarketingReadiness = { ...READINESS_FULL, valueProps: [], validatedDestinations: [] };

const BASE: Omit<EntradaMarketingPlan, 'evidencia' | 'readiness'> = {
  objetivo: 'Conseguir clínicas dentales interesadas en SmileFlow', presupuestoTotal: 30000, periodoDias: 10,
  startAt: '2026-08-25T00:00:00.000Z', endAt: '2026-09-04T00:00:00.000Z', moneda: 'CLP',
  canalesSolicitados: ['google', 'meta'] as CanalId[], disponibilidad: DISPONIBILIDAD, historicalCpa: null,
};
const EVIDENCIA = { impresiones: 1361, clics: 50, gasto: 30137, contactosReales: 0, capAutorizado: null, campaignStatus: 'PAUSED', moneda: 'CLP', terminos: TERMINOS } as const;
const plan = construirMarketingPlan({ ...BASE, evidencia: { ...EVIDENCIA }, readiness: READINESS_FULL });

describe('clasificación de intención (regla conceptual reusable)', () => {
  it('generic_software_token_does_not_imply_management_intent', () => {
    expect(clasificarTermino('software dental').category).toBe('UNKNOWN');
  });
  it('tech clínico (marca) ⇒ CLINICAL_TECH_SOFTWARE, no gestión', () => {
    for (const t of ['archform software', 'cs imaging software', 'nemo studio software', 'nemocast software', 'exocad'])
      expect(clasificarTermino(t).category).toBe('CLINICAL_TECH_SOFTWARE');
  });
  it('gestión y competidor se distinguen', () => {
    expect(clasificarTermino('administracion clinica dental').category).toBe('CLINIC_MANAGEMENT_INTENT');
    expect(clasificarTermino('dentalink').category).toBe('COMPETITOR_MANAGEMENT_INTENT');
  });
});

describe('campaign builder · draft publicable (readiness completa)', () => {
  it('strategy READY y campaign READY_FOR_APPROVAL mientras la ejecución sigue bloqueada', () => {
    expect(plan.strategyStatus).toBe('READY');
    expect(plan.campaignDraftStatus).toBe('READY_FOR_APPROVAL'); // campaign_can_be_ready_while_execution_is_external_gate_blocked
    expect(plan.executionStatus).toBe('EXTERNAL_GATE_BLOCKED');
  });
  it('clinical_tech_software_not_activated_for_management_campaign', () => {
    expect(plan.activeKeywords.some((k) => k.intentClassification === 'CLINICAL_TECH_SOFTWARE')).toBe(false);
    const negs = plan.campaigns[0]!.negativeKeywords.map((n) => n.text);
    for (const t of ['archform software', 'cs imaging software', 'nemo studio software', 'nemocast software', 'exocad']) expect(negs).toContain(t);
  });
  it('unknown_terms_do_not_receive_spend_by_default', () => {
    expect(plan.activeKeywords.some((k) => k.intentClassification === 'UNKNOWN')).toBe(false);
    expect(plan.campaignCompleteness.unknownActiveKeywords).toBe(0);
    expect(plan.observeNoSpendKeywords.some((k) => k.text === 'software dental')).toBe(true);
  });
  it('competitor_management_terms_are_separate_strategy', () => {
    const grupo = plan.campaigns[0]!.adGroups.find((g) => g.action === 'SEGMENT');
    expect(grupo).toBeTruthy();
    expect(grupo!.keywords.every((k) => k.matchType === 'EXACT')).toBe(true);
    expect(grupo!.keywords.some((k) => k.text === 'dentalink')).toBe(true);
  });
  it('active_keyword_has_explicit_match_type', () => {
    expect(plan.activeKeywords.length).toBeGreaterThan(0);
    expect(plan.activeKeywords.every((k) => k.matchType === 'EXACT' || k.matchType === 'PHRASE' || k.matchType === 'BROAD')).toBe(true);
    expect(plan.activeKeywords.every((k) => k.rationale && k.confidence && k.action)).toBe(true);
  });
  it('negative_keyword_has_explicit_match_type', () => {
    const negs = plan.campaigns[0]!.negativeKeywords;
    expect(negs.length).toBeGreaterThan(0);
    expect(negs.every((n) => (['EXACT', 'PHRASE', 'BROAD'] as string[]).includes(n.matchType) && n.rationale)).toBe(true);
  });
  it('campaign_copy_has_no_placeholders', () => {
    expect(plan.campaignCompleteness.pendingCopyCount).toBe(0);
    const ads = plan.campaigns[0]!.adGroups.flatMap((g) => g.ads);
    expect(ads.every((a) => a.headlines.length >= 3 && a.descriptions.length >= 2)).toBe(true);
    expect(ads.every((a) => [...a.headlines, ...a.descriptions].every((x) => !/PENDING/i.test(x)))).toBe(true);
  });
  it('campaign_destination_is_validated + matches_intent', () => {
    expect(plan.campaignCompleteness.pendingDestination).toBe(false);
    const core = plan.campaigns[0]!.adGroups.find((g) => g.action === 'TARGET')!;
    const seg = plan.campaigns[0]!.adGroups.find((g) => g.action === 'SEGMENT')!;
    expect(core.finalDestination).toContain('plans-trial');
    expect(seg.finalDestination).toContain('features-how');
    expect(core.destinationRationale.length).toBeGreaterThan(0);
  });
  it('presupuesto y guardrails intactos (no aumentan)', () => {
    expect(plan.recommendedChannelMix.find((m) => m.canal === 'google')!.presupuesto).toBeLessThanOrEqual(15000);
    expect(plan.recommendedChannelMix.find((m) => m.canal === 'meta')!.presupuesto).toBe(0);
    expect(plan.maxSpendWithoutContact.value).toBeLessThanOrEqual(7500);
    expect(plan.targetCpa.kind).toBe('UNDEFINED_INSUFFICIENT_EVIDENCE');
  });
});

describe('completitud: campaña INCOMPLETA se rechaza', () => {
  it('ready_for_approval_rejects_pending_copy', () => {
    const p = construirMarketingPlan({ ...BASE, evidencia: { ...EVIDENCIA }, readiness: { ...READINESS_FULL, valueProps: [] } });
    expect(p.campaignDraftStatus).toBe('INCOMPLETE');
    expect(p.campaignCompleteness.pendingCopyCount).toBeGreaterThan(0);
    expect(p.strategyStatus).toBe('READY'); // strategy_can_be_ready_while_campaign_is_incomplete
  });
  it('ready_for_approval_rejects_pending_destination', () => {
    const p = construirMarketingPlan({ ...BASE, evidencia: { ...EVIDENCIA }, readiness: { ...READINESS_FULL, validatedDestinations: [] } });
    expect(p.campaignDraftStatus).toBe('INCOMPLETE');
    expect(p.campaignCompleteness.pendingDestination).toBe(true);
  });
  it('sin readiness ⇒ diagnóstico requerido (estrategia no lista)', () => {
    const p = construirMarketingPlan({ ...BASE, evidencia: { ...EVIDENCIA }, readiness: null });
    expect(p.strategyStatus).toBe('DIAGNOSIS_REQUIRED');
    expect(p.campaignDraftStatus).toBe('INCOMPLETE');
  });
});

describe('envelope · sin ejecución real', () => {
  const draft = construirEnvelopeDraft(plan, 'org-smileflow', 'plan:test');
  it('no_provider_mutation + autonomous_real_remains_false', () => {
    expect(AUTONOMOUS_REAL).toBe(false);
    expect(draft.status).toBe('DRAFT');
    expect(draft.executionEligibleChannels).toEqual([]);
    expect(validateEnvelope({ canal: 'google', tipo: 'CREATE_CAMPAIGN' }, draft).within).toBe(false);
  });
});
