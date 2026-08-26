/**
 * CAMPAIGN TOTAL BUDGET + POLÍTICA FINANCIERA FINAL (P0 PRE-2B). El experimento de búsqueda usa CAMPAIGN TOTAL
 * BUDGET (CUSTOM_PERIOD + total_amount_micros + explicitly_shared=false), NUNCA daily budget. La ventana comercial
 * arranca al ACTIVAR, no al crear el draft. ADJUST_DAILY_BUDGET desaparece; STOP_CAMPAIGN = status PAUSED explícito.
 * Cambiar el total budget exige nuevo canonicalPlanHash + nueva aprobación. Sin escrituras reales (flags false).
 */
import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { construirMarketingPlan, type EntradaMarketingPlan, type CanalId, type MarketingPlan } from '../src/campana/marketing-plan';
import type { ChannelAvailability } from '../src/campana/channel-availability';
import type { MarketingReadiness } from '../src/campana/diagnosis-evidence';
import { construirEnvelope, aprobar, activar, ACCIONES_EXPERIMENTO_BUSQUEDA } from '../src/campana/authorized-execution-envelope';
import { construirActionPlan, type ExecutionActionIntent } from '../src/campana/execution-intent';
import { traducir, montoAMicros, budgetCampaignTotal } from '../src/campana/google-translator';
import { fingerprintsDelPlan } from '../src/campana/material-fingerprint';
import { validateActionFinancialImpact } from '../src/campana/execution-engine';
import { ledgerCero } from '../src/campana/financial-ledger';
import { hashPlan } from '../src/campana/plan-hash';
import { EnvelopeService } from '../src/campana/envelope-service';
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
const entrada = (startAt: string, endAt: string, dias = 10): EntradaMarketingPlan => ({
  objetivo: 'Conseguir clínicas dentales interesadas en SmileFlow', presupuestoTotal: 30000, periodoDias: dias, startAt, endAt, moneda: 'CLP',
  canalesSolicitados: ['google', 'meta'] as CanalId[], disponibilidad: DISP,
  evidencia: { impresiones: 1361, clics: 50, gasto: 30137, contactosReales: 0, capAutorizado: null, campaignStatus: 'PAUSED', moneda: 'CLP', terminos: [{ termino: 'administracion clinica dental', impresiones: 300, clics: 12 }, { termino: 'dentalink precios', impresiones: 160, clics: 9 }, { termino: 'exocad', impresiones: 50, clics: 1 }] },
  readiness: READY, historicalCpa: null,
});
const PLAN = construirMarketingPlan(entrada(T0, '2026-09-04T00:00:00.000Z'));
const ENV = construirEnvelope(PLAN, ORG, 'plan:x', T0).envelope;
const INTENTS = construirActionPlan(PLAN, ENV, 'CUST-1', T0);
const cc = INTENTS.find((i) => i.actionType === 'CREATE_CAMPAIGN')!;
const budgetDe = (i: ExecutionActionIntent): Record<string, unknown> => (i.providerPayload!.fields as { budget: Record<string, unknown> }).budget;

