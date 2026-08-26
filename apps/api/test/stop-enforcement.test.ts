/**
 * FASE 2B — ENFORCEMENT determinista de STOP RULES sobre el envelope vigente. Sólo evalúa (no ejecuta): decide
 * qué reglas preautorizadas se disparan para que un canary futuro pueda PAUSAR/DETENER. STOP ⇒ status PAUSED.
 */
import { describe, expect, it } from 'vitest';
import { construirMarketingPlan, type EntradaMarketingPlan, type CanalId } from '../src/campana/marketing-plan';
import type { ChannelAvailability } from '../src/campana/channel-availability';
import type { MarketingReadiness } from '../src/campana/diagnosis-evidence';
import { construirEnvelope, activar, aprobar } from '../src/campana/authorized-execution-envelope';
import { evaluarStopVigente } from '../src/campana/stop-enforcement';
import { ORG_SMILEFLOW as ORG } from '../src/plataforma';

const T = '2026-08-25T00:00:00.000Z';
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
  objetivo: 'x', presupuestoTotal: 30000, periodoDias: 10, startAt: T, endAt: '2026-09-04T00:00:00.000Z', moneda: 'CLP',
  canalesSolicitados: ['google', 'meta'] as CanalId[], disponibilidad: DISP,
  evidencia: { impresiones: 1361, clics: 50, gasto: 30137, contactosReales: 0, capAutorizado: null, campaignStatus: 'PAUSED', moneda: 'CLP', terminos: [{ termino: 'administracion clinica dental', impresiones: 300, clics: 12 }, { termino: 'dentalink precios', impresiones: 160, clics: 9 }, { termino: 'exocad', impresiones: 50, clics: 1 }] },
  readiness: READY, historicalCpa: null,
};
const PLAN = construirMarketingPlan(entrada);
const ENV = construirEnvelope(PLAN, ORG, 'plan:x', T).envelope;
const sano = { spend: 0, contacts: 1, trackingValid: true, landingAvailable: true, now: '2026-08-27T00:00:00Z' };

describe('stop enforcement (determinista)', () => {
  it('nada dispara con métricas sanas', () => {
    expect(evaluarStopVigente(ENV, sano)).toEqual({ stop: false, firedRuleIds: [], action: null });
  });
  it('STOP_ZERO_CONVERSION: 7500 sin contacto ⇒ STOP_CAMPAIGN', () => {
    const d = evaluarStopVigente(ENV, { ...sano, contacts: 0, spend: 7500 });
    expect(d.stop).toBe(true);
    expect(d.firedRuleIds).toContain('STOP_ZERO_CONVERSION');
    expect(d.action).toBe('STOP_CAMPAIGN');
  });
  it('STOP_BUDGET: 30000 (tope absoluto) ⇒ STOP', () => {
    expect(evaluarStopVigente(ENV, { ...sano, spend: 30000 }).firedRuleIds).toContain('STOP_BUDGET');
  });
  it('STOP_TRACKING / STOP_LANDING', () => {
    expect(evaluarStopVigente(ENV, { ...sano, trackingValid: false }).firedRuleIds).toContain('STOP_TRACKING');
    expect(evaluarStopVigente(ENV, { ...sano, landingAvailable: false }).firedRuleIds).toContain('STOP_LANDING');
  });
  it('STOP_PERIOD no dispara antes de activar (ventana null); sí tras activar y pasar la fecha', () => {
    expect(evaluarStopVigente(ENV, { ...sano, now: '2027-01-01T00:00:00Z' }).firedRuleIds).not.toContain('STOP_PERIOD');
    const ready = aprobar(ENV, PLAN, 'h', T, ['google']).envelope;
    const activo = activar(ready, T).envelope; // expiresAt = T + 10 días
    expect(evaluarStopVigente(activo, { ...sano, now: '2027-01-01T00:00:00Z' }).firedRuleIds).toContain('STOP_PERIOD');
  });
});
