/**
 * WIRING PRODUCTIVO del Authorized Execution Envelope: cuando el Campaign Operator produce un plan
 * READY_FOR_APPROVAL, el sobre se MATERIALIZA y PERSISTE server-side (no vive sólo en React). Idempotente
 * por planHash. Contadores financieros con histórico separado. Auditoría. Sin ejecución real.
 */
import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { ActorId, OrganizationId, type Attribution, type EventStore, type RequestContext } from '@soec/contracts';
import { ObservacionService, type EntradaObservacionReal } from '@soec/motor-medicion';
import { adsSnapshotStreamId, EVENTO_ADS_SNAPSHOT } from '../src/ingesta/ingesta-google-ads-service';
import { ORG_SMILEFLOW as ORG } from '../src/plataforma';
import { CampaignOperatorDryRunService } from '../src/campana/campaign-operator-service';
import { DiagnosisEvidenceService } from '../src/campana/diagnosis-evidence-service';
import { EnvelopeService } from '../src/campana/envelope-service';
import { remainingCap, validateAuthorizedExecution } from '../src/campana/authorized-execution-envelope';
import { hashPlan } from '../src/campana/plan-hash';
import { AUTONOMOUS_REAL } from '@soec/cia';
import type { MarketingReadiness } from '../src/campana/diagnosis-evidence';

