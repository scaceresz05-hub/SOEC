/**
 * apps/api · campana · ENTRY POINT del CANARY REAL (Fase 2B, wiring mínimo). Bloquea el CONTEXTO a UN único
 * envelope aprobado y delega en el EJECUTOR Phase2B EXISTENTE (`ejecutarEnvelopeReal`) — una sola fuente de
 * verdad: no duplica translator/finanzas/reserva/idempotencia/dependencias/adapter/bindings.
 *
 * El scope de ejecución es FULL_APPROVED_PLAN (el contrato real ya implementado; NO se inventa un "canary mode"
 * de un solo intent). Fail-closed: cualquier desviación de contexto ⇒ DENY, y con SUPERVISED_REAL=false se
 * DENIEGA ANTES de tocar el proveedor (0 provider mutate, 0 bindings, 0 gasto). No genera envelope ni recalcula
 * hash ni re-simula.
 */
import { construirActionPlan } from './execution-intent';
import { ejecutarEnvelopeReal, type ResultadoEjecucionReal } from './execution-real';
import { aprobacionVigente, type AuthorizedExecutionEnvelope, type ProviderState, type FlagsEjecucion } from './authorized-execution-envelope';
import type { MarketingPlan } from './marketing-plan';
import type { FinancialLedger } from './financial-ledger';
import type { GoogleAdsMutatePort } from './google-translator';
import type { ProviderResourceBinding } from './resource-binding';

/** CONTEXTO AUTORIZADO ÚNICO (canónico, human-approved). El entry point productivo SÓLO opera con estos valores. */
export const CONTEXTO_CANARY = {
  org: 'org-smileflow',
  envelopeId: 'env:org-smileflow:842a5165b22c462d',
  planHash: '842a5165b22c462d',
  customerId: '8605539300',
} as const;
export type ContextoCanary = typeof CONTEXTO_CANARY;

export type CanaryDenyReason =
  | 'CONTEXT_ORG_NOT_AUTHORIZED' | 'CUSTOMER_ID_MISMATCH' | 'ENVELOPE_NOT_FOUND'
  | 'ENVELOPE_ID_MISMATCH' | 'PLAN_HASH_MISMATCH' | 'ENVELOPE_NOT_APPROVED'
  | 'PLAN_NOT_FOUND' | 'SUPERVISED_REAL_DISABLED';

const APROBADOS = new Set(['APPROVED_WAITING_EXTERNAL_GATE', 'APPROVED_READY_TO_ACTIVATE', 'ACTIVE']);

export interface EntradasCanary {
  readonly org: string;
  readonly customerId: string;
  readonly envelope: AuthorizedExecutionEnvelope | null;
  readonly plan: MarketingPlan | null;
  readonly ledger: FinancialLedger;
  readonly prov: ProviderState;
  readonly flags: FlagsEjecucion;
  readonly port: GoogleAdsMutatePort;
  readonly bindingsExistentes?: readonly ProviderResourceBinding[];
  readonly ahora: string;
}

export interface ResultadoCanary {
  readonly decision: 'DENY' | 'EXECUTED';
  readonly reason: CanaryDenyReason | null;
  readonly trigger: 'FULL_APPROVED_PLAN';
  readonly envelopeId: string | null;
  readonly planHash: string | null;
  readonly providerMutateCalls: number;
  readonly providerBindingsCreated: number;
  readonly execution: ResultadoEjecucionReal | null;
}

const deny = (reason: CanaryDenyReason, envelope: AuthorizedExecutionEnvelope | null): ResultadoCanary => ({
  decision: 'DENY', reason, trigger: 'FULL_APPROVED_PLAN',
  envelopeId: envelope?.id ?? null, planHash: envelope?.planHash ?? null,
  providerMutateCalls: 0, providerBindingsCreated: 0, execution: null,
});

/**
 * Ejecuta (o DENIEGA) el canary del PLAN COMPLETO aprobado. `contexto` por defecto = el canónico de producción;
 * los tests pueden inyectar uno propio para su envelope de prueba, pero el entry point productivo usa el default.
 */
export async function ejecutarCanary(e: EntradasCanary, contexto: ContextoCanary = CONTEXTO_CANARY): Promise<ResultadoCanary> {
  // 1) CONTEXTO FIJO (org · customer · envelopeId · planHash · aprobado). Cualquier desviación ⇒ DENY.
  if (e.org !== contexto.org) return deny('CONTEXT_ORG_NOT_AUTHORIZED', e.envelope);
  if (e.customerId !== contexto.customerId) return deny('CUSTOMER_ID_MISMATCH', e.envelope);
  if (!e.envelope) return deny('ENVELOPE_NOT_FOUND', null);
  if (e.envelope.id !== contexto.envelopeId) return deny('ENVELOPE_ID_MISMATCH', e.envelope);
  if (e.envelope.planHash !== contexto.planHash) return deny('PLAN_HASH_MISMATCH', e.envelope);
  if (!APROBADOS.has(e.envelope.status)) return deny('ENVELOPE_NOT_APPROVED', e.envelope);
  if (!e.plan) return deny('PLAN_NOT_FOUND', e.envelope);
  // El envelope debe seguir ligado al plan material vigente (no re-simulamos: sólo validamos coherencia).
  if (!aprobacionVigente(e.envelope, e.plan)) return deny('PLAN_HASH_MISMATCH', e.envelope);

  // 2) INTERRUPTOR MAESTRO (fail-closed): sin SUPERVISED_REAL, NADA llega al proveedor.
  if (!e.flags.supervisedReal) return deny('SUPERVISED_REAL_DISABLED', e.envelope);

  // 3) PLAN COMPLETO aprobado → ejecutor Phase2B EXISTENTE (gate externo, reserva, ownership, idempotencia,
  //    dependencias y provider viven adentro; ninguna barrera se salta).
  const intents = construirActionPlan(e.plan, e.envelope, e.customerId, e.ahora);
  const r = await ejecutarEnvelopeReal({
    plan: e.plan, env: e.envelope, intents, ledger: e.ledger, prov: e.prov, flags: e.flags,
    port: e.port, bindingsExistentes: e.bindingsExistentes ?? [], ahora: e.ahora,
  });
  return {
    decision: 'EXECUTED', reason: null, trigger: 'FULL_APPROVED_PLAN',
    envelopeId: e.envelope.id, planHash: e.envelope.planHash,
    providerMutateCalls: r.providerMutateCalls, providerBindingsCreated: r.bindingsCreated.length, execution: r,
  };
}
