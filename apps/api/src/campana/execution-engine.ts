/**
 * apps/api · campana · MOTOR DE EJECUCIÓN (SHADOW / fail-closed). Convierte un plan aprobado + envelope en
 * action intents, los valida por un pipeline ÚNICO y ORDENADO, traduce a payloads Google y calcula impacto
 * financiero — pero NUNCA llama a la red. Cada acción pasa SIEMPRE por todas las barreras; no hay ruta alterna.
 *
 * ORDEN (§9): ENVELOPE → PLAN-HASH → CANAL/ACCIÓN → MATERIAL → OWNERSHIP → FINANCIERO → GATE EXTERNO → FLAGS.
 * Tres barreras independientes bloquean el caso real: sobre no aprobado, verificación de Google pendiente,
 * SOEC_SUPERVISED_REAL=false.
 */
import type { MarketingPlan } from './marketing-plan';
import { aprobacionVigente, type AuthorizedExecutionEnvelope, type ProviderState, type FlagsEjecucion } from './authorized-execution-envelope';
import { fingerprintsDelPlan } from './material-fingerprint';
import { construirActionPlan, type ExecutionActionIntent } from './execution-intent';
import { validarPropiedad, type ProviderResourceBinding } from './resource-binding';
import type { FinancialLedger } from './financial-ledger';

export type ExecReason =
  | 'ENVELOPE_NOT_APPROVED' | 'ENVELOPE_EXPIRED' | 'ENVELOPE_REVOKED' | 'PLAN_HASH_MISMATCH'
  | 'CHANNEL_NOT_AUTHORIZED' | 'ACTION_NOT_AUTHORIZED' | 'PLAN_MATERIAL_CHANGE_REQUIRES_REAPPROVAL'
  | 'RESOURCE_NOT_OWNED_BY_ENVELOPE' | 'EXPERIMENT_CAP_WOULD_BE_EXCEEDED' | 'TOTAL_CAP_WOULD_BE_EXCEEDED'
  | 'EXTERNAL_GATE_BLOCKED' | 'TRACKING_INVALID' | 'LANDING_INVALID' | 'SUPERVISED_REAL_DISABLED' | 'AUTONOMOUS_REAL_DISABLED';

export interface ResultadoBarrera { readonly decision: 'ALLOW' | 'DENY'; readonly reasonCode: ExecReason | null }

const APROBADOS = new Set(['APPROVED_WAITING_EXTERNAL_GATE', 'APPROVED_READY_TO_ACTIVATE', 'ACTIVE']);

/** MATERIAL: la entidad de la acción debe existir en el plan aprobado (fingerprint ∈ conjunto material). */
export function validateActionAgainstApprovedPlan(intent: ExecutionActionIntent, fpAll: ReadonlySet<string>): { ok: boolean } {
  return { ok: fpAll.has(intent.materialEntityFingerprint) };
}

/** FINANZAS: doble hard cap. Experimento primero (menor), luego tope total. */
export function validateActionFinancialImpact(intent: ExecutionActionIntent, ledger: FinancialLedger, env: AuthorizedExecutionEnvelope): { ok: boolean; reason: ExecReason | null } {
  const c = intent.financialImpact.commitment;
  if (intent.financialImpact.scope === 'EXPERIMENT' && ledger.experimentCommittedSpend + c > env.experimentBudget) return { ok: false, reason: 'EXPERIMENT_CAP_WOULD_BE_EXCEEDED' };
  if (ledger.committedSpend + c > env.totalCap) return { ok: false, reason: 'TOTAL_CAP_WOULD_BE_EXCEEDED' };
  return { ok: true, reason: null };
}

export interface OpcionesBarrera { readonly mode?: 'SUPERVISED' | 'AUTONOMOUS' }

