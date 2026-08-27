/**
 * FASE 2B — ENTRY POINT del CANARY REAL (wiring). Bloquea el contexto y delega en el ejecutor Phase2B existente.
 * Con SUPERVISED_REAL=false ⇒ DENY antes del proveedor (0 writes). Contexto/hash incorrectos ⇒ DENY. Con todos
 * los gates abiertos (test) llega al ejecutor real; reserva antes del provider; aislamiento histórico; idempotencia.
 */
import { describe, expect, it } from 'vitest';
import { construirMarketingPlan, type EntradaMarketingPlan, type CanalId } from '../src/campana/marketing-plan';
import type { ChannelAvailability } from '../src/campana/channel-availability';
import type { MarketingReadiness } from '../src/campana/diagnosis-evidence';
import { construirEnvelope, aprobar, type ProviderState, type FlagsEjecucion } from '../src/campana/authorized-execution-envelope';
import { ledgerCero } from '../src/campana/financial-ledger';
import { ejecutarCanary, CONTEXTO_CANARY, type ContextoCanary } from '../src/campana/canary-execution';
import { GoogleAdsRealMutatePort, PuertoEscrituraNoConfigurada, type GoogleAdsApiClient, type GoogleAdsOperation } from '../src/campana/google-ads-real-port';
import { ORG_SMILEFLOW as ORG } from '../src/plataforma';

const T = '2026-08-27T00:00:00.000Z';
const CUSTOMER = '8605539300';
const HIST_CAMPAIGN = '24120966895'; // campaña histórica que NUNCA debe aparecer en el grafo
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
const ENV = aprobar(construirEnvelope(PLAN, ORG, 'plan:x', T).envelope, PLAN, 'humano', T, ['google']).envelope;
const LED = ledgerCero(30000, 15000, 30137);
const provReady: ProviderState = { executionEligibleChannels: ['google'], providerConnected: true, trackingValid: true, landingAvailable: true, now: '2026-08-28T00:00:00Z', contacts: 1 };
const SUP = (supervisedReal: boolean): FlagsEjecucion => ({ supervisedReal, autonomousReal: false });
// Contexto de test alineado al envelope de prueba (el productivo usa el default canónico).
const CTX: ContextoCanary = { org: ORG, envelopeId: ENV.id, planHash: ENV.planHash, customerId: CUSTOMER };

class FakeClient implements GoogleAdsApiClient {
  public ops: GoogleAdsOperation[] = [];
  async aplicar(op: GoogleAdsOperation): Promise<{ resourceName: string }> { this.ops.push(op); return { resourceName: `${op.resourceType}/${this.ops.length}` }; }
}
const base = (over: Partial<Parameters<typeof ejecutarCanary>[0]> = {}, client = new FakeClient()) => ({
  entradas: { org: ORG, customerId: CUSTOMER, envelope: ENV, plan: PLAN, ledger: LED, prov: provReady, flags: SUP(true), port: new GoogleAdsRealMutatePort(client), bindingsExistentes: [], ahora: T, ...over },
  client,
});

describe('CANARY entry point — contexto y gate maestro', () => {
  it('C+D: SUPERVISED_REAL=false ⇒ DENY (supervisedReal) SIN tocar proveedor', async () => {
    const { entradas, client } = base({ flags: SUP(false) });
    const r = await ejecutarCanary(entradas, CTX);
    expect(r.decision).toBe('DENY');
    expect(r.reason).toBe('SUPERVISED_REAL_DISABLED');
    expect(r.providerMutateCalls).toBe(0);
    expect(r.providerBindingsCreated).toBe(0);
    expect(client.ops.length).toBe(0);
  });

  it('B: envelopeId incorrecto ⇒ DENY ENVELOPE_ID_MISMATCH; planHash incorrecto ⇒ DENY PLAN_HASH_MISMATCH (0 writes)', async () => {
    const { entradas } = base();
    const r1 = await ejecutarCanary(entradas, { ...CTX, envelopeId: 'env:org-smileflow:0000000000000000' });
    expect(r1.decision).toBe('DENY');
    expect(r1.reason).toBe('ENVELOPE_ID_MISMATCH');
    const r2 = await ejecutarCanary(entradas, { ...CTX, planHash: 'deadbeefdeadbeef' });
    expect(r2.decision).toBe('DENY');
    expect(r2.reason).toBe('PLAN_HASH_MISMATCH');
    expect(r1.providerMutateCalls + r2.providerMutateCalls).toBe(0);
  });

  it('org/customer incorrectos ⇒ DENY', async () => {
    expect((await ejecutarCanary(base({ org: 'org-otra' }).entradas, CTX)).reason).toBe('CONTEXT_ORG_NOT_AUTHORIZED');
    expect((await ejecutarCanary(base({ customerId: '9999999999' }).entradas, CTX)).reason).toBe('CUSTOMER_ID_MISMATCH');
    expect((await ejecutarCanary(base({ envelope: null }).entradas, CTX)).reason).toBe('ENVELOPE_NOT_FOUND');
    expect((await ejecutarCanary(base({ plan: null }).entradas, CTX)).reason).toBe('PLAN_NOT_FOUND');
  });

  it('contexto por defecto (producción) rechaza un envelope no canónico ⇒ DENY (lock productivo)', async () => {
    const r = await ejecutarCanary(base().entradas); // sin CTX ⇒ CONTEXTO_CANARY real
    expect(r.decision).toBe('DENY');
    expect(r.reason).toBe('ENVELOPE_ID_MISMATCH'); // ENV de test ≠ env:...:842a5165b22c462d
    expect(CONTEXTO_CANARY.envelopeId).toBe('env:org-smileflow:842a5165b22c462d');
  });
});

