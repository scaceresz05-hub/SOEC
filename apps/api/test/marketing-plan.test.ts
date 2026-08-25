/**
 * STRATEGY PLANNER + ENVELOPE + READINESS + DISPONIBILIDAD (puros). Transición diagnóstico → plan operable:
 * caso real SmileFlow con diagnóstico RESUELTO ⇒ plan con hipótesis, draft, keywords/negativas y guardrails
 * numéricos; ejecución bloqueada por gate externo de Google. Nada se ejecuta.
 */
import { describe, expect, it } from 'vitest';
import { construirMarketingPlan, type EntradaMarketingPlan, type CanalId } from '../src/campana/marketing-plan';
import { construirEnvelopeDraft, validateEnvelope } from '../src/campana/execution-envelope';
import type { ChannelAvailability } from '../src/campana/channel-availability';
import { evaluarReadiness, type MarketingReadiness } from '../src/campana/diagnosis-evidence';
import { clasificarIntencion } from '../src/campana/intent-classifier';
import { AUTONOMOUS_REAL } from '@soec/cia';

const TERMINOS = [
  { termino: 'software dental', impresiones: 400, clics: 18 },
  { termino: 'administracion clinica dental', impresiones: 300, clics: 12 },
  { termino: 'dentalink', impresiones: 250, clics: 10 },
  { termino: 'eaglesoft', impresiones: 120, clics: 4 },
  { termino: 'exocad', impresiones: 180, clics: 4 },
  { termino: 'cariogram', impresiones: 111, clics: 2 },
];
const SIGNALS = clasificarIntencion(TERMINOS);

// Readiness SmileFlow: diagnóstico COMPLETO, todo PASS/ACTIVE (funnel técnicamente resuelto).
const READINESS_OK: MarketingReadiness = {
  landing: { status: 'PASS' }, firstPartyTracking: { status: 'PASS' },
  googleAdsAttribution: { status: 'ACTIVE' }, sitelinks: { status: 'PASS' }, mobile: { status: 'PASS' },
  diagnosisCompletedAt: '2026-08-24T00:00:00.000Z', evidenceSource: 'external-audit',
  findings: ['26% de clics fuera de intención principal', 'intención competidor presente', '92% histórico a raíz genérica', '0 contactos first-party'],
};
// Disponibilidad REAL: Google planificable pero ejecución bloqueada (verificación pendiente); Meta no disponible.
const DISPONIBILIDAD: ChannelAvailability[] = [
  { canal: 'google', canPlan: true, canExecute: false, executionGate: 'ADVERTISER_VERIFICATION_PENDING' },
  { canal: 'meta', canPlan: false, canExecute: false, executionGate: 'PROVIDER_NOT_CONNECTED' },
];

const BASE: Omit<EntradaMarketingPlan, 'evidencia' | 'readiness'> = {
  objetivo: 'Conseguir clínicas dentales interesadas en SmileFlow',
  presupuestoTotal: 30000, periodoDias: 10,
  startAt: '2026-08-24T00:00:00.000Z', endAt: '2026-09-03T00:00:00.000Z', moneda: 'CLP',
  canalesSolicitados: ['google', 'meta'] as CanalId[],
  disponibilidad: DISPONIBILIDAD, intentSignals: SIGNALS, landingUrl: 'https://smileflow/#plans-trial', historicalCpa: null,
};
const EVIDENCIA = { impresiones: 1361, clics: 50, gasto: 30137, contactosReales: 0, capAutorizado: null, campaignStatus: 'PAUSED', moneda: 'CLP', terminos: TERMINOS } as const;