describe('§20 CAMPAIGN TOTAL BUDGET', () => {
  it('search_campaign_uses_campaign_total_budget', () => {
    expect(PLAN.campaigns[0]!.budgetPolicy.type).toBe('CAMPAIGN_TOTAL');
    expect((cc.providerPayload!.fields as { budgetPolicy: string }).budgetPolicy).toBe('CAMPAIGN_TOTAL');
    expect(budgetDe(cc).operation).toBe('campaign_budget.create');
    expect(cc.providerPayload!.operation).toBe('campaign.create');
  });
  it('campaign_total_budget_period_is_custom_period', () => {
    expect(budgetDe(cc).period).toBe('CUSTOM_PERIOD');
  });
  it('campaign_total_budget_uses_total_amount_micros', () => {
    expect(budgetDe(cc).totalAmountMicros).toBe(15_000_000_000); // 15000 CLP
  });
  it('campaign_total_budget_does_not_set_amount_micros (daily)', () => {
    const claves = Object.keys(budgetDe(cc));
    expect(claves).not.toContain('amountMicros');
    expect(claves).not.toContain('amount_micros');
    expect(claves).not.toContain('dailyAmountMicros');
  });
  it('campaign_total_budget_is_not_shared', () => {
    expect(budgetDe(cc).explicitlyShared).toBe(false);
  });
  it('15000_clp_converts_to_15000000000_micros + fail_closed', () => {
    expect(montoAMicros(15000, 'CLP', 'CLP')).toBe(15_000_000_000);
    expect(() => montoAMicros(15000, 'USD', 'CLP')).toThrow(/CURRENCY_MISMATCH/);
    expect(() => montoAMicros(1500.5, 'CLP', 'CLP')).toThrow(/BUDGET_AMOUNT_INVALID/);
    expect(() => montoAMicros(0, 'CLP', 'CLP')).toThrow(/BUDGET_AMOUNT_INVALID/);
    expect(() => montoAMicros(-1, 'CLP', 'CLP')).toThrow(/BUDGET_AMOUNT_INVALID/);
  });
  it('total_budget_cannot_exceed_experiment_cap + total_budget_cannot_exceed_envelope_cap', () => {
    const LED = ledgerCero(30000, 15000, 30137);
    expect(cc.financialImpact.commitment).toBeLessThanOrEqual(ENV.experimentBudget);
    expect(cc.financialImpact.commitment).toBeLessThanOrEqual(ENV.totalCap);
    expect(validateActionFinancialImpact(cc, LED, ENV).ok).toBe(true);
    expect(validateActionFinancialImpact({ ...cc, financialImpact: { commitment: 16000, scope: 'EXPERIMENT' } }, LED, ENV).reason).toBe('EXPERIMENT_CAP_WOULD_BE_EXCEEDED');
    expect(validateActionFinancialImpact({ ...cc, financialImpact: { commitment: 31000, scope: 'ENVELOPE' } }, LED, ENV).reason).toBe('TOTAL_CAP_WOULD_BE_EXCEEDED');
  });
  it('budget_mode_conflict_fails_closed', () => {
    // Un modo de presupuesto no soportado (p.ej. daily) falla cerrado; el guard nunca emite ambos modos.
    expect(() => budgetCampaignTotal({ type: 'DAILY' as never, totalAmount: 15000, currency: 'CLP', durationDays: 10 }, 'CLP')).toThrow(/BUDGET_MODE_UNSUPPORTED/);
    expect(() => traducir({ actionType: 'CREATE_CAMPAIGN', customerId: 'C', currency: 'CLP', material: { name: 'x', campaignType: 'SEARCH', objective: 'LEADS' } })).toThrow(/SIN_BUDGET_POLICY/);
  });
  it('campaign_total_budget_fingerprint_is_deterministic + sensible al monto', () => {
    const fp1 = fingerprintsDelPlan(PLAN).campaign;
    const fp2 = fingerprintsDelPlan(construirMarketingPlan(entrada('2026-08-25T00:01:42.000Z', '2026-09-04T00:01:42.000Z'))).campaign;
    expect(fp1).toBe(fp2); // determinista ante timestamps distintos
    const otro = JSON.parse(JSON.stringify(PLAN)) as MarketingPlan;
    (otro.campaigns[0]!.budgetPolicy as { totalAmount: number }).totalAmount = 12000;
    expect(fingerprintsDelPlan(otro).campaign).not.toBe(fp1); // sensible al monto total
  });
});

describe('§21 PERÍODO DESDE ACTIVACIÓN', () => {
  it('draft_creation_does_not_start_execution_period', () => {
    expect(ENV.startsAt).toBeNull();
    expect(ENV.expiresAt).toBeNull();
    expect(ENV.authorizedDurationDays).toBe(10);
  });
  it('human_approval_does_not_start_execution_period_when_external_gate_blocked', () => {
    const wait = aprobar(ENV, PLAN, 'humano', T0, []).envelope; // gate externo bloqueado ⇒ APPROVED_WAITING
    expect(wait.status).toBe('APPROVED_WAITING_EXTERNAL_GATE');
    expect(wait.startsAt).toBeNull();
    expect(wait.expiresAt).toBeNull();
  });
  it('activation_starts_execution_period + execution_period_is_10_days_from_activation', () => {
    const ready = aprobar(ENV, PLAN, 'humano', T0, ['google']).envelope;
    const AT = '2026-09-10T00:00:00.000Z';
    const act = activar(ready, AT).envelope;
    expect(act.status).toBe('ACTIVE');
    expect(act.startsAt).toBe(AT);
    expect(act.expiresAt).toBe('2026-09-20T00:00:00.000Z'); // AT + 10 días
    expect(act.activatedAt).toBe(AT);
    // STOP_PERIOD se resuelve a la fecha de fin de la ventana real.
    expect(act.stopRules.find((s) => s.tipo === 'PERIOD')?.date).toBe('2026-09-20T00:00:00.000Z');
  });
  it('execution_absolute_dates_do_not_change_canonical_hash', () => {
    const b = construirMarketingPlan(entrada('2026-08-25T00:01:42.000Z', '2026-09-04T00:01:42.000Z'));
    expect(hashPlan(b)).toBe(hashPlan(PLAN));
  });
  it('duration_days_change_changes_canonical_hash', () => {
    const b = construirMarketingPlan(entrada(T0, '2026-09-01T00:00:00.000Z', 7));
    expect(hashPlan(b)).not.toBe(hashPlan(PLAN));
  });
});

