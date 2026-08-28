/**
 * REGRESIÓN CRÍTICA del incidente real: el canary real usaba el translator LEGACY por-servicio
 * (campaignBudgets:mutate ok → campaigns:mutate 400 con payload legacy), dejando un budget huérfano.
 * Este test EXIGE que el ejecutor real use EXACTAMENTE UNA GoogleAdsService.Mutate atómica (validateOnly=false,
 * partialFailure=false) y CERO llamadas por-servicio. Reproduce y previene el defecto.
 */
import { describe, expect, it } from 'vitest';
import { construirMarketingPlan, type EntradaMarketingPlan, type CanalId } from '../src/campana/marketing-plan';
import { construirEnvelope, aprobar, type ProviderState, type FlagsEjecucion } from '../src/campana/authorized-execution-envelope';
import { ledgerCero } from '../src/campana/financial-ledger';
import { GoogleAdsMutateHttpClient } from '../src/campana/google-ads-mutate-http';
import { ejecutarCanaryAtomico, envelopeYaEjecutado } from '../src/campana/canary-atomic-execution';
import { materializarGoogleAdsMutate, ventanaFechasDesdeActivacion } from '../src/campana/google-ads-materializer';
import { GEO_SMILEFLOW_V2, type GeoRegionResuelta } from '../src/campana/geo-policy';
import { ORG_SMILEFLOW as ORG } from '../src/plataforma';
import type { ChannelAvailability } from '../src/campana/channel-availability';
import type { MarketingReadiness } from '../src/campana/diagnosis-evidence';

const T = '2026-08-27T00:00:00.000Z';
const CUSTOMER = '8605539300';
const DISP: ChannelAvailability[] = [{ canal: 'google', canPlan: true, canExecute: false, executionGate: 'ADVERTISER_VERIFICATION_PENDING' }, { canal: 'meta', canPlan: false, canExecute: false, executionGate: 'PROVIDER_NOT_CONNECTED' }];
const READY: MarketingReadiness = {
  landing: { status: 'PASS' }, firstPartyTracking: { status: 'PASS' }, googleAdsAttribution: { status: 'ACTIVE' }, sitelinks: { status: 'PASS' }, mobile: { status: 'PASS' },
  diagnosisCompletedAt: T, evidenceSource: 'x', findings: [],
  validatedDestinations: [{ url: 'https://x/#plans-trial', intent: 'plans', validated: true, public: true, available: true }, { url: 'https://x/#features-how', intent: 'features', validated: true, public: true, available: true }],
  valueProps: [{ id: '1', capability: 'Agenda dental inteligente' }, { id: '2', capability: 'Relleno automático de agenda' }, { id: '3', capability: 'Ficha e historial clínico' }], brandName: 'SmileFlow',
};
const entrada: EntradaMarketingPlan = {
  objetivo: 'Conseguir clínicas dentales', presupuestoTotal: 30000, periodoDias: 10, startAt: T, endAt: '2026-09-04T00:00:00.000Z', moneda: 'CLP',
  canalesSolicitados: ['google'] as CanalId[], disponibilidad: DISP,
  evidencia: { impresiones: 1361, clics: 50, gasto: 30137, contactosReales: 0, capAutorizado: null, campaignStatus: 'PAUSED', moneda: 'CLP', terminos: [{ termino: 'agenda clinica dental', impresiones: 220, clics: 10 }, { termino: 'dentalink precios', impresiones: 160, clics: 9 }] },
  readiness: READY, historicalCpa: null,
};
const PLAN = construirMarketingPlan(entrada);
const ENV_APROBADO = aprobar(construirEnvelope(PLAN, ORG, `plan:${ORG}:${T}`, T).envelope, PLAN, 'humano', T, ['google']).envelope;
const PROV: ProviderState = { executionEligibleChannels: ['google'], providerConnected: true, trackingValid: true, landingAvailable: true, now: T, contacts: 1 };
const SUP = (supervisedReal: boolean): FlagsEjecucion => ({ supervisedReal, autonomousReal: false });
const CTX = { org: ORG, customerId: CUSTOMER, envelopeId: ENV_APROBADO.id, planHash: ENV_APROBADO.planHash };
const PER_SERVICE = /\/(campaignBudgets|campaigns|adGroups|adGroupAds|adGroupCriteria|campaignCriteria):mutate/;