describe('readiness', () => {
  it('diagnosis_evidence_can_be_recorded (evaluación consume evidencia estructurada)', () => {
    const ev = evaluarReadiness(READINESS_OK);
    expect(ev.diagnosisCompleted).toBe(true);
    expect(ev.hardFunnelBlocker).toBe(false);
  });
  it('readiness UNKNOWN / incompleta ⇒ diagnóstico NO resuelto', () => {
    const ev = evaluarReadiness({ ...READINESS_OK, diagnosisCompletedAt: null });
    expect(ev.diagnosisCompleted).toBe(false);
  });
  it('check crítico FAIL ⇒ bloqueador duro', () => {
    const ev = evaluarReadiness({ ...READINESS_OK, firstPartyTracking: { status: 'FAIL' } });
    expect(ev.hardFunnelBlocker).toBe(true);
    expect(ev.bloqueadores).toContain('firstPartyTracking');
  });
});

describe('planner · diagnóstico RESUELTO ⇒ experimento operable (caso SmileFlow)', () => {
  const plan = construirMarketingPlan({ ...BASE, evidencia: { ...EVIDENCIA }, readiness: READINESS_OK });

  it('diagnosis_resolved_stops_repeat_audit_loop', () => {
    expect(plan.planStatus).toBe('READY_FOR_APPROVAL'); // ya NO vuelve a DIAGNOSIS_REQUIRED
    expect(plan.auditFunnel).toBe('NOT_REQUIRED');
  });
  it('planning_availability_is_separate_from_execution_availability', () => {
    const gPlan = plan.channelPlanningAvailability.find((c) => c.canal === 'google')!;
    const gExec = plan.channelExecutionAvailability.find((c) => c.canal === 'google')!;
    expect(gPlan.canPlan).toBe(true);
    expect(gExec.canExecute).toBe(false);
    expect(gExec.executionGate).toBe('ADVERTISER_VERIFICATION_PENDING');
  });
  it('google_verification_pending_allows_planning + blocks_execution', () => {
    expect(plan.executionStatus).toBe('EXTERNAL_GATE_BLOCKED');
    const g = plan.recommendedChannelMix.find((m) => m.canal === 'google')!;
    expect(g.presupuesto).toBeGreaterThan(0); // se PLANIFICA con presupuesto
  });
  it('planner_selects_one_primary_hypothesis + preserves_backlog', () => {
    expect(plan.selectedHypothesis).not.toBeNull();
    expect(plan.backlogHypotheses.length).toBeGreaterThan(0);
    // Con landing/tracking/mobile PASS + intención no-compradora, la hipótesis primaria es de targeting.
    expect(plan.selectedHypothesis!.category).toBe('TARGETING_INTENT');
  });
  it('planner_uses_current_readiness_not_stale_hypotheses (checks PASS bajan su hipótesis)', () => {
    const friction = plan.backlogHypotheses.find((h) => h.category === 'FRICTION')!;
    expect(friction.evidenceStrength).toBe('LOW'); // landing+tracking PASS ⇒ fricción poco probable
  });
  it('resolved_diagnosis_generates_campaign_draft', () => {
    expect(plan.campaigns.length).toBeGreaterThanOrEqual(1);
    expect(plan.campaigns[0]!.channel).toBe('google');
    expect(plan.campaigns[0]!.hypothesisId).toBe(plan.selectedHypothesis!.id);
  });
  it('keyword_strategy_is_operationalized', () => {
    const acciones = new Set(plan.keywordDecisions.map((d) => d.action));
    expect(plan.keywordDecisions.length).toBeGreaterThan(0);
    expect(acciones.has('EXCLUDE')).toBe(true); // deriva de herramientas técnicas
    const keywordsTotal = plan.campaigns[0]!.adGroups.reduce((a, g) => a + g.keywords.length, 0);
    expect(keywordsTotal).toBeGreaterThan(0);
  });
  it('negative_strategy_is_operationalized', () => {
    expect(plan.campaigns[0]!.negativeKeywords.length).toBeGreaterThan(0);
    expect(plan.campaigns[0]!.negativeKeywords.some((n) => /exocad|cariogram/i.test(n.text))).toBe(true);
  });
  it('campaign_contains_ads_and_destination', () => {
    expect(plan.campaigns[0]!.ads.length).toBeGreaterThan(0);
    expect(plan.campaigns[0]!.ads[0]!.headlines.length).toBeGreaterThan(0);
    expect(plan.campaigns[0]!.finalDestination).toBe('https://smileflow/#plans-trial');
  });
  it('max_spend_without_contact_is_numeric', () => {
    expect(typeof plan.maxSpendWithoutContact.value).toBe('number');
    expect(plan.maxSpendWithoutContact.value).toBeGreaterThan(0);
    expect(plan.maxSpendWithoutContact.value).toBeLessThan(plan.totalAuthorizedBudget);
    expect(plan.maxSpendWithoutContact.rationale.length).toBeGreaterThan(0);
  });
  it('target_cpa_not_invented_without_evidence', () => {
    expect(plan.targetCpa.kind).toBe('UNDEFINED_INSUFFICIENT_EVIDENCE');
  });
  it('stop_rules_have_executable_thresholds', () => {
    const byId = Object.fromEntries(plan.stopCriteria.map((s) => [s.id, s]));
    expect(byId.STOP_BUDGET!.threshold).toBe(30000);
    expect(typeof byId.STOP_ZERO_CONVERSION!.threshold).toBe('number');
    expect(byId.STOP_ZERO_CONVERSION!.threshold).not.toBeNull();
    expect(byId.STOP_CPA!.enabled).toBe(false);
    expect(byId.STOP_CPA!.reason).toBe('INSUFFICIENT_EVIDENCE');
    expect(byId.STOP_PERIOD!.date).toBe('2026-09-03T00:00:00.000Z');
  });
  it('meta_unavailable_gets_zero_allocation + total never exceeds cap', () => {
    expect(plan.recommendedChannelMix.find((m) => m.canal === 'meta')!.presupuesto).toBe(0);
    const suma = plan.recommendedChannelMix.reduce((a, m) => a + m.presupuesto, 0);
    expect(suma).toBeLessThanOrEqual(30000);
    expect(plan.recommendedChannelMix.find((m) => m.canal === 'google')!.presupuesto).toBeGreaterThan(0);
  });
});

