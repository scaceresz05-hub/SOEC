/**
 * CIERRE PRE-2B — REGENERACIÓN del envelope final. Un envelope LEGACY (df90, schema anterior, nunca aprobado) al
 * regenerar el plan canónico vigente queda SUPERSEDED y nace una revisión nueva READY_FOR_HUMAN_APPROVAL,
 * approved=false, con CAMPAIGN_TOTAL + authorizedDurationDays=10 + 9 acciones (sin ADJUST_DAILY_BUDGET) y ventana
 * de ejecución sin resolver. No hereda approvedBy/approvedAt. Sin escrituras de proveedor.
 */
import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { ActorId, OrganizationId, type Attribution, type EventStore, type RequestContext } from '@soec/contracts';
import { construirMarketingPlan, type EntradaMarketingPlan, type CanalId } from '../src/campana/marketing-plan';
import type { ChannelAvailability } from '../src/campana/channel-availability';
import type { MarketingReadiness } from '../src/campana/diagnosis-evidence';
import { EnvelopeService, EVENTO_ENVELOPE, envelopeStreamId } from '../src/campana/envelope-service';
import type { AuthorizedExecutionEnvelope } from '../src/campana/authorized-execution-envelope';
import { ORG_SMILEFLOW as ORG } from '../src/plataforma';

const T = '2026-08-25T00:00:00.000Z';
const ATR: Attribution = { source: 't', purpose: 't', assumptions: [], claimType: 'observational', regime: 'empirical', uncertainty: 'baja' };
const ctx = (org: string): RequestContext => ({ organizationId: OrganizationId(org), actor: ActorId('seed'), scope: { organizationId: OrganizationId(org), permissions: ['events:append', 'events:read'] }, correlationId: 'c' });
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

/** Envelope LEGACY equivalente a df90 (schema anterior): sin authorizedDurationDays, con ADJUST_DAILY_BUDGET, fechas absolutas. */
const LEGACY: Record<string, unknown> = {
  id: 'env:org-smileflow:df90b634b13b9bda', organizationId: ORG, objective: entrada.objetivo, planId: 'plan:legacy', planHash: 'df90b634b13b9bda', planVersion: 'df90b634',
  currency: 'CLP', totalCap: 30000, experimentBudget: 15000, maxSpendWithoutContact: 7500,
  startsAt: T, expiresAt: '2026-09-04T00:00:00.000Z', plannedChannels: ['google'], authorizedChannels: ['google'],
  authorizedActionTypes: ['CREATE_CAMPAIGN', 'CREATE_AD_GROUP', 'CREATE_AD', 'ADD_KEYWORD', 'ADD_NEGATIVE_KEYWORD', 'PAUSE_CAMPAIGN', 'RESUME_CAMPAIGN', 'ADJUST_DAILY_BUDGET', 'PAUSE_AD_GROUP', 'PAUSE_KEYWORD', 'STOP_CAMPAIGN'],
  stopRules: [], trackingRequirements: [], status: 'READY_FOR_HUMAN_APPROVAL', approvedBy: null, approvedAt: null, activatedAt: null, stoppedAt: null, revokedAt: null, createdAt: T, updatedAt: T,
};

async function seedLegacy(store: EventStore): Promise<void> {
  const c = ctx(ORG);
  const prev = await store.readStream(c, envelopeStreamId(ORG));
  await store.append(c, envelopeStreamId(ORG), prev.length, [{ type: EVENTO_ENVELOPE, payload: LEGACY, attribution: ATR, occurredAt: T }]);
}

describe('regeneración del envelope final (cierre PRE-2B)', () => {
  it('regeneration_supersedes_legacy_envelope + regeneration_creates_new_unapproved_envelope', async () => {
    const store = new InMemoryEventStore();
    await seedLegacy(store);
    const svc = new EnvelopeService(store);
    expect((await svc.leerUltimo(ORG))?.id).toBe(LEGACY.id); // parte del legacy

    const plan = construirMarketingPlan(entrada);
    const nuevo = await svc.crearDesdePlan(ORG, plan, `plan:${ORG}:${T}`, '2026-08-26T00:00:00.000Z');

    // Nuevo envelope: hash distinto de df90, READY, no aprobado, no hereda aprobación.
    expect(nuevo.planHash).not.toBe('df90b634b13b9bda');
    expect(nuevo.id).not.toBe(LEGACY.id);
    expect(nuevo.status).toBe('READY_FOR_HUMAN_APPROVAL');
    expect(nuevo.approvedBy).toBeNull();
    expect(nuevo.approvedAt).toBeNull();

    // Modelo vigente materializado.
    expect(nuevo.authorizedDurationDays).toBe(10);
    expect(nuevo.startsAt).toBeNull();
    expect(nuevo.expiresAt).toBeNull();
    expect(nuevo.authorizedActionTypes.length).toBe(9);
    expect(nuevo.authorizedActionTypes).not.toContain('ADJUST_DAILY_BUDGET');
    expect(nuevo.authorizedActionTypes).not.toContain('RESUME_CAMPAIGN');
    expect(nuevo.totalCap).toBe(30000);
    expect(nuevo.experimentBudget).toBe(15000);
    expect(nuevo.maxSpendWithoutContact).toBe(7500);

    // Auditoría de supersesión enlaza old→new.
    const sup = (await svc.auditoria(ORG)).find((a) => a.type === 'ENVELOPE_SUPERSEDED');
    expect(sup?.previousEnvelopeId).toBe(LEGACY.id);
    expect(sup?.newEnvelopeId).toBe(nuevo.id);
    expect(sup?.reason).toBe('MATERIAL_PLAN_CHANGED');

    // leerUltimo devuelve la nueva revisión (last-wins).
    expect((await svc.leerUltimo(ORG))?.id).toBe(nuevo.id);
    // El estado legacy quedó registrado como SUPERSEDED (evidencia histórica preservada).
    const estados = (await store.readStream(ctx(ORG), envelopeStreamId(ORG))).filter((e) => e.type === EVENTO_ENVELOPE).map((e) => e.payload as AuthorizedExecutionEnvelope);
    expect(estados.some((e) => e.id === LEGACY.id && e.status === 'SUPERSEDED')).toBe(true);
  });
});