// Cliente HTTP real con fetch FAKE que registra cada URL. geo suggest = lectura; googleAds:mutate = mutación.
function clienteFake(opts: { mutateOk: boolean } = { mutateOk: true }): { cliente: GoogleAdsMutateHttpClient; urls: string[]; mutateBody: () => Record<string, unknown> | null } {
  const urls: string[] = [];
  let mutateBodyRaw: string | null = null;
  const fetchFn = (async (url: string, init: RequestInit) => {
    urls.push(String(url));
    if (String(url).includes('googleAds:mutate')) mutateBodyRaw = init.body as string;
    if (String(url).includes('geoTargetConstants:suggest')) {
      const nombre = (JSON.parse(init.body as string) as { locationNames: { names: string[] } }).locationNames.names[0]!;
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => '', json: async () => ({ geoTargetConstantSuggestions: [{ geoTargetConstant: { id: `id-${nombre}`, name: nombre, canonicalName: `${nombre},Chile`, targetType: 'Region', countryCode: 'CL', status: 'ENABLED' } }] }) };
    }
    // googleAds:mutate
    const body = JSON.parse(init.body as string) as { mutateOperations: unknown[] };
    if (!opts.mutateOk) return { ok: false, status: 400, headers: { get: (k: string) => (k.toLowerCase() === 'request-id' ? 'REQ-FAIL' : null) }, text: async () => JSON.stringify({ error: { status: 'INVALID_ARGUMENT', details: [{ errors: [{ errorCode: { fieldError: 'REQUIRED' }, message: 'x', location: { fieldPathElements: [{ fieldName: 'mutate_operations', index: 1 }] } }] }] } }), json: async () => ({}) };
    // Formato REAL del aggregate googleAds:mutate: mutateOperationResponses[] con result por-tipo + resourceName.
    const mutateOperationResponses = body.mutateOperations.map((op, i) => { const tipo = Object.keys(op as Record<string, unknown>)[0]!.replace(/Operation$/, 'Result'); return { [tipo]: { resourceName: `customers/${CUSTOMER}/res/${i + 1}` } }; });
    return { ok: true, status: 200, headers: { get: (k: string) => (k.toLowerCase() === 'request-id' ? 'REQ-OK' : null) }, text: async () => JSON.stringify({ mutateOperationResponses }), json: async () => ({ mutateOperationResponses }) };
  }) as unknown as typeof fetch;
  const cliente = new GoogleAdsMutateHttpClient({ resolverAccessToken: async () => 'AT', developerToken: 'DT', loginCustomerId: '1742063041', fetchFn });
  return { cliente, urls, mutateBody: () => (mutateBodyRaw ? (JSON.parse(mutateBodyRaw) as Record<string, unknown>) : null) };
}

const entradas = (cliente: GoogleAdsMutateHttpClient, flags: FlagsEjecucion) => ({ org: ORG, customerId: CUSTOMER, envelope: ENV_APROBADO, plan: PLAN, ledger: ledgerCero(30000, 15000, 0), prov: PROV, flags, cliente, ahora: T });

