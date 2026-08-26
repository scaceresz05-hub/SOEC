/**
 * AUTHORIZED EXECUTION ENVELOPE — soberanía financiera humana. Autorización global ligada al plan, tope total
 * inviolable, invalidación por cambio material, gates externos que mandan, revocación, idempotencia, auditoría
 * y validador central fail-closed. NINGUNA provider mutation real posible (flags en false).
 */
import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { construirMarketingPlan, type EntradaMarketingPlan, type CanalId } from '../src/campana/marketing-plan';
import type { ChannelAvailability } from '../src/campana/channel-availability';
import type { MarketingReadiness } from '../src/campana/diagnosis-evidence';
import {
  construirEnvelope, aprobar, revocar, revalidarActivacion, aprobacionVigente, validateAuthorizedExecution,
  remainingCap, auditoriaDenegacion, type ProviderState, type FinancialState, type FlagsEjecucion, type AccionSolicitada,
} from '../src/campana/authorized-execution-envelope';
import { hashPlan } from '../src/campana/plan-hash';
import { EnvelopeService } from '../src/campana/envelope-service';
import { ORG_SMILEFLOW as ORG } from '../src/plataforma';

const T0 = '2026-08-25T00:00:00.000Z';
const DISP: ChannelAvailability[] = [
  { canal: 'google', canPlan: true, canExecute: false, executionGate: 'ADVERTISER_VERIFICATION_PENDING' },
  { canal: 'meta', canPlan: false, canExecute: false, executionGate: 'PROVIDER_NOT_CONNECTED' },
];
const READY: MarketingReadiness = {
  landing: { status: 'PASS' }, firstPartyTracking: { status: 'PASS' }, googleAdsAttribution: { status: 'ACTIVE' },
  sitelinks: { status: 'PASS' }, mobile: { status: 'PASS' }, diagnosisCompletedAt: T0, evidenceSource: 'chrome', findings: [],
  validatedDestinations: [{ url: 'https://x/#plans-trial', intent: 'plans', validated: true, public: true, available: true }, { url: 'https://x/#features-how', intent: 'features', validated: true, public: true, available: true }],
  valueProps: [{ id: '1', capability: 'Agenda dental inteligente' }, { id: '2', capability: 'Relleno automático de agenda' }, { id: '3', capability: 'Ficha e historial clínico' }],
  brandName: 'SmileFlow',
};
const entrada = (presupuestoTotal: number): EntradaMarketingPlan => ({
  objetivo: 'Conseguir clínicas dentales interesadas en SmileFlow', presupuestoTotal, periodoDias: 10, startAt: T0, endAt: '2026-09-04T00:00:00.000Z', moneda: 'CLP',
  canalesSolicitados: ['google', 'meta'] as CanalId[], disponibilidad: DISP,
  evidencia: { impresiones: 1361, clics: 50, gasto: 30137, contactosReales: 0, capAutorizado: null, campaignStatus: 'PAUSED', moneda: 'CLP', terminos: [{ termino: 'administracion clinica dental', impresiones: 300, clics: 12 }, { termino: 'dentalink precios', impresiones: 160, clics: 9 }, { termino: 'exocad', impresiones: 50, clics: 1 }] },
  readiness: READY, historicalCpa: null,
});
const PLAN = construirMarketingPlan(entrada(30000));
const T1 = '2026-08-25T01:00:00.000Z';
const NOW = '2026-08-26T00:00:00.000Z';
const provOk: ProviderState = { executionEligibleChannels: ['google'], providerConnected: true, trackingValid: true, landingAvailable: true, now: NOW, contacts: 1 };
const provGate: ProviderState = { executionEligibleChannels: [], providerConnected: false, trackingValid: true, landingAvailable: true, now: NOW, contacts: 0 };
const finZero: FinancialState = { historicalSpend: 30137, envelopeSpend: 0, committedSpend: 0 };
const SUP = (supervisedReal: boolean, autonomousReal = false): FlagsEjecucion => ({ supervisedReal, autonomousReal });
const CREATE: AccionSolicitada = { canal: 'google', tipo: 'CREATE_CAMPAIGN' };
const draftReady = construirEnvelope(PLAN, ORG, 'plan:x', T0).envelope;
const aprobadoReady = aprobar(draftReady, PLAN, 'humano', T1, ['google']).envelope;
const aprobadoWaiting = aprobar(draftReady, PLAN, 'humano', T1, []).envelope;

