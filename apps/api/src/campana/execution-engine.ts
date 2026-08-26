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
import { fingerprintsDelPlan, type PlanFingerprints } from './material-fingerprint';
import { construirActionPlan, type ExecutionActionIntent } from './execution-intent';
import { validarPropiedad, type ProviderResourceBinding } from './resource-binding';
import type { FinancialLedger } from './financial-ledger';

export type ExecReason =
  | 'ENVELOPE_NOT_APPROVED' | 'ENVELOPE_EXPIRED' | 'ENVELOPE_REVOKED' | 'PLAN_HASH_MISMATCH'
  | 'CHANNEL_NOT_AUTHORIZED' | 'ACTION_NOT_AUTHORIZED' | 'PLAN_MATERIAL_CHANGE_REQUIRES_REAPPROVAL'
  | 'RESOURCE_NOT_OWNED_BY_ENVELOPE' | 'EXPERIMENT_CAP_WOULD_BE_EXCEEDED' | 'TOTAL_CAP_WOULD_BE_EXCEEDED'
  | 'PARENT_RESOURCE_NOT_IN_APPROVED_PLAN' | 'PARENT_PROVIDER_RESOURCE_NOT_BOUND'
  | 'ENVELOPE_MATERIAL_REFRESH_REQUIRED'
  | 'EXTERNAL_GATE_BLOCKED' | 'TRACKING_INVALID' | 'LANDING_INVALID' | 'SUPERVISED_REAL_DISABLED' | 'AUTONOMOUS_REAL_DISABLED';

export interface CompatibilidadMaterial { readonly compatible: boolean; readonly reasonCode: 'ENVELOPE_MATERIAL_REFRESH_REQUIRED' | null }

/**
 * ¿El envelope + plan pertenecen al MODELO EJECUTABLE VIGENTE? El modelo actual exige CAMPAIGN TOTAL BUDGET
 * (`budgetPolicy.type === 'CAMPAIGN_TOTAL'`), duración de ejecución material (`authorizedDurationDays`) y una
 * política de acciones sin `ADJUST_DAILY_BUDGET`. Un envelope/plan del SCHEMA ANTERIOR (sin budgetPolicy / sin
 * authorizedDurationDays / con ADJUST_DAILY_BUDGET) es INCOMPATIBLE: se FALLA CERRADO con
 * ENVELOPE_MATERIAL_REFRESH_REQUIRED. NUNCA se reinterpreta como CAMPAIGN_TOTAL ni se le infiere duración: el
 * humano nunca revisó ese material. PURA: no muta nada, no infiere, no supersede.
 */
export function evaluarCompatibilidadMaterial(env: AuthorizedExecutionEnvelope, plan: MarketingPlan): CompatibilidadMaterial {
  const bp = plan.campaigns[0]?.budgetPolicy as { type?: unknown; totalAmount?: unknown; durationDays?: unknown } | undefined;
  const planActual = bp?.type === 'CAMPAIGN_TOTAL' && typeof bp.totalAmount === 'number' && typeof bp.durationDays === 'number';
  const duracionActual = typeof (env as { authorizedDurationDays?: unknown }).authorizedDurationDays === 'number';
  const accionesActuales = !(env.authorizedActionTypes as readonly string[]).includes('ADJUST_DAILY_BUDGET');
  const compatible = planActual && duracionActual && accionesActuales;
  return compatible ? { compatible: true, reasonCode: null } : { compatible: false, reasonCode: 'ENVELOPE_MATERIAL_REFRESH_REQUIRED' };
}

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
  // 4) MATERIAL (entidad ∈ plan aprobado; y su AD GROUP padre ∈ ad groups aprobados — fail-closed)
  const fps = fingerprintsDelPlan(plan);
  if (!validateActionAgainstApprovedPlan(intent, fps.all).ok) return deny('PLAN_MATERIAL_CHANGE_REQUIRES_REAPPROVAL');
  if (intent.parent && !fps.adGroupSet.has(intent.parent.materialFingerprint)) return deny('PARENT_RESOURCE_NOT_IN_APPROVED_PLAN');
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

/**
 * GATE UNIFICADO a nivel ENVELOPE (sin acción específica). Misma PRECEDENCIA que el pipeline por intent, para
 * que GET /medicion/envelope y GET /medicion/execution-plan devuelvan el MISMO primer reason. Orden §15:
 * 1) sin envelope → ENVELOPE_NOT_APPROVED · 2) revoked/expired · 3) no aprobado · 4) hash · 5) canal · 6) gate
 * externo · 7) supervised flag. (material/acción específica se validan por intent.)
 */
export function evaluarGateEnvelope(
  env: AuthorizedExecutionEnvelope | null, plan: MarketingPlan | null, prov: ProviderState, flags: FlagsEjecucion,
): ResultadoBarrera {
  const deny = (r: ExecReason): ResultadoBarrera => ({ decision: 'DENY', reasonCode: r });
  if (!env) return deny('ENVELOPE_NOT_APPROVED');
  if (env.status === 'REVOKED') return deny('ENVELOPE_REVOKED');
  if (env.expiresAt && prov.now >= env.expiresAt) return deny('ENVELOPE_EXPIRED');
  if (!APROBADOS.has(env.status)) return deny('ENVELOPE_NOT_APPROVED');
  if (plan && !aprobacionVigente(env, plan)) return deny('PLAN_HASH_MISMATCH');
  if (!env.authorizedChannels.includes('google')) return deny('CHANNEL_NOT_AUTHORIZED');
  if (!prov.providerConnected || !prov.executionEligibleChannels.includes('google')) return deny('EXTERNAL_GATE_BLOCKED');
  if (!prov.trackingValid) return deny('TRACKING_INVALID');
  if (!prov.landingAvailable) return deny('LANDING_INVALID');
  if (!flags.supervisedReal) return deny('SUPERVISED_REAL_DISABLED');
  return { decision: 'ALLOW', reasonCode: null };
}