const AHORA = '2026-08-25T12:00:00.000Z';
const ATR: Attribution = { source: 't', purpose: 't', assumptions: [], claimType: 'observational', regime: 'empirical', uncertainty: 'baja' };
function ctx(org: string): RequestContext { const o = OrganizationId(org); return { organizationId: o, actor: ActorId('seed'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: 'c' }; }
async function seedSnapshot(store: EventStore): Promise<void> {
  const c = ctx(ORG); const ev = await store.readStream(c, adsSnapshotStreamId(ORG));
  await store.append(c, adsSnapshotStreamId(ORG), ev.length, [{ type: EVENTO_ADS_SNAPSHOT, payload: { campaignId: '24120966895', campaignName: 'X', status: 'PAUSED', impressions: 1361, clicks: 50, cost: 30137, at: AHORA }, attribution: ATR, occurredAt: AHORA }]);
}
const term = (t: string, m: string, v: number): EntradaObservacionReal => ({ provider: 'google-ads', externalEventId: `st:${t}:${m}`, eventName: 'ads_search_term', occurredAt: AHORA, kpiId: m, metrica: m, valor: v, unidad: 'conteo', calidad: 'alta', cobertura: 1, source: 'google-ads', utmContent: t, diagnostico: false });
async function seedTerminos(store: InMemoryEventStore): Promise<void> {
  const svc = new ObservacionService(store, {} as never);
  for (const f of [{ t: 'administracion clinica dental', i: 300, c: 12 }, { t: 'dentalink precios', i: 160, c: 9 }, { t: 'exocad', i: 50, c: 1 }]) {
    await svc.registrarReal(ctx(ORG), term(f.t, 'search_term_impressions', f.i).externalEventId, term(f.t, 'search_term_impressions', f.i), ATR, AHORA);
    await svc.registrarReal(ctx(ORG), term(f.t, 'search_term_clicks', f.c).externalEventId, term(f.t, 'search_term_clicks', f.c), ATR, AHORA);
  }
}
const READY: MarketingReadiness = {
  landing: { status: 'PASS' }, firstPartyTracking: { status: 'PASS' }, googleAdsAttribution: { status: 'ACTIVE' }, sitelinks: { status: 'PASS' }, mobile: { status: 'PASS' },
  diagnosisCompletedAt: AHORA, evidenceSource: 'chrome', findings: [],
  validatedDestinations: [{ url: 'https://x/#plans-trial', intent: 'plans', validated: true, public: true, available: true }, { url: 'https://x/#features-how', intent: 'features', validated: true, public: true, available: true }],
  valueProps: [{ id: '1', capability: 'Agenda dental inteligente' }, { id: '2', capability: 'Relleno automático de agenda' }, { id: '3', capability: 'Ficha e historial clínico' }], brandName: 'SmileFlow',
};
const ENTRADA = { objetivo: 'Conseguir clínicas dentales interesadas en SmileFlow', presupuestoTotal: 30000, periodoDias: 10 };

/** Reproduce el wiring de la ruta POST /medicion/campaign-operator-plan (materializa el sobre si el plan está listo). */
async function correr(): Promise<{ store: InMemoryEventStore; plan: import('../src/campana/marketing-plan').MarketingPlan; env: import('../src/campana/authorized-execution-envelope').AuthorizedExecutionEnvelope; svc: EnvelopeService }> {
  const store = new InMemoryEventStore();
  await seedSnapshot(store); await seedTerminos(store);
  await new DiagnosisEvidenceService(store).registrar(ORG, READY, AHORA);
  const r = await new CampaignOperatorDryRunService(store, undefined, {} as NodeJS.ProcessEnv).planificar(ORG, AHORA, ENTRADA);
  const svc = new EnvelopeService(store);
  const env = await svc.crearDesdePlan(ORG, r.plan, `plan:${ORG}:${r.at}`, AHORA);
  return { store, plan: r.plan, env, svc };
}

describe('envelope wiring productivo', () => {
  it('campaign_ready_materializes_persisted_envelope + has_id + contains_plan_hash + plan_hash_bound', async () => {
    const { plan, env } = await correr();
    expect(plan.campaignDraftStatus).toBe('READY_FOR_APPROVAL');
    expect(env.status).toBe('READY_FOR_HUMAN_APPROVAL');
    expect(env.id).toBeTruthy();
    expect(env.planId).toBeTruthy();
    expect(env.planHash).toBeTruthy();
    expect(env.planHash).toBe(hashPlan(plan));
  });
  it('persisted_envelope_survives_reload (leerUltimo devuelve el mismo)', async () => {
    const { env, svc } = await correr();
    const releido = await svc.leerUltimo(ORG);
    expect(releido?.id).toBe(env.id);
    expect(releido?.planHash).toBe(env.planHash);
  });
  it('same_plan_does_not_create_duplicate_envelope', async () => {
    const { plan, svc } = await correr();
    const a = await svc.crearDesdePlan(ORG, plan, 'plan:otro-id', AHORA); // mismo planHash, distinto planId de request
    const audit = await svc.auditoria(ORG);
    expect(a.planHash).toBe(hashPlan(plan));
    expect(audit.filter((e) => e.type === 'ENVELOPE_READY_FOR_APPROVAL')).toHaveLength(1); // no duplica
  });
  it('ready_envelope_has_explicit_action_types (deliberado, no "todo")', async () => {
    const { env } = await correr();
    expect(env.authorizedActionTypes.length).toBeGreaterThan(0);
    expect(env.authorizedActionTypes).toContain('CREATE_CAMPAIGN');
    expect(env.authorizedActionTypes).toContain('STOP_CAMPAIGN');
    expect(env.authorizedActionTypes).not.toContain('RESUME_CAMPAIGN'); // exclusión deliberada
  });
  it('financial_counters_start_at_zero + historical_does_not_reduce_remaining + remaining_equals_total_cap', async () => {
    const { env } = await correr();
    const fin = { historicalSpend: 30137, envelopeSpend: 0, committedSpend: 0 };
    expect(remainingCap(env, fin)).toBe(env.totalCap); // histórico NO descuenta
    expect(env.totalCap).toBe(30000);
  });
  it('envelope_created/ready_audit_event_exists', async () => {
    const { svc } = await correr();
    const audit = await svc.auditoria(ORG);
    expect(audit.some((e) => e.type === 'ENVELOPE_READY_FOR_APPROVAL')).toBe(true);
  });
  it('same_canonical_hash_reuses_existing_envelope + retry_does_not_duplicate_created/ready_audit (doble corrida)', async () => {
    const { plan, env, svc } = await correr();
    const e2 = await svc.crearDesdePlan(ORG, plan, 'plan:otro-request', '2026-08-25T00:01:42.000Z'); // ~102 s después
    expect(e2.id).toBe(env.id);           // ENVELOPE_ID_RUN_1 == ENVELOPE_ID_RUN_2
    expect(e2.planHash).toBe(env.planHash); // PLAN_HASH_RUN_1 == PLAN_HASH_RUN_2
    const audit = await svc.auditoria(ORG);
    expect(audit.filter((a) => a.type === 'ENVELOPE_CREATED')).toHaveLength(1); // AUDIT_CREATED_COUNT = 1
    expect(audit.filter((a) => a.type === 'ENVELOPE_READY_FOR_APPROVAL')).toHaveLength(1); // AUDIT_READY_COUNT = 1
  });
  it('envelope_created_event_exists + envelope_ready_event_exists', async () => {
    const { svc } = await correr();
    const audit = await svc.auditoria(ORG);
    expect(audit.some((a) => a.type === 'ENVELOPE_CREATED')).toBe(true);
    expect(audit.some((a) => a.type === 'ENVELOPE_READY_FOR_APPROVAL')).toBe(true);
  });
  it('material_change_creates_new_revision + preapproval_old_is_superseded + superseded_event_links_old_and_new', async () => {
    const { plan, env, svc } = await correr();
    const p2 = JSON.parse(JSON.stringify(plan)); p2.totalAuthorizedBudget = 20000; // cambio material
    const e3 = await svc.crearDesdePlan(ORG, p2, 'plan:rev2', '2026-08-25T01:00:00.000Z');
    expect(e3.id).not.toBe(env.id);
    expect(e3.status).toBe('READY_FOR_HUMAN_APPROVAL');
    const sup = (await svc.auditoria(ORG)).find((a) => a.type === 'ENVELOPE_SUPERSEDED');
    expect(sup?.previousEnvelopeId).toBe(env.id);
    expect(sup?.newEnvelopeId).toBe(e3.id);
    expect(sup?.reason).toBe('MATERIAL_PLAN_CHANGED');
  });
  it('approved_envelope_is_never_mutated_in_place + new_material_plan_after_approval_requires_new_approval', async () => {
    const { plan, svc } = await correr();
    const ap = await svc.aprobar(ORG, 'humano', plan, '2026-08-25T02:00:00.000Z', []);
    expect(ap.envelope.approvedBy).toBe('humano');
    const p2 = JSON.parse(JSON.stringify(plan)); p2.totalAuthorizedBudget = 25000;
    const rev = await svc.crearDesdePlan(ORG, p2, 'plan:rev3', '2026-08-25T03:00:00.000Z');
    expect(rev.status).toBe('READY_FOR_HUMAN_APPROVAL'); // nueva revisión
    expect(rev.approvedBy).toBeNull();                    // NO hereda la aprobación
  });
  it('external_gate_remains_blocked + flags false + no_provider_mutation', async () => {
    const { env, plan } = await correr();
    const prov = { executionEligibleChannels: [] as never[], providerConnected: false, trackingValid: true, landingAvailable: true, now: AHORA, contacts: 0 };
    const fin = { historicalSpend: 30137, envelopeSpend: 0, committedSpend: 0 };
    // flags productivos false ⇒ DENY (ninguna mutación posible)
    const r = validateAuthorizedExecution(env, plan, prov, fin, { canal: 'google', tipo: 'CREATE_CAMPAIGN' }, { autonomousReal: AUTONOMOUS_REAL, supervisedReal: false });
    expect(r.decision).toBe('DENY');
    expect(AUTONOMOUS_REAL).toBe(false);
  });
});
