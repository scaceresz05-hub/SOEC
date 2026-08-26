/**
 * FASE 2B — EJECUTOR REAL SUPERVISADO (camino crítico). La carretera existe pero la barrera sigue cerrada:
 * con gate externo bloqueado o SUPERVISED_REAL=false ⇒ 0 provider mutate. Con TODOS los gates abiertos (test),
 * el motor ejecuta en orden por dependencias, reserva el compromiso antes de la primera escritura, crea bindings
 * sólo tras éxito, es idempotente y falla cerrado. CAMPAIGN TOTAL BUDGET real; STOP/PAUSE = PAUSED; sin RESUME.
 */
import { describe, expect, it } from 'vitest';
import { construirMarketingPlan, type EntradaMarketingPlan, type CanalId } from '../src/campana/marketing-plan';
import type { ChannelAvailability } from '../src/campana/channel-availability';
import type { MarketingReadiness } from '../src/campana/diagnosis-evidence';
import { construirEnvelope, aprobar, type ProviderState, type FlagsEjecucion } from '../src/campana/authorized-execution-envelope';
import { construirActionPlan, type ExecutionActionIntent } from '../src/campana/execution-intent';
import { ledgerCero, construirLedger } from '../src/campana/financial-ledger';
import { ejecutarEnvelopeReal, ordenarPorDependencia } from '../src/campana/execution-real';
import { GoogleAdsRealMutatePort, type GoogleAdsApiClient, type GoogleAdsOperation } from '../src/campana/google-ads-real-port';
import { traducir, ShadowMutatePort } from '../src/campana/google-translator';
import { ACCIONES_EXPERIMENTO_BUSQUEDA } from '../src/campana/acciones';
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
  objetivo: 'Conseguir clínicas dentales interesadas en SmileFlow', presupuestoTotal: 30000, periodoDias: 10, startAt: T, endAt: '2026-09-04T00:00:00.000Z', moneda: 'CLP',
  canalesSolicitados: ['google', 'meta'] as CanalId[], disponibilidad: DISP,
  evidencia: { impresiones: 1361, clics: 50, gasto: 30137, contactosReales: 0, capAutorizado: null, campaignStatus: 'PAUSED', moneda: 'CLP', terminos: [{ termino: 'administracion clinica dental', impresiones: 300, clics: 12 }, { termino: 'dentalink precios', impresiones: 160, clics: 9 }, { termino: 'exocad', impresiones: 50, clics: 1 }] },
  readiness: READY, historicalCpa: null,
};
const PLAN = construirMarketingPlan(entrada);
const ENV = aprobar(construirEnvelope(PLAN, ORG, 'plan:x', T).envelope, PLAN, 'humano', T, ['google']).envelope; // APPROVED_READY_TO_ACTIVATE
const INTENTS = construirActionPlan(PLAN, ENV, 'CUST-1', T);
const provReady: ProviderState = { executionEligibleChannels: ['google'], providerConnected: true, trackingValid: true, landingAvailable: true, now: '2026-08-26T00:00:00Z', contacts: 1 };
const provBlocked: ProviderState = { executionEligibleChannels: [], providerConnected: false, trackingValid: true, landingAvailable: true, now: '2026-08-26T00:00:00Z', contacts: 0 };
const LED = ledgerCero(30000, 15000, 30137);
const SUP = (supervisedReal: boolean, autonomousReal = false): FlagsEjecucion => ({ supervisedReal, autonomousReal });

class FakeClient implements GoogleAdsApiClient {
  public ops: GoogleAdsOperation[] = [];
  constructor(private readonly failOn?: (op: GoogleAdsOperation) => boolean) {}
  async aplicar(op: GoogleAdsOperation): Promise<{ resourceName: string }> {
    if (this.failOn?.(op)) throw new Error('GOOGLE_API_ERROR');
    this.ops.push(op);
    return { resourceName: `${op.resourceType}/${this.ops.length}` };
  }
}
const correr = (prov: ProviderState, flags: FlagsEjecucion, intents = INTENTS, ledger = LED, failOn?: (op: GoogleAdsOperation) => boolean, bindingsExistentes: never[] = []) => {
  const client = new FakeClient(failOn);
  const port = new GoogleAdsRealMutatePort(client);
  return ejecutarEnvelopeReal({ plan: PLAN, env: ENV, intents, ledger, prov, flags, port, ahora: T, bindingsExistentes }).then((r) => ({ r, client }));
};

describe('§18 · gates cerrados ⇒ nunca muta', () => {
  it('approved_but_external_gate_blocked_never_mutates', async () => {
    const { r, client } = await correr(provBlocked, SUP(true));
    expect(r.providerMutateCalls).toBe(0);
    expect(client.ops.length).toBe(0);
    expect(r.bindingsCreated.length).toBe(0);
    expect(r.intents.every((x) => x.status === 'BLOCKED')).toBe(true);
    expect(r.intents.find((x) => x.actionType === 'CREATE_CAMPAIGN')!.reason).toBe('EXTERNAL_GATE_BLOCKED');
  });
  it('external_ready_but_supervised_false_never_mutates', async () => {
    const { r, client } = await correr(provReady, SUP(false));
    expect(r.providerMutateCalls).toBe(0);
    expect(client.ops.length).toBe(0);
    expect(r.intents.find((x) => x.actionType === 'CREATE_CAMPAIGN')!.reason).toBe('SUPERVISED_REAL_DISABLED');
  });
});