describe('ejecutor canary ATÓMICO — un solo GoogleAdsService.Mutate', () => {
  it('§11: con gates abiertos ⇒ EXACTAMENTE 1 googleAds:mutate (validateOnly=false, partialFailure=false) y 0 per-service', async () => {
    const { cliente, urls, mutateBody } = clienteFake();
    const r = await ejecutarCanaryAtomico(entradas(cliente, SUP(true)), CTX);
    expect(r.decision).toBe('EXECUTED');
    expect(r.transport).toBe('GOOGLE_ADS_SERVICE_MUTATE_ATOMIC');
    expect(r.providerRequestCount).toBe(1);
    expect(urls.filter((u) => u.includes('googleAds:mutate'))).toHaveLength(1);
    // 0 llamadas al translator LEGACY por-servicio (el defecto exacto del incidente).
    expect(urls.filter((u) => PER_SERVICE.test(u))).toHaveLength(0);
    const body = mutateBody()!;
    expect(body.validateOnly).toBeUndefined();        // real: validateOnly ausente
    expect(body.partialFailure).toBe(false);          // atómico todo-o-nada
    expect((body.mutateOperations as unknown[]).length).toBe(r.operationCount);
  });

  it('§8: SUCCESS ⇒ bindings mapeados desde la respuesta REAL por índice (sin fabricar IDs)', async () => {
    const { cliente } = clienteFake();
    const r = await ejecutarCanaryAtomico(entradas(cliente, SUP(true)), CTX);
    expect(r.providerSucceeded).toBe(r.operationCount);
    expect(r.providerFailed).toBe(0);
    expect(r.bindings).toHaveLength(r.operationCount);
    expect(r.bindings[0]).toMatchObject({ operationIndex: 0, resourceName: `customers/${CUSTOMER}/res/1` });
    expect(r.bindings.every((b) => b.resourceName!.startsWith(`customers/${CUSTOMER}/res/`))).toBe(true);
  });

  it('§6: SUPERVISED_REAL=false ⇒ DENY antes del proveedor, 0 llamadas (ni geo ni mutate)', async () => {
    const { cliente, urls } = clienteFake();
    const r = await ejecutarCanaryAtomico(entradas(cliente, SUP(false)), CTX);
    expect(r.decision).toBe('DENY');
    expect(r.reason).toBe('SUPERVISED_REAL_DISABLED');
    expect(r.providerRequestCount).toBe(0);
    expect(urls).toHaveLength(0); // ni una sola llamada al proveedor
  });

  it('§9: FAILURE del mutate atómico ⇒ PROVIDER_FAILED, 0 bindings, sin auto-retry, errores/requestId preservados', async () => {
    const { cliente, urls } = clienteFake({ mutateOk: false });
    const r = await ejecutarCanaryAtomico(entradas(cliente, SUP(true)), CTX);
    expect(r.decision).toBe('PROVIDER_FAILED');
    expect(r.providerRequestCount).toBe(1); // sin auto-retry
    expect(urls.filter((u) => u.includes('googleAds:mutate'))).toHaveLength(1);
    expect(r.bindings).toHaveLength(0);
    expect(r.providerSucceeded).toBe(0);
    expect(r.requestId).toBe('REQ-FAIL');
    expect(r.googleErrors[0]?.errorCode).toBe('fieldError:REQUIRED');
  });

  it('anti-duplicado §1-§5: yaEjecutado ⇒ ALREADY_EXECUTED, 0 provider requests, grafo NO materializado, aun con supervisedReal=true', async () => {
    const { cliente, urls } = clienteFake();
    const r = await ejecutarCanaryAtomico({ ...entradas(cliente, SUP(true)), yaEjecutado: true }, CTX);
    expect(r.decision).toBe('DENY');
    expect(r.reason).toBe('ALREADY_EXECUTED');
    expect(r.providerRequestCount).toBe(0);
    expect(r.operationCount).toBe(0);
    expect(urls).toHaveLength(0); // 0 llamadas al proveedor (ni geo ni mutate)
  });
  it('anti-duplicado §6: yaEjecutado=false + gates abiertos ⇒ el executor corre normal (no bloquea planes nuevos)', async () => {
    const { cliente } = clienteFake();
    expect((await ejecutarCanaryAtomico({ ...entradas(cliente, SUP(true)), yaEjecutado: false }, CTX)).decision).toBe('EXECUTED');
  });
  it('envelopeYaEjecutado §1-§3: intento EXECUTED ⇒ true; campaign binding ⇒ true; sólo FAILED ⇒ false', () => {
    const envId = ENV_APROBADO.id;
    expect(envelopeYaEjecutado([{ outcome: 'EXECUTED' }], [], envId)).toBe(true);
    expect(envelopeYaEjecutado([], [{ envelopeId: envId, entityType: 'campaign' }], envId)).toBe(true);
    expect(envelopeYaEjecutado([{ outcome: 'PROVIDER_FAILED' }, { outcome: 'DENIED' }], [], envId)).toBe(false);
    expect(envelopeYaEjecutado([], [{ envelopeId: 'otro', entityType: 'campaign' }, { envelopeId: envId, entityType: 'keyword' }], envId)).toBe(false);
    expect(envelopeYaEjecutado([], [], envId)).toBe(false);
  });

  it('§12: validate y real comparten el MISMO materializador (sólo cambia validateOnly)', () => {
    const geo: GeoRegionResuelta[] = GEO_SMILEFLOW_V2.regiones.map((g) => ({ nombre: g.nombre, negativa: g.negativa, criterionId: `id-${g.nombre}`, canonicalName: '' }));
    const v = ventanaFechasDesdeActivacion('2026-09-01');
    const val = materializarGoogleAdsMutate(PLAN, GEO_SMILEFLOW_V2, geo, { customerId: CUSTOMER, ...v, validateOnly: true })!;
    const real = materializarGoogleAdsMutate(PLAN, GEO_SMILEFLOW_V2, geo, { customerId: CUSTOMER, ...v, validateOnly: false })!;
    expect(real.mutateOperations).toEqual(val.mutateOperations);
    expect(real.partialFailure).toBe(false);
    expect(val.validateOnly).toBe(true);
    expect(real.validateOnly).toBeUndefined();
  });
});