describe('CANARY entry point — con gates abiertos delega en el ejecutor Phase2B', () => {
  it('E+F: envelope aprobado llega al ejecutor real; reserva financiera ANTES del primer provider write', async () => {
    const { entradas, client } = base();
    const r = await ejecutarCanary(entradas, CTX);
    expect(r.decision).toBe('EXECUTED');
    expect(r.trigger).toBe('FULL_APPROVED_PLAN');
    expect(r.providerMutateCalls).toBeGreaterThan(0);
    expect(client.ops[0]!.operation).toBe('campaign_budget.create'); // budget antes que campaign (mismo translator)
    const audit = r.execution!.audit;
    const iRes = audit.findIndex((e) => e.type === 'FINANCIAL_RESERVATION_CREATED');
    const iWrite = audit.findIndex((e) => e.type === 'PROVIDER_MUTATE_REQUESTED');
    expect(iRes).toBeGreaterThanOrEqual(0);
    expect(iWrite).toBeGreaterThan(iRes);
    expect(r.execution!.reservation).toEqual({ created: true, commitment: 15000 });
  });

  it('G: HISTORICAL_RESOURCE_REFERENCES = 0 (la campaña 24120966895 no aparece en el grafo ni en bindings)', async () => {
    const { entradas } = base();
    const r = await ejecutarCanary(entradas, CTX);
    expect(JSON.stringify(r.execution)).not.toContain(HIST_CAMPAIGN);
    expect(r.execution!.bindingsCreated.every((b) => b.envelopeId === ENV.id && b.providerResourceId !== HIST_CAMPAIGN)).toBe(true);
  });

  it('H: idempotencia — segunda corrida con bindings previos ⇒ 0 provider mutate', async () => {
    const primero = base();
    const r1 = await ejecutarCanary(primero.entradas, CTX);
    const segundo = base({ bindingsExistentes: r1.execution!.bindingsCreated });
    const r2 = await ejecutarCanary(segundo.entradas, CTX);
    expect(r2.providerMutateCalls).toBe(0);
    expect(segundo.client.ops.length).toBe(0);
    expect(r2.execution!.intents.every((x) => x.status === 'SKIPPED_IDEMPOTENT')).toBe(true);
  });

  it('CREATE_CAMPAIGN total budget real: CUSTOM_PERIOD + total_amount_micros 15000000000 + no daily', async () => {
    const { entradas, client } = base();
    await ejecutarCanary(entradas, CTX);
    const budget = client.ops.find((o) => o.operation === 'campaign_budget.create')!;
    expect((budget.fields as { period: string }).period).toBe('CUSTOM_PERIOD');
    expect((budget.fields as { totalAmountMicros: number }).totalAmountMicros).toBe(15_000_000_000);
    expect(JSON.stringify(client.ops).toLowerCase()).not.toContain('dailybudget');
  });

  it('puerto de escritura NO configurado falla cerrado si el gate lo permitiera', async () => {
    const { entradas } = base({ port: new PuertoEscrituraNoConfigurada() });
    const r = await ejecutarCanary(entradas, CTX);
    // gates abiertos + puerto no configurado ⇒ cada intent BLOCKED por PROVIDER_MUTATE_FAILED; 0 bindings, 0 gasto.
    expect(r.execution!.bindingsCreated.length).toBe(0);
    expect(r.execution!.intents.find((x) => x.actionType === 'CREATE_CAMPAIGN')!.reason).toBe('PROVIDER_MUTATE_FAILED');
  });
});