describe('§18 · gates abiertos ⇒ camino real (fake client)', () => {
  it('all_gates_ready_allows_provider_path + provider_binding_created_only_after_success', async () => {
    const { r, client } = await correr(provReady, SUP(true));
    expect(r.providerMutateCalls).toBeGreaterThan(0);
    expect(client.ops.length).toBeGreaterThan(0);
    expect(r.bindingsCreated.length).toBeGreaterThan(0);
    expect(r.intents.find((x) => x.actionType === 'CREATE_CAMPAIGN')!.status).toBe('EXECUTED');
    // binding sólo para acciones EXECUTED, todos con providerResourceId real y scoped a este envelope.
    expect(r.bindingsCreated.every((b) => b.providerResourceId && b.envelopeId === ENV.id && b.organizationId === ORG && b.planHash === ENV.planHash && b.channel === 'google')).toBe(true);
    // orden de auditoría: SUCCEEDED antes de BINDING_CREATED.
    const iOk = r.audit.findIndex((e) => e.type === 'PROVIDER_MUTATE_SUCCEEDED');
    const iBind = r.audit.findIndex((e) => e.type === 'PROVIDER_BINDING_CREATED');
    expect(iOk).toBeGreaterThanOrEqual(0);
    expect(iBind).toBeGreaterThan(iOk);
  });
  it('financial_reservation_precedes_first_provider_write', async () => {
    const { r } = await correr(provReady, SUP(true));
    const iRes = r.audit.findIndex((e) => e.type === 'FINANCIAL_RESERVATION_CREATED');
    const iWrite = r.audit.findIndex((e) => e.type === 'PROVIDER_MUTATE_REQUESTED');
    expect(iRes).toBeGreaterThanOrEqual(0);
    expect(iWrite).toBeGreaterThan(iRes);
    expect(r.reservation).toEqual({ created: true, commitment: 15000 });
  });
  it('failed_reservation_prevents_provider_write', async () => {
    const led = construirLedger({ totalCap: 30000, experimentBudget: 15000, historicalSpend: 30137, envelopeSpend: 0, committedSpend: 0, experimentSpend: 0, experimentCommittedSpend: 15000 });
    const { r, client } = await correr(provReady, SUP(true), INTENTS, led);
    expect(r.providerMutateCalls).toBe(0);
    expect(client.ops.length).toBe(0);
    expect(r.bindingsCreated.length).toBe(0);
    expect(r.intents.find((x) => x.actionType === 'CREATE_CAMPAIGN')!.status).toBe('BLOCKED');
  });
});

describe('§18 · orden y dependencias', () => {
  it('campaign_budget_created_before_campaign + campaign_total_budget_is_15000_total + no_daily_budget_provider_mutation', async () => {
    const { client } = await correr(provReady, SUP(true));
    expect(client.ops[0]!.operation).toBe('campaign_budget.create');
    expect(client.ops[1]!.operation).toBe('campaign.create');
    expect((client.ops[0]!.fields as { period: string }).period).toBe('CUSTOM_PERIOD');
    expect((client.ops[0]!.fields as { totalAmountMicros: number }).totalAmountMicros).toBe(15_000_000_000);
    expect((client.ops[0]!.fields as { explicitlyShared: boolean }).explicitlyShared).toBe(false);
    const json = JSON.stringify(client.ops).toLowerCase();
    expect(json).not.toContain('amount_micros"'); // sólo total_amount_micros → totalamountmicros
    expect(json).not.toContain('dailybudget');
    expect(json).not.toContain('averagedaily');
  });
  it('campaign_created_before_adgroups + adgroup_binding_required_before_ad/keyword', async () => {
    const { client } = await correr(provReady, SUP(true));
    const iCampaign = client.ops.findIndex((o) => o.operation === 'campaign.create');
    const iFirstAdGroup = client.ops.findIndex((o) => o.operation === 'ad_group.create');
    expect(iCampaign).toBeLessThan(iFirstAdGroup);
    // Cada ad y cada keyword referencia un adGroup ya creado (providerResourceId real inyectado).
    const ads = client.ops.filter((o) => o.operation === 'ad_group_ad.create');
    const kws = client.ops.filter((o) => o.operation === 'ad_group_criterion.create');
    expect(ads.length).toBeGreaterThan(0);
    expect(kws.length).toBeGreaterThan(0);
    expect(ads.every((o) => typeof (o.fields as { adGroup?: string }).adGroup === 'string')).toBe(true);
    expect(kws.every((o) => typeof (o.fields as { adGroup?: string }).adGroup === 'string')).toBe(true);
  });
  it('ordenarPorDependencia nunca coloca un hijo antes que su padre', () => {
    const orden = ordenarPorDependencia(INTENTS);
    const pos = (t: string): number => orden.findIndex((i) => i.actionType === t);
    expect(pos('CREATE_CAMPAIGN')).toBeLessThan(pos('CREATE_AD_GROUP'));
    expect(pos('CREATE_AD_GROUP')).toBeLessThan(pos('CREATE_AD'));
    expect(pos('CREATE_AD_GROUP')).toBeLessThan(pos('ADD_KEYWORD'));
  });
  it('ad_real_port_requires_parent_binding (sin providerResourceId del padre ⇒ fail-closed)', async () => {
    const port = new GoogleAdsRealMutatePort(new FakeClient());
    const adPayload = INTENTS.find((i) => i.actionType === 'CREATE_AD')!.providerPayload!;
    await expect(port.mutate(adPayload)).rejects.toThrow(/PARENT_PROVIDER_RESOURCE_NOT_BOUND/);
  });
});