describe('modelo + estados', () => {
  it('envelope_created_as_draft (plan incompleto ⇒ DRAFT; plan listo ⇒ READY_FOR_HUMAN_APPROVAL)', () => {
    const incompleto = construirMarketingPlan({ ...entrada(30000), readiness: { ...READY, valueProps: [] } });
    expect(construirEnvelope(incompleto, ORG, 'p', T0).envelope.status).toBe('DRAFT');
    expect(draftReady.status).toBe('READY_FOR_HUMAN_APPROVAL');
  });
  it('human_approval_records_actor_and_timestamp', () => {
    expect(aprobadoWaiting.approvedBy).toBe('humano');
    expect(aprobadoWaiting.approvedAt).toBe(T1);
  });
  it('approved_envelope_is_bound_to_plan_hash', () => {
    expect(draftReady.planHash).toBe(hashPlan(PLAN));
    expect(aprobacionVigente(aprobadoWaiting, PLAN)).toBe(true);
  });
  it('material_plan_change_invalidates_approval', () => {
    const PLAN2 = construirMarketingPlan(entrada(20000)); // cambia el tope ⇒ hash distinto
    expect(hashPlan(PLAN2)).not.toBe(hashPlan(PLAN));
    expect(aprobacionVigente(aprobadoReady, PLAN2)).toBe(false);
    expect(validateAuthorizedExecution(aprobadoReady, PLAN2, provOk, finZero, CREATE, SUP(true)).reasonCode).toBe('PLAN_HASH_MISMATCH');
  });
  it('approved_envelope_financial_fields_are_immutable', () => {
    expect(aprobadoWaiting.totalCap).toBe(draftReady.totalCap);
    expect(aprobadoWaiting.experimentBudget).toBe(draftReady.experimentBudget);
    expect(aprobadoWaiting.expiresAt).toBe(draftReady.expiresAt);
    expect(aprobadoWaiting.planHash).toBe(draftReady.planHash);
    expect(aprobadoWaiting.authorizedChannels).toEqual(draftReady.authorizedChannels);
  });
});

describe('soberanía financiera', () => {
  it('experiment_budget_cannot_exceed_total_cap + max_spend_without_contact_cannot_exceed_experiment_budget', () => {
    expect(draftReady.experimentBudget).toBeLessThanOrEqual(draftReady.totalCap);
    expect(draftReady.maxSpendWithoutContact).toBeLessThanOrEqual(draftReady.experimentBudget);
  });
  it('historical_spend_is_not_counted_as_envelope_spend', () => {
    // 30137 histórico pero envelopeSpend 0 ⇒ la acción NO excede el tope (histórico ignorado).
    const r = validateAuthorizedExecution(aprobadoReady, PLAN, provOk, { historicalSpend: 30137, envelopeSpend: 0, committedSpend: 0 }, { ...CREATE, commitment: 1000 }, SUP(true));
    expect(r.reasonCode).not.toBe('TOTAL_CAP_WOULD_BE_EXCEEDED');
    expect(remainingCap(aprobadoReady, finZero)).toBe(30000);
  });
  it('envelope_spend_never_exceeds_total_cap', () => {
    const r = validateAuthorizedExecution(aprobadoReady, PLAN, provOk, { historicalSpend: 0, envelopeSpend: 29000, committedSpend: 0 }, { ...CREATE, commitment: 2000 }, SUP(true));
    expect(r).toEqual({ decision: 'DENY', reasonCode: 'TOTAL_CAP_WOULD_BE_EXCEEDED' });
  });
  it('committed_spend_reserves_remaining_cap', () => {
    expect(remainingCap(aprobadoReady, { historicalSpend: 0, envelopeSpend: 5000, committedSpend: 10000 })).toBe(15000);
    const r = validateAuthorizedExecution(aprobadoReady, PLAN, provOk, { historicalSpend: 0, envelopeSpend: 5000, committedSpend: 24000 }, { ...CREATE, commitment: 2000 }, SUP(true));
    expect(r.reasonCode).toBe('TOTAL_CAP_WOULD_BE_EXCEEDED');
  });
});

describe('autorización de canal/acción y gates', () => {
  it('action_outside_authorized_types_is_denied', () => {
    expect(validateAuthorizedExecution(aprobadoReady, PLAN, provOk, finZero, { canal: 'google', tipo: 'DELETE_ACCOUNT' }, SUP(true)).reasonCode).toBe('ACTION_NOT_AUTHORIZED');
  });
  it('channel_outside_authorized_channels_is_denied', () => {
    expect(validateAuthorizedExecution(aprobadoReady, PLAN, provOk, finZero, { canal: 'meta', tipo: 'CREATE_CAMPAIGN' }, SUP(true)).reasonCode).toBe('CHANNEL_NOT_AUTHORIZED');
  });
  it('google_verification_pending_allows_human_approval + blocks_activation', () => {
    expect(aprobadoWaiting.status).toBe('APPROVED_WAITING_EXTERNAL_GATE'); // aprobación humana SÍ ocurre
    expect(aprobadoWaiting.approvedBy).toBe('humano');
    expect(validateAuthorizedExecution(aprobadoWaiting, PLAN, provGate, finZero, CREATE, SUP(true)).reasonCode).toBe('EXTERNAL_GATE_BLOCKED');
  });
  it('external_gate_cleared_requires_revalidation', () => {
    const r = revalidarActivacion(aprobadoWaiting, PLAN, provOk);
    expect(r.ok).toBe(true);
    expect(r.envelope.status).toBe('APPROVED_READY_TO_ACTIVATE');
    // si el plan cambió, la revalidación falla segura
    const PLAN2 = construirMarketingPlan(entrada(20000));
    expect(revalidarActivacion(aprobadoWaiting, PLAN2, provOk).envelope.status).toBe('FAILED_SAFE');
  });
  it('expired_envelope_cannot_activate', () => {
    expect(validateAuthorizedExecution(aprobadoReady, PLAN, { ...provOk, now: '2026-10-01T00:00:00Z' }, finZero, CREATE, SUP(true)).reasonCode).toBe('ENVELOPE_EXPIRED');
  });
  it('revoked_envelope_cannot_activate', () => {
    const rev = revocar(aprobadoReady, 'humano', T1).envelope;
    expect(rev.status).toBe('REVOKED');
    expect(validateAuthorizedExecution(rev, PLAN, provOk, finZero, CREATE, SUP(true)).reasonCode).toBe('ENVELOPE_REVOKED');
  });
  it('tracking_failure_blocks_execution + landing_failure_blocks_execution', () => {
    expect(validateAuthorizedExecution(aprobadoReady, PLAN, { ...provOk, trackingValid: false }, finZero, CREATE, SUP(true)).reasonCode).toBe('TRACKING_INVALID');
    expect(validateAuthorizedExecution(aprobadoReady, PLAN, { ...provOk, landingAvailable: false }, finZero, CREATE, SUP(true)).reasonCode).toBe('LANDING_INVALID');
  });
  it('zero_conversion_guardrail_blocks_execution', () => {
    expect(validateAuthorizedExecution(aprobadoReady, PLAN, { ...provOk, contacts: 0 }, { historicalSpend: 0, envelopeSpend: 7500, committedSpend: 0 }, CREATE, SUP(true)).reasonCode).toBe('ZERO_CONVERSION_GUARDRAIL');
  });
});

