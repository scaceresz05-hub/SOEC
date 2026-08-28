/**
 * apps/api · campana · EJECUTOR CANARY ATÓMICO (Google-native V2). Reemplaza el camino real LEGACY por-servicio
 * (construirActionPlan → ejecutarEnvelopeReal → GoogleAdsRealMutatePort.aplicar → campaignBudgets:mutate,
 * campaigns:mutate, …) por EXACTAMENTE la misma arquitectura que ya validó Google con validateOnly=true:
 *
 *   materializarGoogleAdsMutate(plan, geo, geoResueltas, { validateOnly:false })
 *     → GoogleAdsService.Mutate (UNA sola request, 61 ops, partialFailure=false)
 *
 * Fail-closed: el gate financiero/maestro (validateAuthorizedExecution) corre ANTES de cualquier llamada al
 * proveedor; sin SUPERVISED_REAL (o cualquier gate que falle) ⇒ 0 llamadas. Atomicidad total (partialFailure=false):
 * si Google rechaza una operación, TODO falla y no quedan recursos parciales. En éxito, los bindings se mapean
 * desde la respuesta REAL (sin fabricar IDs); en fallo, 0 bindings, 0 gasto, sin auto-retry, errores/requestId
 * preservados. Esta ruta es ESTRUCTURALMENTE incapaz de alcanzar el translator por-servicio legacy.
 */
import { GEO_SMILEFLOW_V2, type GeoPolicy } from './geo-policy';
import { materializarGoogleAdsMutate, ventanaFechasDesdeActivacion } from './google-ads-materializer';
import { resolverGeoRegiones } from './google-ads-write-runtime';
import type { GoogleAdsMutateHttpClient, GoogleAdsErrorDetalle } from './google-ads-mutate-http';
import { validateAuthorizedExecution, aprobacionVigente, type AuthorizedExecutionEnvelope, type ProviderState, type FlagsEjecucion, type FinancialState } from './authorized-execution-envelope';
import type { MarketingPlan } from './marketing-plan';
import type { FinancialLedger } from './financial-ledger';
import { CONTEXTO_CANARY, type ContextoCanary } from './canary-execution';

export const TRANSPORT_ATOMICO = 'GOOGLE_ADS_SERVICE_MUTATE_ATOMIC';

export interface BindingReal { readonly operationIndex: number; readonly resourceType: string; readonly resourceName: string | null }

export interface ResultadoCanaryAtomico {
  readonly decision: 'DENY' | 'EXECUTED' | 'PROVIDER_FAILED';
  readonly reason: string | null;
  readonly transport: typeof TRANSPORT_ATOMICO;
  readonly envelopeId: string | null;
  readonly planHash: string | null;
  /** Llamadas MUTATE al proveedor (0 si DENY antes del provider; 1 en el camino atómico). */
  readonly providerRequestCount: number;
  readonly operationCount: number;
  readonly resultsCount: number;
  readonly providerSucceeded: number;
  readonly providerFailed: number;
  readonly bindings: readonly BindingReal[];
  readonly requestId: string | null;
  readonly googleErrors: readonly GoogleAdsErrorDetalle[];
  readonly supervisedReal: boolean;
  readonly autonomousReal: boolean;
}

export interface EntradasCanaryAtomico {
  readonly org: string;
  readonly customerId: string;
  readonly envelope: AuthorizedExecutionEnvelope | null;
  readonly plan: MarketingPlan | null;
  readonly ledger: FinancialLedger;
  readonly prov: ProviderState;
  readonly flags: FlagsEjecucion;
  readonly cliente: GoogleAdsMutateHttpClient;
  readonly geoPolicy?: GeoPolicy;
  readonly ahora: string;
}

function denyA(reason: string, envelope: AuthorizedExecutionEnvelope | null, flags: FlagsEjecucion): ResultadoCanaryAtomico {
  return { decision: 'DENY', reason, transport: TRANSPORT_ATOMICO, envelopeId: envelope?.id ?? null, planHash: envelope?.planHash ?? null, providerRequestCount: 0, operationCount: 0, resultsCount: 0, providerSucceeded: 0, providerFailed: 0, bindings: [], requestId: null, googleErrors: [], supervisedReal: flags.supervisedReal, autonomousReal: flags.autonomousReal };
}