const CLAVES_PAYLOAD_PERMITIDAS = new Set(['customerId', 'operation', 'resourceType', 'fields', 'parentAdGroup']);
const CLAVES_PROHIBIDAS = /token|secret|authorization|cookie|password|bearer|developer|refresh|access|session/i;

/** Sanea un providerPayload: whitelist de claves + defensa ante cualquier clave sensible. Nunca expone secretos. */
export function sanitizarPayload(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object') return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
    if (!CLAVES_PAYLOAD_PERMITIDAS.has(k)) continue;
    if (CLAVES_PROHIBIDAS.test(k)) continue;
    out[k] = v;
  }
  return out;
}

export interface IntentDetalle {
  readonly id: string; readonly organizationId: string; readonly envelopeId: string; readonly planHash: string;
  readonly channel: string; readonly actionType: string;
  readonly materialEntityFingerprint: string; readonly idempotencyKey: string;
  readonly status: string; readonly validation: { decision: string; reasonCode: string | null };
  readonly parent: { readonly entityType: string; readonly materialFingerprint: string; readonly logicalName?: string } | null;
  readonly dependsOn: readonly { readonly actionType: string; readonly materialFingerprint: string }[];
  readonly materialBinding: { readonly approved: boolean; readonly planEntityFingerprint: string; readonly requestedFingerprint: string };
  readonly parentMaterialBinding: { readonly approved: boolean; readonly materialFingerprint: string } | null;
  readonly financialImpact: { readonly scope: string; readonly currency: string; readonly projectedCommitment: number; readonly experimentCapImpact: number; readonly envelopeCapImpact: number };
  readonly providerPayload: Record<string, unknown> | null;
}

/** Proyecta un intent a su detalle READ-ONLY, auditable y sin secretos (incluye padre y dependencias). */
export function detalleIntent(intent: ExecutionActionIntent, fps: PlanFingerprints, currency: string): IntentDetalle {
  const c = intent.financialImpact.commitment;
  return {
    id: intent.id, organizationId: intent.organizationId, envelopeId: intent.envelopeId, planHash: intent.planHash,
    channel: intent.channel, actionType: intent.actionType,
    materialEntityFingerprint: intent.materialEntityFingerprint, idempotencyKey: intent.idempotencyKey,
    status: intent.status, validation: intent.validation,
    parent: intent.parent ? { entityType: intent.parent.entityType, materialFingerprint: intent.parent.materialFingerprint, ...(intent.parent.logicalName ? { logicalName: intent.parent.logicalName } : {}) } : null,
    dependsOn: intent.dependsOn,
    materialBinding: { approved: fps.all.has(intent.materialEntityFingerprint), planEntityFingerprint: intent.materialEntityFingerprint, requestedFingerprint: intent.materialEntityFingerprint },
    parentMaterialBinding: intent.parent ? { approved: fps.adGroupSet.has(intent.parent.materialFingerprint), materialFingerprint: intent.parent.materialFingerprint } : null,
    financialImpact: { scope: intent.financialImpact.scope, currency, projectedCommitment: c, experimentCapImpact: intent.financialImpact.scope === 'EXPERIMENT' ? c : 0, envelopeCapImpact: c },
    providerPayload: sanitizarPayload(intent.providerPayload),
  };
}

/** Auditoría SHADOW DERIVADA (computada, no persistida ⇒ el GET es side-effect free). Separada de la ejecución real. */
export function auditoriaShadowDerivada(shadow: ResultadoShadow): Array<{ type: string; actionType?: string; fingerprint?: string; reason?: string; at: string }> {
  const evs: Array<{ type: string; actionType?: string; fingerprint?: string; reason?: string; at: string }> = [{ type: 'EXECUTION_PLAN_CREATED', at: shadow.at }];
  for (const it of shadow.intents) {
    evs.push({ type: 'ACTION_INTENT_CREATED', actionType: it.actionType, fingerprint: it.materialEntityFingerprint, at: shadow.at });
    if (it.status === 'BLOCKED') evs.push({ type: 'ACTION_BLOCKED', actionType: it.actionType, fingerprint: it.materialEntityFingerprint, reason: it.validation.reasonCode ?? undefined, at: shadow.at });
    else if (it.status === 'READY_FOR_PROVIDER') evs.push({ type: 'ACTION_SHADOW_READY', actionType: it.actionType, fingerprint: it.materialEntityFingerprint, at: shadow.at });
  }
  return evs;
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
  // Decisión real = GATE UNIFICADO a nivel envelope (misma precedencia que GET /medicion/envelope).
  const repRes: ResultadoBarrera = evaluarGateEnvelope(env, plan, prov, flags);
  return {
    mode: 'SHADOW', intents,
    summary: { executionActionCount: intents.length, byType, entitiesAffected: new Set(intents.map((i) => i.materialEntityFingerprint)).size },
    realExecutionDecision: repRes.decision, realExecutionReason: repRes.reasonCode, providerMutateCalls: 0, at: ahora,
  };
}
