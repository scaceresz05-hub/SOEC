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
import { politicaAccionesDe, ACCIONES_EXPERIMENTO_BUSQUEDA, ACCIONES_AUTORIZABLES_DEFECTO, type AccionAutorizable } from './acciones';

export { ACCIONES_EXPERIMENTO_BUSQUEDA, ACCIONES_AUTORIZABLES_DEFECTO, type AccionAutorizable };
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
  | 'SUPERSEDED'
  | 'FAILED_SAFE';

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
  /** Duración MATERIAL autorizada (días). La ventana comercial NO se consume antes de activar (§7/§8). */
  readonly authorizedDurationDays: number;
  /** Ventana de EJECUCIÓN real. null hasta la activación; se fija en `activar()` = activatedAt … +duración. */
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
  // Enlace de supersesión (revisión por cambio material).
  readonly previousEnvelopeId?: string;
  readonly newEnvelopeId?: string;
  readonly oldPlanHash?: string;
  readonly newPlanHash?: string;
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
  DRAFT: ['READY_FOR_HUMAN_APPROVAL', 'REVOKED', 'EXPIRED', 'SUPERSEDED'],
  READY_FOR_HUMAN_APPROVAL: ['APPROVED_WAITING_EXTERNAL_GATE', 'APPROVED_READY_TO_ACTIVATE', 'REVOKED', 'EXPIRED', 'SUPERSEDED'],
  APPROVED_WAITING_EXTERNAL_GATE: ['APPROVED_READY_TO_ACTIVATE', 'REVOKED', 'EXPIRED', 'FAILED_SAFE', 'SUPERSEDED'],
  APPROVED_READY_TO_ACTIVATE: ['ACTIVE', 'REVOKED', 'EXPIRED', 'FAILED_SAFE', 'APPROVED_WAITING_EXTERNAL_GATE', 'SUPERSEDED'],
  ACTIVE: ['PAUSED_BY_GUARDRAIL', 'STOPPED', 'EXPIRED', 'REVOKED'],
  PAUSED_BY_GUARDRAIL: ['ACTIVE', 'STOPPED', 'REVOKED', 'EXPIRED'],
  STOPPED: [], EXPIRED: [], REVOKED: [], SUPERSEDED: [], FAILED_SAFE: ['READY_FOR_HUMAN_APPROVAL'],
};
export function puedeTransicionar(from: EnvelopeStatus, to: EnvelopeStatus): boolean {
  return (TRANSICIONES[from] ?? []).includes(to);
}

function audit(type: string, e: AuthorizedExecutionEnvelope, actor: string, at: string, reason?: string, before?: EnvelopeStatus, after?: EnvelopeStatus): AuditEvent {
  return { type, organizationId: e.organizationId, envelopeId: e.id, planId: e.planId, actor, at, ...(reason ? { reason } : {}), ...(before ? { before } : {}), ...(after ? { after } : {}) };
}

/**
 * Construye el sobre desde un plan. El id es CONTENT-ADDRESSED (deriva del hash canónico), no del planId
 * efímero ⇒ un plan materialmente idéntico produce el MISMO id/hash. Emite el ciclo de vida completo:
 * ENVELOPE_CREATED y, si está listo, ENVELOPE_READY_FOR_APPROVAL.
 */
