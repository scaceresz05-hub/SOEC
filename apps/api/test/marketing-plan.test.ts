/**
 * MARKETING PLAN + ENVELOPE (puros). Caso real SmileFlow ⇒ DIAGNOSIS_REQUIRED / DO_NOT_SPEND_YET, y las
 * invariantes de soberanía (nunca exceder el tope humano; sobre en DRAFT no habilita escritura real).
 */
import { describe, expect, it } from 'vitest';
import { construirMarketingPlan, type EntradaMarketingPlan, type CanalId } from '../src/campana/marketing-plan';
import { construirEnvelopeDraft, validateEnvelope, evaluarStopRules } from '../src/campana/execution-envelope';

const SMILEFLOW_EVIDENCIA = { impresiones: 1361, clics: 50, gasto: 30137, contactosReales: 0, capAutorizado: null, campaignStatus: 'PAUSED', moneda: 'CLP' } as const;
const BASE: Omit<EntradaMarketingPlan, 'evidencia'> = {
  objetivo: 'Conseguir clínicas interesadas en SmileFlow',
  presupuestoTotal: 30000,
  periodoDias: 10,
  startAt: '2026-08-23T00:00:00.000Z',
  endAt: '2026-09-02T00:00:00.000Z',
  moneda: 'CLP',
  canalesSolicitados: ['google', 'meta'] as CanalId[],
  disponibilidad: { google: true, meta: false }, // Meta DORMANT (gate externo)
};

describe('marketing-plan · caso SmileFlow (gasto real + 0 contactos ⇒ diagnóstico)', () => {
  const plan = construirMarketingPlan({ ...BASE, evidencia: { ...SMILEFLOW_EVIDENCIA } });

  it('status = DIAGNOSIS_REQUIRED y NO reactiva ni asigna gasto', () => {
    expect(plan.status).toBe('DIAGNOSIS_REQUIRED');
    expect(plan.totalSpendRecommended).toBe(0);
    expect(plan.spendRecommendation).toBe('0 CLP UNTIL DIAGNOSIS');
    expect(plan.auditFunnel).toBe('REQUIRED');
    expect(plan.campaigns).toEqual([]);
    expect(plan.recommendedChannelMix.every((m) => m.presupuesto === 0)).toBe(true);
  });

  it('separa hechos de hipótesis y define criterios + stop rules', () => {
    expect(plan.reasoning.facts.join(' ')).toContain('30137');
    expect(plan.reasoning.hypotheses.length).toBeGreaterThanOrEqual(6);
    expect(plan.successCriteria.length).toBeGreaterThan(0);
    expect(plan.stopCriteria.some((s) => s.tipo === 'BUDGET')).toBe(true);
    expect(plan.requiredTracking.length).toBeGreaterThan(0);
  });

  it('sum(channelBudgets) <= HUMAN_TOTAL_CAP', () => {
    const suma = plan.recommendedChannelMix.reduce((a, m) => a + m.presupuesto, 0);
    expect(suma).toBeLessThanOrEqual(plan.totalAuthorizedBudget);
  });
});

describe('marketing-plan · caso sano (con contactos) ⇒ READY_FOR_AUTHORIZATION', () => {
  const plan = construirMarketingPlan({ ...BASE, evidencia: { ...SMILEFLOW_EVIDENCIA, contactosReales: 8 } });

  it('asigna sólo a canales disponibles; Meta DORMANT = 0', () => {
    expect(plan.status).toBe('READY_FOR_AUTHORIZATION');
    const google = plan.recommendedChannelMix.find((m) => m.canal === 'google')!;
    const meta = plan.recommendedChannelMix.find((m) => m.canal === 'meta')!;
    expect(google.presupuesto).toBeGreaterThan(0);
    expect(meta.presupuesto).toBe(0);
    expect(meta.disponible).toBe(false);
  });

  it('nunca excede el tope humano y produce borradores para el canal asignado', () => {
    const suma = plan.recommendedChannelMix.reduce((a, m) => a + m.presupuesto, 0);
    expect(suma).toBeLessThanOrEqual(30000);
    expect(plan.campaigns.some((c) => c.canal === 'google')).toBe(true);
    expect(plan.campaigns.some((c) => c.canal === 'meta')).toBe(false);
  });
});

describe('execution-envelope · draft + validación fail-closed + stop rules', () => {
  const plan = construirMarketingPlan({ ...BASE, evidencia: { ...SMILEFLOW_EVIDENCIA, contactosReales: 8 } });
  const draft = construirEnvelopeDraft(plan, 'org-smileflow', 'plan:test');

  it('el sobre nace en DRAFT, sin aprobar', () => {
    expect(draft.status).toBe('DRAFT');
    expect(draft.approvedBy).toBeNull();
    expect(draft.totalBudget).toBe(30000);
  });

  it('DRY-RUN: un sobre DRAFT DENIEGA toda acción real (ACTION_WITHIN_ENVELOPE=false)', () => {
    const r = validateEnvelope({ canal: 'google', tipo: 'CREATE_CAMPAIGN' }, draft);
    expect(r.within).toBe(false);
    expect(r.deny).toBe('ENVELOPE_NOT_APPROVED');
  });

  it('aprobado: permite dentro del sobre, DENIEGA fuera de presupuesto/canal/período', () => {
    const aprobado = { ...draft, status: 'APPROVED' as const, approvedBy: 'humano', approvedAt: '2026-08-23T00:00:00.000Z' };
    expect(validateEnvelope({ canal: 'google', tipo: 'CREATE_CAMPAIGN', spendAfter: 100 }, aprobado).within).toBe(true);
    expect(validateEnvelope({ canal: 'google', tipo: 'CREATE_CAMPAIGN', spendAfter: 30001 }, aprobado).deny).toBe('BUDGET_EXCEEDED');
    expect(validateEnvelope({ canal: 'meta', tipo: 'CREATE_CAMPAIGN' }, aprobado).deny).toBe('CHANNEL_NOT_ALLOWED');
    expect(validateEnvelope({ canal: 'google', tipo: 'CREATE_CAMPAIGN', at: '2026-09-30T00:00:00.000Z' }, aprobado).deny).toBe('PERIOD_ENDED');
  });

  it('stop rules: presupuesto agotado SIEMPRE detiene; período/tracking/landing/cpa', () => {
    const aprobado = { ...draft, status: 'ACTIVE' as const };
    expect(evaluarStopRules(aprobado, { spend: 30000, contacts: 0 }).stop).toBe(true);
    expect(evaluarStopRules(aprobado, { spend: 15000, contacts: 0, zeroConversionFraccion: 0.5 }).disparadas.some((r) => r.tipo === 'ZERO_CONVERSION')).toBe(true);
    expect(evaluarStopRules(aprobado, { spend: 100, contacts: 1, trackingHealthy: false }).disparadas.some((r) => r.tipo === 'TRACKING')).toBe(true);
    expect(evaluarStopRules(aprobado, { spend: 100, contacts: 1, landingAvailable: false }).disparadas.some((r) => r.tipo === 'LANDING')).toBe(true);
    expect(evaluarStopRules(aprobado, { spend: 100, contacts: 1, cpa: 9999, cpaThreshold: 5000 }).disparadas.some((r) => r.tipo === 'CPA')).toBe(true);
    expect(evaluarStopRules(aprobado, { spend: 100, contacts: 1, now: '2026-09-30T00:00:00.000Z' }).disparadas.some((r) => r.tipo === 'PERIOD')).toBe(true);
    expect(evaluarStopRules(aprobado, { spend: 100, contacts: 1 }).stop).toBe(false);
  });
});