describe('flags maestros (fail-closed) + idempotencia + auditoría', () => {
  it('supervised_real_false_blocks_provider_execution', () => {
    expect(validateAuthorizedExecution(aprobadoReady, PLAN, provOk, finZero, CREATE, SUP(false)).reasonCode).toBe('SUPERVISED_REAL_DISABLED');
  });
  it('autonomous_real_false_blocks_provider_execution', () => {
    expect(validateAuthorizedExecution(aprobadoReady, PLAN, provOk, finZero, { ...CREATE, mode: 'AUTONOMOUS' }, SUP(true, false)).reasonCode).toBe('AUTONOMOUS_REAL_DISABLED');
  });
  it('approval_is_idempotent + revocation_is_idempotent', () => {
    const a2 = aprobar(aprobadoReady, PLAN, 'humano', '2026-08-25T02:00:00Z', ['google']);
    expect(a2.changed).toBe(false);
    const rev1 = revocar(aprobadoReady, 'humano', T1);
    const rev2 = revocar(rev1.envelope, 'humano', '2026-08-25T03:00:00Z');
    expect(rev2.changed).toBe(false);
  });
  it('audit_event_created_for_approval + audit_event_created_for_denial (servicio, tenant-scoped)', async () => {
    const store = new InMemoryEventStore();
    const svc = new EnvelopeService(store);
    await svc.crearDesdePlan(ORG, PLAN, 'plan:x', T0);
    const r1 = await svc.aprobar(ORG, 'humano', PLAN, T1, []);
    expect(r1.changed).toBe(true);
    const r2 = await svc.aprobar(ORG, 'humano', PLAN, '2026-08-25T04:00:00Z', []); // idempotente
    expect(r2.changed).toBe(false);
    const audit = await svc.auditoria(ORG);
    expect(audit.filter((a) => a.type === 'ENVELOPE_APPROVED')).toHaveLength(1);
    expect(auditoriaDenegacion(aprobadoWaiting, 'soec', NOW, 'EXTERNAL_GATE_BLOCKED').type).toBe('ACTION_DENIED');
    expect(await new EnvelopeService(store).leerUltimo('org-otra')).toBeNull(); // aislamiento de tenant
  });
});

describe('caso real SmileFlow (simulación, sin ejecución)', () => {
  it('antes de aprobación: READY_FOR_HUMAN_APPROVAL, no ejecutable', () => {
    expect(draftReady.status).toBe('READY_FOR_HUMAN_APPROVAL');
    expect(draftReady.approvedBy).toBeNull();
    expect(draftReady.totalCap).toBe(30000);
    expect(draftReady.experimentBudget).toBe(15000);
    expect(draftReady.maxSpendWithoutContact).toBe(7500);
    expect(draftReady.plannedChannels).toEqual(['google']);
    // en flujo productivo (flags false) ⇒ DENY
    expect(validateAuthorizedExecution(draftReady, PLAN, provGate, finZero, CREATE, SUP(false)).decision).toBe('DENY');
  });
  it('tras aprobación simulada: APPROVED_WAITING_EXTERNAL_GATE, google no ejecutable, real exec false', () => {
    expect(aprobadoWaiting.status).toBe('APPROVED_WAITING_EXTERNAL_GATE');
    expect(aprobadoWaiting.approvedBy).toBe('humano');
    // flags productivos false ⇒ ninguna mutación posible
    expect(validateAuthorizedExecution(aprobadoWaiting, PLAN, provGate, finZero, CREATE, SUP(false, false)).decision).toBe('DENY');
  });
});
