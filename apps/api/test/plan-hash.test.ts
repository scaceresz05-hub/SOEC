/**
 * CANONICAL PLAN HASH: mismo contenido MATERIAL ⇒ mismo hash (timestamps/IDs/orden no lo cambian);
 * cualquier cambio material sí lo cambia. Es la clave lógica de idempotencia del envelope.
 */
import { describe, expect, it } from 'vitest';
import { construirMarketingPlan, type EntradaMarketingPlan, type CanalId, type MarketingPlan } from '../src/campana/marketing-plan';
import { hashPlan, hashCanonical, canonicalizeMaterialPlan } from '../src/campana/plan-hash';
import { construirEnvelope } from '../src/campana/authorized-execution-envelope';
import type { MarketingReadiness } from '../src/campana/diagnosis-evidence';

const DISP = [
  { canal: 'google' as CanalId, canPlan: true, canExecute: false, executionGate: 'ADVERTISER_VERIFICATION_PENDING' as const },
  { canal: 'meta' as CanalId, canPlan: false, canExecute: false, executionGate: 'PROVIDER_NOT_CONNECTED' as const },
];
const READY: MarketingReadiness = {
  landing: { status: 'PASS' }, firstPartyTracking: { status: 'PASS' }, googleAdsAttribution: { status: 'ACTIVE' }, sitelinks: { status: 'PASS' }, mobile: { status: 'PASS' },
  diagnosisCompletedAt: '2026-08-25T00:00:00Z', evidenceSource: 'x', findings: [],
  validatedDestinations: [{ url: 'https://x/#plans-trial', intent: 'plans', validated: true, public: true, available: true }, { url: 'https://x/#features-how', intent: 'features', validated: true, public: true, available: true }],
  valueProps: [{ id: '1', capability: 'Agenda dental inteligente' }, { id: '2', capability: 'Relleno automático de agenda' }, { id: '3', capability: 'Ficha e historial clínico' }], brandName: 'SmileFlow',
};
const entrada = (cap: number, startAt: string, endAt: string, dias = 10): EntradaMarketingPlan => ({
  objetivo: 'Conseguir clínicas dentales interesadas en SmileFlow', presupuestoTotal: cap, periodoDias: dias, startAt, endAt, moneda: 'CLP',
  canalesSolicitados: ['google', 'meta'], disponibilidad: DISP,
  evidencia: { impresiones: 1361, clics: 50, gasto: 30137, contactosReales: 0, capAutorizado: null, campaignStatus: 'PAUSED', moneda: 'CLP', terminos: [{ termino: 'administracion clinica dental', impresiones: 300, clics: 12 }, { termino: 'dentalink precios', impresiones: 160, clics: 9 }, { termino: 'exocad', impresiones: 50, clics: 1 }] },
  readiness: READY, historicalCpa: null,
});
const A = construirMarketingPlan(entrada(30000, '2026-08-25T00:00:00.000Z', '2026-09-04T00:00:00.000Z'));
const clone = (p: MarketingPlan): MarketingPlan => JSON.parse(JSON.stringify(p)) as MarketingPlan;

describe('hash estable ante lo efímero', () => {
  it('same_material_plan_different_timestamp_same_hash', () => {
    // ~102 s después: startAt/endAt absolutos distintos, misma duración y contenido ⇒ mismo hash.
    const B = construirMarketingPlan(entrada(30000, '2026-08-25T00:01:42.000Z', '2026-09-04T00:01:42.000Z'));
    expect(hashPlan(B)).toBe(hashPlan(A));
  });
  it('same_material_plan_different_plan_id_same_hash + content-addressed envelope id', () => {
    const e1 = construirEnvelope(A, 'org-x', 'plan:req-1', '2026-08-25T00:00:00Z').envelope;
    const e2 = construirEnvelope(A, 'org-x', 'plan:req-2', '2026-08-25T00:01:42Z').envelope;
    expect(e1.planHash).toBe(e2.planHash);
    expect(e1.id).toBe(e2.id); // id deriva del hash, no del planId/timestamp
  });
  it('same_material_plan_reordered_set_arrays_same_hash', () => {
    const R = clone(A);
    (R.activeKeywords as unknown[]).reverse();
    (R.campaigns[0]!.negativeKeywords as unknown[]).reverse();
    (R.campaigns[0]!.adGroups[0]!.ads[0]!.headlines as unknown[]).reverse();
    expect(hashPlan(R)).toBe(hashPlan(A));
  });
});

describe('hash sensible al cambio material', () => {
  const diff = (mut: (p: MarketingPlan) => void, label: string): void => {
    it(label, () => { const P = clone(A); mut(P); expect(hashPlan(P)).not.toBe(hashPlan(A)); });
  };
  diff((p) => { (p as { totalAuthorizedBudget: number }).totalAuthorizedBudget = 20000; }, 'budget_change_changes_hash');
  diff((p) => { (p as { totalSpendRecommended: number }).totalSpendRecommended = 10000; }, 'experiment_budget_change_changes_hash');
  diff((p) => { (p.period as { dias: number }).dias = 7; }, 'period_duration_change_changes_hash');
  diff((p) => { (p.activeKeywords as unknown[]).push({ text: 'nuevo termino', matchType: 'PHRASE', action: 'TARGET', intentClassification: 'CLINIC_MANAGEMENT_INTENT', confidence: 'HIGH', rationale: 'r' }); }, 'keyword_change_changes_hash');
  diff((p) => { (p.activeKeywords[0] as { matchType: string }).matchType = 'EXACT'; }, 'keyword_match_type_change_changes_hash');
  diff((p) => { (p.campaigns[0]!.negativeKeywords as unknown[]).push({ text: 'zzz', matchType: 'PHRASE', rationale: 'r' }); }, 'negative_change_changes_hash');
  diff((p) => { (p.campaigns[0]!.adGroups[0]!.ads[0]!.headlines as string[]).push('Titular nuevo distinto'); }, 'ad_copy_change_changes_hash');
  diff((p) => { (p.campaigns[0]!.adGroups[0] as { finalDestination: string }).finalDestination = 'https://otro/#x'; }, 'destination_change_changes_hash');
  diff((p) => { (p.stopCriteria[0] as { threshold: number }).threshold = 99999; }, 'stop_rule_change_changes_hash');
  diff((p) => { (p.recommendedChannelMix.find((m) => m.canal === 'meta') as { presupuesto: number }).presupuesto = 1; }, 'channel_change_changes_hash');
  diff((p) => { (p as { objective: string }).objective = 'Otro objetivo totalmente distinto'; }, 'objective_change_changes_hash');

  it('authorized_action_change_changes_hash (la política participa del canonical)', () => {
    const canon = canonicalizeMaterialPlan(A);
    expect(hashCanonical(canon)).not.toBe(hashCanonical({ ...canon, authorizedActionPolicy: [...(canon.authorizedActionPolicy as string[]), 'RESUME_CAMPAIGN'] }));
  });
});