export function construirEnvelope(plan: MarketingPlan, org: string, planId: string, ahora: string): { envelope: AuthorizedExecutionEnvelope; audits: AuditEvent[] } {
  const planned = plan.recommendedChannelMix.filter((m) => m.presupuesto > 0).map((m) => m.canal);
  const authorized = planned.filter((c) => (plan.channelPlanningAvailability.find((p) => p.canal === c)?.canPlan) ?? false);
  const ready = plan.campaignDraftStatus === 'READY_FOR_APPROVAL';
  const status: EnvelopeStatus = ready ? 'READY_FOR_HUMAN_APPROVAL' : 'DRAFT';
  const hash = hashPlan(plan);
  const e: AuthorizedExecutionEnvelope = {
    id: `env:${org}:${hash}`, organizationId: org, objective: plan.objective, planId, planHash: hash, planVersion: hash.slice(0, 8),
    currency: plan.currency, totalCap: plan.totalAuthorizedBudget, experimentBudget: plan.totalSpendRecommended, maxSpendWithoutContact: plan.maxSpendWithoutContact.value,
    authorizedDurationDays: plan.period.dias,
    // La ventana de ejecución NO se fija al crear el draft ni al aprobar: se resuelve en `activar()`. La duración
    // material vive en authorizedDurationDays (y en el canonicalPlanHash como periodDays), no como fecha absoluta.
    startsAt: null, expiresAt: null, plannedChannels: planned, authorizedChannels: authorized,
    authorizedActionTypes: politicaAccionesDe(),
    // STOP_PERIOD arranca SIN fecha absoluta (representa la duración); se resuelve a executionEndsAt al activar (§9).
    stopRules: plan.stopCriteria.map((s) => ({ id: s.id, tipo: s.tipo, enabled: s.enabled, threshold: s.threshold ?? null, date: s.tipo === 'PERIOD' ? null : (s.date ?? null), ...(s.condition ? { condition: s.condition } : {}), ...(s.reason ? { reason: s.reason } : {}) })),
    trackingRequirements: plan.requiredTracking, status, approvedBy: null, approvedAt: null, activatedAt: null, stoppedAt: null, revokedAt: null, createdAt: ahora, updatedAt: ahora,
  };
  const audits: AuditEvent[] = [audit('ENVELOPE_CREATED', e, 'soec', ahora, undefined, undefined, 'DRAFT')];
  if (ready) audits.push(audit('ENVELOPE_READY_FOR_APPROVAL', e, 'soec', ahora, undefined, 'DRAFT', 'READY_FOR_HUMAN_APPROVAL'));
  return { envelope: e, audits };
}

/** Marca un sobre previo como SUPERSEDED por una nueva revisión (cambio material del plan). */
export function superseder(prev: AuthorizedExecutionEnvelope, nuevoId: string, nuevoHash: string, at: string): { envelope: AuthorizedExecutionEnvelope; audit: AuditEvent } {
  const ne: AuthorizedExecutionEnvelope = { ...prev, status: 'SUPERSEDED', updatedAt: at };
  const ev: AuditEvent = {
    type: 'ENVELOPE_SUPERSEDED', organizationId: prev.organizationId, envelopeId: prev.id, planId: prev.planId, actor: 'soec', at,
    reason: 'MATERIAL_PLAN_CHANGED', before: prev.status, after: 'SUPERSEDED',
    previousEnvelopeId: prev.id, newEnvelopeId: nuevoId, oldPlanHash: prev.planHash, newPlanHash: nuevoHash,
  };
  return { envelope: ne, audit: ev };
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
 * ACTIVACIÓN del sobre (PURA). Aquí — y sólo aquí — arranca la ventana comercial: `executionStartsAt = at` y
 * `executionEndsAt = at + authorizedDurationDays`. Antes de activar la ventana es null (el período NO se consume
 * mientras espera aprobación/gate externo). Resuelve además STOP_PERIOD.date = executionEndsAt (§9). NO habilita
 * ninguna escritura real (los flags siguen mandando); es una transición de estado + resolución de fechas.
 */
export function activar(e: AuthorizedExecutionEnvelope, at: string): { envelope: AuthorizedExecutionEnvelope; changed: boolean; audit?: AuditEvent } {
  if (e.status === 'ACTIVE') return { envelope: e, changed: false }; // idempotente
  if (!puedeTransicionar(e.status, 'ACTIVE')) return { envelope: e, changed: false };
  const expiresAt = new Date(Date.parse(at) + e.authorizedDurationDays * 24 * 3600_000).toISOString();
  const stopRules = e.stopRules.map((s) => (s.tipo === 'PERIOD' ? { ...s, date: expiresAt } : s));
  const ne: AuthorizedExecutionEnvelope = { ...e, status: 'ACTIVE', activatedAt: at, startsAt: at, expiresAt, stopRules, updatedAt: at };
  return { envelope: ne, changed: true, audit: audit('ENVELOPE_ACTIVATED', ne, 'soec', at, 'ventana de ejecución fijada', e.status, 'ACTIVE') };
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