export async function ejecutarCanaryAtomico(e: EntradasCanaryAtomico, contexto: ContextoCanary = CONTEXTO_CANARY): Promise<ResultadoCanaryAtomico> {
  const geoPolicy = e.geoPolicy ?? GEO_SMILEFLOW_V2;
  // 1) Contexto: pines org/customer + integridad content-addressed del envelope + coherencia envelope↔plan + aprobado.
  if (e.org !== contexto.org) return denyA('CONTEXT_ORG_NOT_AUTHORIZED', e.envelope, e.flags);
  if (e.customerId !== contexto.customerId) return denyA('CUSTOMER_ID_MISMATCH', e.envelope, e.flags);
  if (!e.envelope) return denyA('ENVELOPE_NOT_FOUND', null, e.flags);
  if (!e.plan) return denyA('PLAN_NOT_FOUND', e.envelope, e.flags);
  if (e.envelope.id !== `env:${e.org}:${e.envelope.planHash}`) return denyA('ENVELOPE_ID_MISMATCH', e.envelope, e.flags);
  if (!aprobacionVigente(e.envelope, e.plan)) return denyA('PLAN_HASH_MISMATCH', e.envelope, e.flags);
  // 2) GATE financiero/maestro (fail-closed): SUPERVISED_REAL, aprobado, hash, canal/acción, gate externo, guardrails,
  //    tope total (histórico separado). Si cualquiera falla ⇒ 0 llamadas al proveedor.
  const fin: FinancialState = { historicalSpend: e.ledger.historicalSpend, envelopeSpend: e.ledger.envelopeSpend, committedSpend: e.ledger.committedSpend };
  const gate = validateAuthorizedExecution(e.envelope, e.plan, e.prov, fin, { canal: 'google', tipo: 'CREATE_CAMPAIGN', commitment: e.envelope.experimentBudget }, e.flags);
  if (gate.decision === 'DENY') return denyA(gate.reasonCode ?? 'DENY', e.envelope, e.flags);
  // 3) GEO real (lecturas SuggestGeoTargetConstants) — SÓLO tras ALLOW. En PILOT jamás se llega aquí.
  const geo = await resolverGeoRegiones(e.cliente, geoPolicy);
  if (geo.faltantes.length > 0) return denyA('GEO_UNRESOLVED', e.envelope, e.flags);
  // 4) Fechas contractuales (START=activación 00:00:00, END=+9d 23:59:59) + materialización Google-native REAL.
  const activacion = new Date(Date.parse(e.ahora)).toISOString().slice(0, 10);
  const { startDateTime, endDateTime } = ventanaFechasDesdeActivacion(activacion);
  const request = materializarGoogleAdsMutate(e.plan, geoPolicy, geo.resueltas, { customerId: e.customerId, startDateTime, endDateTime, validateOnly: false });
  if (!request) return denyA('MATERIALIZE_FAILED', e.envelope, e.flags);
  const opCount = request.mutateOperations.length;
  // 5) UNA sola GoogleAdsService.Mutate ATÓMICA (partialFailure=false, validateOnly=false).
  const r = await e.cliente.mutarGrafo(e.customerId, request);
  if (!r.ok) {
    // FAILURE: sin bindings, sin gasto, sin activar, sin auto-retry. Todo-o-nada ⇒ no hay recursos parciales.
    return { decision: 'PROVIDER_FAILED', reason: r.errorStatus ?? 'PROVIDER_MUTATE_FAILED', transport: TRANSPORT_ATOMICO, envelopeId: e.envelope.id, planHash: e.envelope.planHash, providerRequestCount: 1, operationCount: opCount, resultsCount: 0, providerSucceeded: 0, providerFailed: opCount, bindings: [], requestId: r.requestId, googleErrors: r.googleErrors, supervisedReal: e.flags.supervisedReal, autonomousReal: e.flags.autonomousReal };
  }
  // SUCCESS: cada resource name REAL se mapea a su operación por índice (sin fabricar IDs).
  const bindings: BindingReal[] = request.mutateOperations.map((op, i) => ({ operationIndex: i, resourceType: Object.keys(op)[0] ?? 'desconocida', resourceName: r.results[i]?.resourceName ?? null }));
  return { decision: 'EXECUTED', reason: null, transport: TRANSPORT_ATOMICO, envelopeId: e.envelope.id, planHash: e.envelope.planHash, providerRequestCount: 1, operationCount: opCount, resultsCount: r.resultsCount, providerSucceeded: r.resultsCount, providerFailed: 0, bindings, requestId: r.requestId, googleErrors: [], supervisedReal: e.flags.supervisedReal, autonomousReal: e.flags.autonomousReal };
}