/** Pipeline ÚNICO y ordenado. Fail-closed: primera barrera que falla ⇒ DENY con su reason. */
export function evaluarBarreras(
  intent: ExecutionActionIntent, plan: MarketingPlan, env: AuthorizedExecutionEnvelope, ledger: FinancialLedger,
  prov: ProviderState, flags: FlagsEjecucion, binding: ProviderResourceBinding | null, opts: OpcionesBarrera = {},
): ResultadoBarrera {
  const deny = (r: ExecReason): ResultadoBarrera => ({ decision: 'DENY', reasonCode: r });
  // 1) ENVELOPE
  if (env.status === 'REVOKED') return deny('ENVELOPE_REVOKED');
  if (env.expiresAt && prov.now >= env.expiresAt) return deny('ENVELOPE_EXPIRED');
  if (!APROBADOS.has(env.status)) return deny('ENVELOPE_NOT_APPROVED');
  // 2) PLAN-HASH
  if (!aprobacionVigente(env, plan)) return deny('PLAN_HASH_MISMATCH');
  // 3) CANAL / ACCIÓN autorizados
  if (!env.authorizedChannels.includes(intent.channel)) return deny('CHANNEL_NOT_AUTHORIZED');
  if (!(env.authorizedActionTypes as readonly string[]).includes(intent.actionType)) return deny('ACTION_NOT_AUTHORIZED');
  // 4) MATERIAL
  if (!validateActionAgainstApprovedPlan(intent, fingerprintsDelPlan(plan).all).ok) return deny('PLAN_MATERIAL_CHANGE_REQUIRES_REAPPROVAL');
  // 5) OWNERSHIP (mutaciones no-creación exigen binding del mismo envelope/tenant)
  if (!validarPropiedad(intent.actionType, binding, env.organizationId, env.id).ok) return deny('RESOURCE_NOT_OWNED_BY_ENVELOPE');
  // 6) FINANCIERO
  const fin = validateActionFinancialImpact(intent, ledger, env);
  if (!fin.ok) return deny(fin.reason!);
  // 7) GATE EXTERNO (manda sobre la aprobación humana)
  if (!prov.providerConnected || !prov.executionEligibleChannels.includes(intent.channel)) return deny('EXTERNAL_GATE_BLOCKED');
  if (!prov.trackingValid) return deny('TRACKING_INVALID');
  if (!prov.landingAvailable) return deny('LANDING_INVALID');
  // 8) FLAGS (última frontera)
  if (!flags.supervisedReal) return deny('SUPERVISED_REAL_DISABLED');
  if (opts.mode === 'AUTONOMOUS' && !flags.autonomousReal) return deny('AUTONOMOUS_REAL_DISABLED');
  return { decision: 'ALLOW', reasonCode: null };
}

export interface ResultadoShadow {
  readonly mode: 'SHADOW';
  readonly intents: readonly ExecutionActionIntent[];
  readonly summary: {
    readonly executionActionCount: number;
    readonly byType: Readonly<Record<string, number>>;
    readonly entitiesAffected: number;
  };
  readonly realExecutionDecision: 'ALLOW' | 'DENY';
  readonly realExecutionReason: ExecReason | null;
  readonly providerMutateCalls: 0;
  readonly at: string;
}

/**
 * Corre el motor en SHADOW: construye intents, valida TODAS por el pipeline, traduce payloads y calcula impacto,
 * SIN llamar mutate. `realExecutionDecision` = resultado de la acción representativa (CREATE_CAMPAIGN).
 */
export function correrShadow(
  plan: MarketingPlan, env: AuthorizedExecutionEnvelope, customerId: string, ledger: FinancialLedger,
  prov: ProviderState, flags: FlagsEjecucion, ahora: string, bindings: readonly ProviderResourceBinding[] = [],
): ResultadoShadow {
  const base = construirActionPlan(plan, env, customerId, ahora);
  const bindingDe = (it: ExecutionActionIntent): ProviderResourceBinding | null => bindings.find((b) => b.envelopeId === env.id && b.materialFingerprint === it.materialEntityFingerprint) ?? null;
  const intents = base.map((it) => {
    const r = evaluarBarreras(it, plan, env, ledger, prov, flags, bindingDe(it));
    return { ...it, validation: r, status: (r.decision === 'ALLOW' ? 'READY_FOR_PROVIDER' : 'BLOCKED') as ExecutionActionIntent['status'] };
  });
  const byType: Record<string, number> = {};
  for (const it of intents) byType[it.actionType] = (byType[it.actionType] ?? 0) + 1;
  const rep = intents.find((x) => x.actionType === 'CREATE_CAMPAIGN') ?? intents[0];
  const repRes: ResultadoBarrera = rep ? evaluarBarreras(rep, plan, env, ledger, prov, flags, bindingDe(rep)) : { decision: 'DENY', reasonCode: 'ENVELOPE_NOT_APPROVED' };
  return {
    mode: 'SHADOW', intents,
    summary: { executionActionCount: intents.length, byType, entitiesAffected: new Set(intents.map((i) => i.materialEntityFingerprint)).size },
    realExecutionDecision: repRes.decision, realExecutionReason: repRes.reasonCode, providerMutateCalls: 0, at: ahora,
  };
}
