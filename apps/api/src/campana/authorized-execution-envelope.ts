/**
 * apps/api · campana · AUTHORIZED EXECUTION ENVELOPE (PURO) — SOBERANÍA FINANCIERA HUMANA.
 *
 * El humano autoriza UNA VEZ un sobre global (objetivo + plan + tope TOTAL + período + canales + tipos de
 * acción + guardrails). Dentro de ese sobre, y SÓLO en el futuro con SOEC_SUPERVISED_REAL=true, SOEC podría
 * ejecutar. En ESTA fase nada se ejecuta: ambos flags quedan false y `validateAuthorizedExecution` DENIEGA.
 *
 * INVARIANTES:
 *  - SOEC nunca compromete gasto > totalCap autorizado. GOOGLE_DAILY_BUDGET ≠ HUMAN_TOTAL_CAP (no se infiere uno del otro).
 *  - Gasto histórico ≠ gasto del envelope: el envelope sólo contabiliza gasto POSTERIOR a su activación.
 *  - Un cambio material del plan (planHash) invalida la aprobación. El sobre aprobado es inmutable (nueva revisión).
 *  - Un gate externo del proveedor manda por encima de la aprobación humana. Fail-closed.
 */
import type { MarketingPlan } from './marketing-plan';
import { hashPlan } from './plan-hash';

export type CanalId = 'google' | 'meta';

export type EnvelopeStatus =
  | 'DRAFT'
  | 'READY_FOR_HUMAN_APPROVAL'
  | 'APPROVED_WAITING_EXTERNAL_GATE'
  | 'APPROVED_READY_TO_ACTIVATE'
  | 'ACTIVE'
  | 'PAUSED_BY_GUARDRAIL'
  | 'STOPPED'
  | 'EXPIRED'
  | 'REVOKED'
  | 'FAILED_SAFE';

export type AccionAutorizable =
  | 'CREATE_CAMPAIGN' | 'CREATE_AD_GROUP' | 'CREATE_AD' | 'ADD_KEYWORD' | 'ADD_NEGATIVE_KEYWORD'
  | 'PAUSE_CAMPAIGN' | 'RESUME_CAMPAIGN' | 'ADJUST_DAILY_BUDGET' | 'PAUSE_AD_GROUP' | 'PAUSE_KEYWORD' | 'STOP_CAMPAIGN';

export const ACCIONES_AUTORIZABLES_DEFECTO: readonly AccionAutorizable[] = [
  'CREATE_CAMPAIGN', 'CREATE_AD_GROUP', 'CREATE_AD', 'ADD_KEYWORD', 'ADD_NEGATIVE_KEYWORD',
  'PAUSE_CAMPAIGN', 'RESUME_CAMPAIGN', 'ADJUST_DAILY_BUDGET', 'PAUSE_AD_GROUP', 'PAUSE_KEYWORD', 'STOP_CAMPAIGN',
];

/**
 * Acciones DELIBERADAMENTE autorizadas para un experimento de búsqueda (NO "todo"): construir + controlar +
 * detener. Se EXCLUYE `RESUME_CAMPAIGN` a propósito (una campaña detenida no se reanuda sin revisión humana).
 * El humano ve exactamente este conjunto antes de autorizar.
 */
export const ACCIONES_EXPERIMENTO_BUSQUEDA: readonly AccionAutorizable[] = [
  'CREATE_CAMPAIGN', 'CREATE_AD_GROUP', 'CREATE_AD', 'ADD_KEYWORD', 'ADD_NEGATIVE_KEYWORD',
  'ADJUST_DAILY_BUDGET', 'PAUSE_CAMPAIGN', 'PAUSE_AD_GROUP', 'PAUSE_KEYWORD', 'STOP_CAMPAIGN',
];

export interface EnvelopeStopRule { readonly id: string; readonly tipo: string; readonly enabled: boolean; readonly threshold?: number | null; readonly date?: string | null; readonly condition?: string; readonly reason?: string }

