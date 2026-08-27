/**
 * REPAIR EXTERNAL_GATE_BLOCKED — el gate externo deriva de la CONEXIÓN OAuth REAL (CONNECTED + cuenta), NO del
 * env estático ni de autonomousReal. Con supervisedReal=true + conexión lista + envelope aprobado ⇒ ALLOW aunque
 * autonomousReal=false. OAuth/cuenta/envelope siguen fail-closed. Read model (evaluarGateEnvelope) y executor
 * (evaluarBarreras) comparten la misma condición de gate externo. Sin provider real, 0 writes.
 */
import { describe, expect, it } from 'vitest';
import { construirMarketingPlan, type EntradaMarketingPlan, type CanalId } from '../src/campana/marketing-plan';
import type { ChannelAvailability } from '../src/campana/channel-availability';
import type { MarketingReadiness } from '../src/campana/diagnosis-evidence';
import { construirEnvelope, aprobar, type FlagsEjecucion } from '../src/campana/authorized-execution-envelope';
import { evaluarGateEnvelope, evaluarBarreras } from '../src/campana/execution-engine';
import { construirActionPlan } from '../src/campana/execution-intent';
import { ledgerCero } from '../src/campana/financial-ledger';
import { providerStateDeConexion, googleAdsListoParaEjecutar } from '../src/campana/provider-readiness';
import type { ConexionGoogleAds } from '../src/acquisition/google-ads-connection';
import { ORG_SMILEFLOW as ORG } from '../src/plataforma';

const T = '2026-08-27T00:00:00.000Z';
const NOW = '2026-08-28T00:00:00.000Z';
const conexion = (estado: string, customerId: string | null, needsReauth = false): ConexionGoogleAds =>
  ({ estado, customerId, needsReauth } as unknown as ConexionGoogleAds);
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
const PLAN = construirMarketingPlan(entrada);
const DRAFT = construirEnvelope(PLAN, ORG, 'plan:x', T).envelope;            // READY_FOR_HUMAN_APPROVAL (no aprobado)
const ENV = aprobar(DRAFT, PLAN, 'humano', T, ['google']).envelope;         // APPROVED_READY_TO_ACTIVATE
const provReady = providerStateDeConexion(conexion('CONNECTED', '8605539300'), NOW);
const provNoConn = providerStateDeConexion(null, NOW);
const SUP = (supervisedReal: boolean, autonomousReal = false): FlagsEjecucion => ({ supervisedReal, autonomousReal });

describe('provider-readiness (conexión REAL, no env/autonomía)', () => {
  it('CONNECTED + customerId + sin re-auth ⇒ listo', () => {
    expect(googleAdsListoParaEjecutar(conexion('CONNECTED', '8605539300'))).toBe(true);
    expect(provReady.providerConnected).toBe(true);
    expect(provReady.executionEligibleChannels).toContain('google');
  });
  it('no conectado / pendiente / re-auth / sin cuenta / null ⇒ NO listo (fail-closed)', () => {
    expect(googleAdsListoParaEjecutar(null)).toBe(false);
    expect(googleAdsListoParaEjecutar(conexion('ACCOUNT_SELECTION_PENDING', null))).toBe(false);
    expect(googleAdsListoParaEjecutar(conexion('NEEDS_REAUTH', '8605539300'))).toBe(false);
    expect(googleAdsListoParaEjecutar(conexion('CONNECTED', '8605539300', true))).toBe(false); // needsReauth
    expect(googleAdsListoParaEjecutar(conexion('CONNECTED', null))).toBe(false);                 // sin cuenta
    expect(provNoConn.providerConnected).toBe(false);
  });
});

describe('gate externo — supervised con autonomousReal=false', () => {
  it('B+C: SUPERVISED_REAL + conexión lista + envelope aprobado + autonomousReal=false ⇒ ALLOW', () => {
    const r = evaluarGateEnvelope(ENV, PLAN, provReady, SUP(true, false));
    expect(r.decision).toBe('ALLOW');
    expect(r.reasonCode).toBeNull();
  });
  it('C: autonomousReal=false NO bloquea la ejecución supervisada', () => {
    expect(evaluarGateEnvelope(ENV, PLAN, provReady, { supervisedReal: true, autonomousReal: false }).decision).toBe('ALLOW');
  });
  it('A: PILOT (supervisedReal=false) ⇒ DENY SUPERVISED_REAL_DISABLED', () => {
    expect(evaluarGateEnvelope(ENV, PLAN, provReady, SUP(false)).reasonCode).toBe('SUPERVISED_REAL_DISABLED');
  });
  it('D: OAuth no conectado ⇒ EXTERNAL_GATE_BLOCKED', () => {
    expect(evaluarGateEnvelope(ENV, PLAN, provNoConn, SUP(true)).reasonCode).toBe('EXTERNAL_GATE_BLOCKED');
  });
  it('E: cuenta no seleccionada (ACCOUNT_SELECTION_PENDING) ⇒ EXTERNAL_GATE_BLOCKED', () => {
    const prov = providerStateDeConexion(conexion('ACCOUNT_SELECTION_PENDING', null), NOW);
    expect(evaluarGateEnvelope(ENV, PLAN, prov, SUP(true)).reasonCode).toBe('EXTERNAL_GATE_BLOCKED');
  });
  it('F: envelope NO aprobado ⇒ ENVELOPE_NOT_APPROVED', () => {
    expect(evaluarGateEnvelope(DRAFT, PLAN, provReady, SUP(true)).reasonCode).toBe('ENVELOPE_NOT_APPROVED');
  });
  it('G: read model y executor comparten la misma condición de gate externo (misma prov ⇒ mismo reason)', () => {
    const cc = construirActionPlan(PLAN, ENV, 'CUST-1', T).find((i) => i.actionType === 'CREATE_CAMPAIGN')!;
    const LED = ledgerCero(30000, 15000, 30137);
    // sin conexión: ambos ⇒ EXTERNAL_GATE_BLOCKED
    expect(evaluarGateEnvelope(ENV, PLAN, provNoConn, SUP(true)).reasonCode).toBe('EXTERNAL_GATE_BLOCKED');
    expect(evaluarBarreras(cc, PLAN, ENV, LED, provNoConn, SUP(true), null).reasonCode).toBe('EXTERNAL_GATE_BLOCKED');
    // conexión lista + supervised: read model ALLOW; executor pasa el gate externo y llega a FLAGS (ALLOW con supervised true)
    expect(evaluarGateEnvelope(ENV, PLAN, provReady, SUP(true)).decision).toBe('ALLOW');
    expect(evaluarBarreras(cc, PLAN, ENV, LED, provReady, SUP(true), null).decision).toBe('ALLOW');
  });
});