describe('§22 ACTION POLICY', () => {
  it('adjust_daily_budget_not_authorized_for_total_budget_campaign', () => {
    expect(ACCIONES_EXPERIMENTO_BUSQUEDA).not.toContain('ADJUST_DAILY_BUDGET');
    expect(ENV.authorizedActionTypes).not.toContain('ADJUST_DAILY_BUDGET');
    expect(ENV.authorizedActionTypes.length).toBe(9);
    // ADJUST_DAILY_BUDGET no es traducible (no hay daily que ajustar).
    expect(traducir({ actionType: 'ADJUST_DAILY_BUDGET', customerId: 'C', currency: 'CLP', material: {} })).toBeNull();
  });
  it('stop_campaign_translates_explicitly_to_paused + never_removes_campaign', () => {
    const p = traducir({ actionType: 'STOP_CAMPAIGN', customerId: 'C', currency: 'CLP', material: {} })!;
    expect(p.operation).toBe('campaign.mutate');
    expect((p.fields as { status: string }).status).toBe('PAUSED');
    expect((p.fields as { experimentStatus: string }).experimentStatus).toBe('STOPPED');
    expect(JSON.stringify(p).toLowerCase()).not.toMatch(/remove|delete/);
  });
  it('pause_campaign_translates_to_paused', () => {
    const p = traducir({ actionType: 'PAUSE_CAMPAIGN', customerId: 'C', currency: 'CLP', material: {} })!;
    expect(p.operation).toBe('campaign.mutate');
    expect((p.fields as { status: string }).status).toBe('PAUSED');
  });
  it('resume_campaign_remains_unauthorized', () => {
    expect(ACCIONES_EXPERIMENTO_BUSQUEDA).not.toContain('RESUME_CAMPAIGN');
    expect(ENV.authorizedActionTypes).not.toContain('RESUME_CAMPAIGN');
  });
});

describe('§23 REVISIÓN (cambio de total budget)', () => {
  const planConTotal = (total: number): MarketingPlan => {
    const p = JSON.parse(JSON.stringify(PLAN)) as MarketingPlan;
    (p.campaigns[0]!.budgetPolicy as { totalAmount: number }).totalAmount = total;
    return p;
  };
  it('total_budget_change_requires_new_plan_hash', () => {
    expect(hashPlan(planConTotal(12000))).not.toBe(hashPlan(PLAN));
  });
  it('old_envelope_superseded + new_ready_for_human_approval + not_approved + old_approval_not_inherited', async () => {
    const store = new InMemoryEventStore();
    const svc = new EnvelopeService(store);
    const e1 = await svc.crearDesdePlan(ORG, PLAN, 'plan:v1', T0);
    await svc.aprobar(ORG, 'humano', PLAN, '2026-08-25T02:00:00.000Z', []); // aprobación del sobre viejo
    const e2 = await svc.crearDesdePlan(ORG, planConTotal(12000), 'plan:v2', '2026-08-25T03:00:00.000Z');
    expect(e2.id).not.toBe(e1.id);                       // new_budget_policy_creates_new_plan_hash
    expect(e2.status).toBe('READY_FOR_HUMAN_APPROVAL');  // new_envelope_is_ready_for_human_approval
    expect(e2.approvedBy).toBeNull();                    // old_approval_is_not_inherited
    const sup = (await svc.auditoria(ORG)).find((a) => a.type === 'ENVELOPE_SUPERSEDED');
    expect(sup?.previousEnvelopeId).toBe(e1.id);         // old_envelope_is_superseded
    expect(sup?.newEnvelopeId).toBe(e2.id);
  });
});