export interface AuthorizedExecutionEnvelope {
  readonly id: string;
  readonly organizationId: string;
  readonly objective: string;
  readonly planId: string;
  readonly planHash: string;
  readonly planVersion: string;
  readonly currency: string;
  readonly totalCap: number;
  readonly experimentBudget: number;
  readonly maxSpendWithoutContact: number;
  readonly startsAt: string | null;
  readonly expiresAt: string | null;
  readonly plannedChannels: readonly CanalId[];
  readonly authorizedChannels: readonly CanalId[];
  readonly authorizedActionTypes: readonly AccionAutorizable[];
  readonly stopRules: readonly EnvelopeStopRule[];
  readonly trackingRequirements: readonly string[];
  readonly status: EnvelopeStatus;
  readonly approvedBy: string | null;
  readonly approvedAt: string | null;
  readonly activatedAt: string | null;
  readonly stoppedAt: string | null;
  readonly revokedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type ReasonCode =
  | 'ENVELOPE_NOT_APPROVED' | 'ENVELOPE_EXPIRED' | 'ENVELOPE_REVOKED' | 'PLAN_HASH_MISMATCH'
  | 'CHANNEL_NOT_AUTHORIZED' | 'ACTION_NOT_AUTHORIZED' | 'EXTERNAL_GATE_BLOCKED' | 'TRACKING_INVALID'
  | 'LANDING_INVALID' | 'TOTAL_CAP_WOULD_BE_EXCEEDED' | 'ZERO_CONVERSION_GUARDRAIL' | 'PERIOD_ENDED'
  | 'AUTONOMOUS_REAL_DISABLED' | 'SUPERVISED_REAL_DISABLED';

export interface AuditEvent {
  readonly type: string;
  readonly organizationId: string;
  readonly envelopeId: string;
  readonly planId: string;
  readonly actor: string;
  readonly at: string;
  readonly reason?: string;
  readonly before?: EnvelopeStatus;
  readonly after?: EnvelopeStatus;
}

export interface FlagsEjecucion { readonly autonomousReal: boolean; readonly supervisedReal: boolean }
export interface ProviderState { readonly executionEligibleChannels: readonly CanalId[]; readonly providerConnected: boolean; readonly trackingValid: boolean; readonly landingAvailable: boolean; readonly now: string; readonly contacts: number }
export interface FinancialState { readonly historicalSpend: number; readonly envelopeSpend: number; readonly committedSpend: number }
export interface AccionSolicitada { readonly canal: CanalId; readonly tipo: AccionAutorizable | string; readonly mode?: 'SUPERVISED' | 'AUTONOMOUS'; readonly commitment?: number }
export interface ResultadoValidacion { readonly decision: 'ALLOW' | 'DENY'; readonly reasonCode: ReasonCode | null }

/** Lee los flags de ejecución del entorno. Ambos false por defecto (ninguna escritura real posible). */
export function flagsEjecucion(env: NodeJS.ProcessEnv, autonomousReal: boolean): FlagsEjecucion {
  return { autonomousReal, supervisedReal: env.SOEC_SUPERVISED_REAL === 'true' };
}

/** Estados APROBADOS: pasan el gate de estado; el gate externo/financiero decide después (reason preciso). */
const ESTADOS_APROBADOS: ReadonlySet<EnvelopeStatus> = new Set(['APPROVED_WAITING_EXTERNAL_GATE', 'APPROVED_READY_TO_ACTIVATE', 'ACTIVE']);

/** Transiciones permitidas (state machine explícita; no se permiten saltos arbitrarios). */
const TRANSICIONES: Record<EnvelopeStatus, readonly EnvelopeStatus[]> = {
  DRAFT: ['READY_FOR_HUMAN_APPROVAL', 'REVOKED', 'EXPIRED'],
  READY_FOR_HUMAN_APPROVAL: ['APPROVED_WAITING_EXTERNAL_GATE', 'APPROVED_READY_TO_ACTIVATE', 'REVOKED', 'EXPIRED'],
  APPROVED_WAITING_EXTERNAL_GATE: ['APPROVED_READY_TO_ACTIVATE', 'REVOKED', 'EXPIRED', 'FAILED_SAFE'],
  APPROVED_READY_TO_ACTIVATE: ['ACTIVE', 'REVOKED', 'EXPIRED', 'FAILED_SAFE', 'APPROVED_WAITING_EXTERNAL_GATE'],
  ACTIVE: ['PAUSED_BY_GUARDRAIL', 'STOPPED', 'EXPIRED', 'REVOKED'],
  PAUSED_BY_GUARDRAIL: ['ACTIVE', 'STOPPED', 'REVOKED', 'EXPIRED'],
  STOPPED: [], EXPIRED: [], REVOKED: [], FAILED_SAFE: ['READY_FOR_HUMAN_APPROVAL'],
};
export function puedeTransicionar(from: EnvelopeStatus, to: EnvelopeStatus): boolean {
  return (TRANSICIONES[from] ?? []).includes(to);
}

function audit(type: string, e: AuthorizedExecutionEnvelope, actor: string, at: string, reason?: string, before?: EnvelopeStatus, after?: EnvelopeStatus): AuditEvent {
  return { type, organizationId: e.organizationId, envelopeId: e.id, planId: e.planId, actor, at, ...(reason ? { reason } : {}), ...(before ? { before } : {}), ...(after ? { after } : {}) };
}

/** Construye el sobre desde un plan LISTO. status READY_FOR_HUMAN_APPROVAL si el draft está completo; si no, DRAFT. */
export function construirEnvelope(plan: MarketingPlan, org: string, planId: string, ahora: string): { envelope: AuthorizedExecutionEnvelope; audit: AuditEvent } {
  const planned = plan.recommendedChannelMix.filter((m) => m.presupuesto > 0).map((m) => m.canal);
  const authorized = planned.filter((c) => (plan.channelPlanningAvailability.find((p) => p.canal === c)?.canPlan) ?? false);
  const status: EnvelopeStatus = plan.campaignDraftStatus === 'READY_FOR_APPROVAL' ? 'READY_FOR_HUMAN_APPROVAL' : 'DRAFT';
  const hash = hashPlan(plan);
  const e: AuthorizedExecutionEnvelope = {
    id: `env:${org}:${planId}`, organizationId: org, objective: plan.objective, planId, planHash: hash, planVersion: hash.slice(0, 8),
    currency: plan.currency, totalCap: plan.totalAuthorizedBudget, experimentBudget: plan.totalSpendRecommended, maxSpendWithoutContact: plan.maxSpendWithoutContact.value,
    startsAt: plan.period.startAt, expiresAt: plan.period.endAt, plannedChannels: planned, authorizedChannels: authorized,
    authorizedActionTypes: ACCIONES_EXPERIMENTO_BUSQUEDA,
    stopRules: plan.stopCriteria.map((s) => ({ id: s.id, tipo: s.tipo, enabled: s.enabled, threshold: s.threshold ?? null, date: s.date ?? null, ...(s.condition ? { condition: s.condition } : {}), ...(s.reason ? { reason: s.reason } : {}) })),
    trackingRequirements: plan.requiredTracking, status, approvedBy: null, approvedAt: null, activatedAt: null, stoppedAt: null, revokedAt: null, createdAt: ahora, updatedAt: ahora,
  };
  return { envelope: e, audit: audit(status === 'READY_FOR_HUMAN_APPROVAL' ? 'ENVELOPE_READY_FOR_APPROVAL' : 'ENVELOPE_CREATED', e, 'soec', ahora, undefined, undefined, status) };
}

/** Verifica que el sobre siga ligado al plan vigente (invalida aprobación ante cambio material). */
export function aprobacionVigente(e: AuthorizedExecutionEnvelope, plan: MarketingPlan): boolean {
  return e.planHash === hashPlan(plan);
}

/** APROBACIÓN HUMANA (financiera, explícita, idempotente). Sólo desde READY_FOR_HUMAN_APPROVAL. */
export function aprobar(e: AuthorizedExecutionEnvelope, plan: MarketingPlan, actor: string, at: string, executionEligibleChannels: readonly CanalId[]): { envelope: AuthorizedExecutionEnvelope; changed: boolean; audit?: AuditEvent } {
  if (e.status === 'APPROVED_WAITING_EXTERNAL_GATE' || e.status === 'APPROVED_READY_TO_ACTIVATE') return { envelope: e, changed: false }; // idempotente
  if (e.status !== 'READY_FOR_HUMAN_APPROVAL') return { envelope: e, changed: false };
  if (!aprobacionVigente(e, plan)) return { envelope: e, changed: false }; // APPROVAL_INVALIDATED_BY_PLAN_CHANGE
  const ejecutable = e.authorizedChannels.some((c) => executionEligibleChannels.includes(c));
  const after: EnvelopeStatus = ejecutable ? 'APPROVED_READY_TO_ACTIVATE' : 'APPROVED_WAITING_EXTERNAL_GATE';
  const ne: AuthorizedExecutionEnvelope = { ...e, status: after, approvedBy: actor, approvedAt: at, updatedAt: at };
  return { envelope: ne, changed: true, audit: audit('ENVELOPE_APPROVED', ne, actor, at, ejecutable ? 'gate READY' : 'EXTERNAL_GATE_WAIT', e.status, after) };
}

/** REVOCACIÓN HUMANA (idempotente). Desde cualquier estado no terminal. Ninguna acción nueva autorizada. */
export function revocar(e: AuthorizedExecutionEnvelope, actor: string, at: string): { envelope: AuthorizedExecutionEnvelope; changed: boolean; audit?: AuditEvent } {
  if (e.status === 'REVOKED') return { envelope: e, changed: false };
  if (!puedeTransicionar(e.status, 'REVOKED')) return { envelope: e, changed: false };
  const ne: AuthorizedExecutionEnvelope = { ...e, status: 'REVOKED', revokedAt: at, updatedAt: at };
  return { envelope: ne, changed: true, audit: audit('ENVELOPE_REVOKED', ne, actor, at, 'revocación humana', e.status, 'REVOKED') };
}

/** REVALIDACIÓN PRE-EJECUCIÓN: una aprobación NO elimina gates. Antes de activar, revalidar TODO. */
export function revalidarActivacion(e: AuthorizedExecutionEnvelope, plan: MarketingPlan, prov: ProviderState): { envelope: AuthorizedExecutionEnvelope; ok: boolean; reason: ReasonCode | null; audit?: AuditEvent } {
  if (e.status === 'REVOKED') return { envelope: e, ok: false, reason: 'ENVELOPE_REVOKED' };
  if (e.expiresAt && prov.now >= e.expiresAt) { const ne = { ...e, status: 'EXPIRED' as EnvelopeStatus, updatedAt: prov.now }; return { envelope: ne, ok: false, reason: 'PERIOD_ENDED', audit: audit('ENVELOPE_EXPIRED', ne, 'soec', prov.now, 'período terminado', e.status, 'EXPIRED') }; }
  if (!aprobacionVigente(e, plan)) { const ne = { ...e, status: 'FAILED_SAFE' as EnvelopeStatus, updatedAt: prov.now }; return { envelope: ne, ok: false, reason: 'PLAN_HASH_MISMATCH', audit: audit('APPROVAL_INVALIDATED', ne, 'soec', prov.now, 'plan cambió', e.status, 'FAILED_SAFE') }; }
  if (!prov.providerConnected) return { envelope: e, ok: false, reason: 'EXTERNAL_GATE_BLOCKED' };
  if (!e.authorizedChannels.some((c) => prov.executionEligibleChannels.includes(c))) return { envelope: e, ok: false, reason: 'EXTERNAL_GATE_BLOCKED' };
  if (!prov.trackingValid) return { envelope: e, ok: false, reason: 'TRACKING_INVALID' };
  if (!prov.landingAvailable) return { envelope: e, ok: false, reason: 'LANDING_INVALID' };
  // Todo OK: pasa a listo para activar (no ejecuta nada por sí mismo).
  const ne: AuthorizedExecutionEnvelope = { ...e, status: 'APPROVED_READY_TO_ACTIVATE', updatedAt: prov.now };
  return { envelope: ne, ok: true, reason: null, audit: audit('ENVELOPE_ACTIVATION_READY', ne, 'soec', prov.now, undefined, e.status, 'APPROVED_READY_TO_ACTIVATE') };
}

/**
 * VALIDADOR CENTRAL de ejecución autorizada. PURO. Devuelve ALLOW o DENY+reasonCode (nunca excepción como
 * decisión financiera). Fail-closed: cualquier condición material no satisfecha ⇒ DENY. En esta fase, con
 * ambos flags false, SIEMPRE DENIEGA (ninguna provider mutation real posible).
 */
export function validateAuthorizedExecution(
  e: AuthorizedExecutionEnvelope, plan: MarketingPlan, prov: ProviderState, fin: FinancialState, action: AccionSolicitada, flags: FlagsEjecucion,
): ResultadoValidacion {
  const deny = (r: ReasonCode): ResultadoValidacion => ({ decision: 'DENY', reasonCode: r });
  // 1) Interruptores maestros (fail-closed).
  if (!flags.supervisedReal) return deny('SUPERVISED_REAL_DISABLED');
  if (action.mode === 'AUTONOMOUS' && !flags.autonomousReal) return deny('AUTONOMOUS_REAL_DISABLED');
  // 2) Estado del sobre.
  if (e.status === 'REVOKED') return deny('ENVELOPE_REVOKED');
  if (e.expiresAt && prov.now >= e.expiresAt) return deny('ENVELOPE_EXPIRED');
  if (!ESTADOS_APROBADOS.has(e.status)) return deny('ENVELOPE_NOT_APPROVED');
  // 3) Binding al plan vigente.
  if (!aprobacionVigente(e, plan)) return deny('PLAN_HASH_MISMATCH');
  // 4) Canal / acción autorizados.
  if (!e.authorizedChannels.includes(action.canal)) return deny('CHANNEL_NOT_AUTHORIZED');
  if (!(e.authorizedActionTypes as readonly string[]).includes(action.tipo)) return deny('ACTION_NOT_AUTHORIZED');
  // 5) Gate externo del proveedor (manda sobre la aprobación humana).
  if (!prov.providerConnected || !prov.executionEligibleChannels.includes(action.canal)) return deny('EXTERNAL_GATE_BLOCKED');
  if (!prov.trackingValid) return deny('TRACKING_INVALID');
  if (!prov.landingAvailable) return deny('LANDING_INVALID');
  // 6) Guardrails financieros vinculantes.
  if (prov.contacts === 0 && fin.envelopeSpend >= e.maxSpendWithoutContact) return deny('ZERO_CONVERSION_GUARDRAIL');
  // 7) SOBERANÍA DEL TOPE: histórico NO cuenta; sólo gasto del envelope + comprometido + esta acción.
  const commitment = action.commitment ?? 0;
  if (fin.envelopeSpend + fin.committedSpend + commitment > e.totalCap) return deny('TOTAL_CAP_WOULD_BE_EXCEEDED');
  return { decision: 'ALLOW', reasonCode: null };
}

/** Cap restante del envelope (histórico excluido por diseño). */
export function remainingCap(e: AuthorizedExecutionEnvelope, fin: FinancialState): number {
  return e.totalCap - fin.envelopeSpend - fin.committedSpend;
}

/** Audit event de una DENEGACIÓN de acción (para trazar por qué NO se ejecutó). */
export function auditoriaDenegacion(e: AuthorizedExecutionEnvelope, actor: string, at: string, reason: ReasonCode): AuditEvent {
  return audit('ACTION_DENIED', e, actor, at, reason, e.status, e.status);
}