describe('§18 · idempotencia, aislamiento histórico, fail-closed', () => {
  it('same_idempotency_key_never_creates_twice', async () => {
    const { r } = await correr(provReady, SUP(true));
    const client2 = new FakeClient();
    const port2 = new GoogleAdsRealMutatePort(client2);
    const r2 = await ejecutarEnvelopeReal({ plan: PLAN, env: ENV, intents: INTENTS, ledger: LED, prov: provReady, flags: SUP(true), port: port2, ahora: T, bindingsExistentes: r.bindingsCreated });
    expect(r2.providerMutateCalls).toBe(0);
    expect(client2.ops.length).toBe(0);
    expect(r2.bindingsCreated.length).toBe(0);
    expect(r2.intents.every((x) => x.status === 'SKIPPED_IDEMPOTENT')).toBe(true);
  });
  it('historical_campaign_cannot_be_mutated + cannot_be_bound (sin binding del envelope ⇒ ownership DENY)', async () => {
    const campaignIntent = INTENTS.find((i) => i.actionType === 'CREATE_CAMPAIGN')!;
    const pausarHistorica: ExecutionActionIntent = { ...campaignIntent, actionType: 'PAUSE_CAMPAIGN', providerPayload: traducir({ actionType: 'PAUSE_CAMPAIGN', customerId: 'CUST-1', currency: 'CLP', material: {} }) };
    const { r, client } = await correr(provReady, SUP(true), [pausarHistorica]);
    expect(r.providerMutateCalls).toBe(0);
    expect(client.ops.length).toBe(0);
    expect(r.bindingsCreated.length).toBe(0);
    expect(r.intents[0]!.reason).toBe('RESOURCE_NOT_OWNED_BY_ENVELOPE');
  });
  it('provider_failure_fails_closed (falla el budget ⇒ campaña BLOCKED y dependientes no continúan)', async () => {
    const { r } = await correr(provReady, SUP(true), INTENTS, LED, (op) => op.operation === 'campaign_budget.create');
    const cc = r.intents.find((x) => x.actionType === 'CREATE_CAMPAIGN')!;
    expect(cc.status).toBe('BLOCKED');
    expect(cc.reason).toBe('PROVIDER_MUTATE_FAILED');
    expect(r.bindingsCreated.length).toBe(0);
    // dependientes fail-closed: ningún hijo se ejecuta sin la campaña.
    expect(r.intents.filter((x) => x.actionType !== 'CREATE_CAMPAIGN').every((x) => x.status === 'BLOCKED')).toBe(true);
    expect(r.audit.some((e) => e.type === 'PROVIDER_MUTATE_FAILED')).toBe(true);
    expect(r.audit.some((e) => e.type === 'ACTION_EXECUTED')).toBe(false);
  });
});

describe('§18 · semántica de control + shadow inerte', () => {
  it('pause_translates_to_paused + stop_translates_to_paused_and_stopped + no_resume_action_exists', () => {
    expect((traducir({ actionType: 'PAUSE_CAMPAIGN', customerId: 'C', currency: 'CLP', material: {} })!.fields as { status: string }).status).toBe('PAUSED');
    const stop = traducir({ actionType: 'STOP_CAMPAIGN', customerId: 'C', currency: 'CLP', material: {} })!;
    expect((stop.fields as { status: string; experimentStatus: string }).status).toBe('PAUSED');
    expect((stop.fields as { experimentStatus: string }).experimentStatus).toBe('STOPPED');
    expect(traducir({ actionType: 'RESUME_CAMPAIGN', customerId: 'C', currency: 'CLP', material: {} })).toBeNull();
    expect(ACCIONES_EXPERIMENTO_BUSQUEDA).not.toContain('RESUME_CAMPAIGN');
  });
  it('shadow_mutate_port_sigue_inerte (nunca envía)', async () => {
    await expect(new ShadowMutatePort().mutate()).rejects.toThrow(/SHADOW/);
  });
});