describe('envelope · draft fail-closed, sin ejecución real', () => {
  const plan = construirMarketingPlan({ ...BASE, evidencia: { ...EVIDENCIA }, readiness: READINESS_OK });
  const draft = construirEnvelopeDraft(plan, 'org-smileflow', 'plan:test');

  it('envelope_remains_draft (planificado google, ejecutable ninguno)', () => {
    expect(draft.status).toBe('DRAFT');
    expect(draft.approvedBy).toBeNull();
    expect(draft.allowedChannelsPlanned).toContain('google');
    expect(draft.executionEligibleChannels).toEqual([]);
  });
  it('no_provider_mutation + autonomous_real_remains_false (DRAFT ⇒ DENY)', () => {
    expect(AUTONOMOUS_REAL).toBe(false);
    const r = validateEnvelope({ canal: 'google', tipo: 'CREATE_CAMPAIGN' }, draft);
    expect(r.within).toBe(false);
    expect(r.deny).toBe('ENVELOPE_NOT_APPROVED');
  });
});

describe('planner · diagnóstico NO resuelto ⇒ sigue DIAGNOSIS_REQUIRED', () => {
  it('sin readiness y con 0 contactos tras gasto ⇒ diagnóstico requerido, sin draft', () => {
    const plan = construirMarketingPlan({ ...BASE, evidencia: { ...EVIDENCIA }, readiness: null });
    expect(plan.planStatus).toBe('DIAGNOSIS_REQUIRED');
    expect(plan.campaigns).toEqual([]);
    expect(plan.totalSpendRecommended).toBe(0);
  });
  it('readiness con bloqueador duro ⇒ diagnóstico requerido', () => {
    const plan = construirMarketingPlan({ ...BASE, evidencia: { ...EVIDENCIA }, readiness: { ...READINESS_OK, landing: { status: 'FAIL' } } });
    expect(plan.planStatus).toBe('DIAGNOSIS_REQUIRED');
  });
});
