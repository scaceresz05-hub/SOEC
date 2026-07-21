/**
 * @soec/contracts — Fronteras de la Base Técnica.
 *
 * Realiza, a nivel de tipos, invariantes y puertos, el contrato ADR-0002.
 * No contiene implementación de producto ni dependencia de tecnología.
 * Trazabilidad: #9 (invariantes), #12, #13, #15, #16, ADR-0002.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Errores explícitos (nada falla en silencio)
// ─────────────────────────────────────────────────────────────────────────────
export class SoecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
/** C-1: violación de concurrencia optimista (versión de stream). */
export class ConcurrencyError extends SoecError {}
/** C-2: toda afirmación debe portar atribución. */
export class AttributionRequiredError extends SoecError {}
/** C-5: rechazo por defecto cuando falta alcance. */
export class ScopeRequiredError extends SoecError {}
/** C-5: aislamiento organizacional — el alcance no corresponde a la organización. */
export class ScopeMismatchError extends SoecError {}
/** C-5: intento de cerrar automáticamente una decisión reservada a la persona. */
export class SovereigntyViolationError extends SoecError {}

// ─────────────────────────────────────────────────────────────────────────────
// Contexto: organización, actor y alcance (deben viajar siempre — C-5)
// ─────────────────────────────────────────────────────────────────────────────
export type OrganizationId = string & { readonly __brand: 'OrganizationId' };
export type ActorId = string & { readonly __brand: 'ActorId' };

export const OrganizationId = (v: string): OrganizationId => {
  if (!v) throw new SoecError('OrganizationId vacío');
  return v as OrganizationId;
};
export const ActorId = (v: string): ActorId => {
  if (!v) throw new SoecError('ActorId vacío');
  return v as ActorId;
};

export interface Scope {
  readonly organizationId: OrganizationId;
  readonly permissions: readonly string[];
}

export interface RequestContext {
  readonly organizationId: OrganizationId;
  readonly actor: ActorId;
  readonly scope: Scope;
  readonly correlationId: string;
}

/** Rechazo por defecto: sin alcance válido y permiso, la operación no procede. */
export function requireScope(ctx: RequestContext, permission: string): void {
  if (!ctx || !ctx.scope) {
    throw new ScopeRequiredError('Falta el contexto de alcance');
  }
  if (ctx.scope.organizationId !== ctx.organizationId) {
    throw new ScopeMismatchError('El alcance no corresponde a la organización del contexto');
  }
  if (!ctx.scope.permissions.includes(permission)) {
    throw new ScopeRequiredError(`Falta el permiso requerido: ${permission}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Atribución (C-2) — toda afirmación es atribuible; nada en primera persona
// ─────────────────────────────────────────────────────────────────────────────
export type ClaimType =
  | 'observational'
  | 'documentary'
  | 'testimonial'
  | 'deductive'
  | 'normative'
  | 'statistical'
  | 'causal'
  | 'interpretive';

export type Regime = 'empirical' | 'formal' | 'institutional';

export interface Attribution {
  readonly source: string;
  readonly purpose: string;
  readonly assumptions: readonly string[];
  readonly claimType: ClaimType;
  readonly regime: Regime;
  readonly uncertainty: string;
}

export function assertAttribution(a: Attribution | undefined | null): asserts a is Attribution {
  if (!a || !a.source || !a.purpose || !a.claimType || !a.regime) {
    throw new AttributionRequiredError(
      'Toda afirmación debe portar atribución completa (fuente, propósito, tipo, régimen)',
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Eventos — dos ejes temporales (mundo vs. conocimiento), atribución, causación
// ─────────────────────────────────────────────────────────────────────────────
export interface EventInput {
  readonly type: string;
  readonly payload: unknown;
  readonly attribution: Attribution;
  /** Tiempo del mundo: cuándo ocurrió el hecho (ISO). */
  readonly occurredAt: string;
  /** C-1: clave de idempotencia (opcional). */
  readonly idempotencyKey?: string;
  readonly causationId?: string;
}

export interface RecordedEvent {
  readonly eventId: string;
  readonly streamId: string;
  readonly sequence: number;
  readonly organizationId: OrganizationId;
  readonly actor: ActorId;
  readonly type: string;
  readonly payload: unknown;
  readonly attribution: Attribution;
  /** Tiempo del mundo. */
  readonly occurredAt: string;
  /** Tiempo del conocimiento: cuándo SOEC lo registró. */
  readonly recordedAt: string;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly idempotencyKey: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Puertos — reemplazables (in-memory / PostgreSQL / futuro)
// ─────────────────────────────────────────────────────────────────────────────
export interface AppendResult {
  readonly events: readonly RecordedEvent[];
  readonly version: number;
}

/** C-1, C-3, C-4: almacén append-only con historia inmutable y reconstrucción temporal. */
export interface EventStore {
  append(
    ctx: RequestContext,
    streamId: string,
    expectedVersion: number,
    events: readonly EventInput[],
  ): Promise<AppendResult>;
  readStream(ctx: RequestContext, streamId: string): Promise<readonly RecordedEvent[]>;
  /** Reconstrucción a un corte temporal del conocimiento, sin contaminación posterior. */
  reconstructAt(
    ctx: RequestContext,
    streamId: string,
    asOfRecordedAt: string,
  ): Promise<readonly RecordedEvent[]>;
  currentVersion(ctx: RequestContext, streamId: string): Promise<number>;
}

export interface OutboxMessage {
  readonly id: string;
  readonly event: RecordedEvent;
}

/** Outbox transaccional: entrega asincrónica sin broker externo. */
export interface Outbox {
  pending(limit: number): Promise<readonly OutboxMessage[]>;
  markProcessed(id: string): Promise<void>;
}

/** Proyección reconstruible a partir de la historia de eventos. */
export interface Projection<S> {
  readonly name: string;
  readonly initial: S;
  apply(state: S, event: RecordedEvent): S;
}

// ─────────────────────────────────────────────────────────────────────────────
// Frontera de inteligencia (#13) — produce hipótesis; nunca decide (C-5)
// ─────────────────────────────────────────────────────────────────────────────
export type ProductKind = 'explanation' | 'diagnosis' | 'hypothesis' | 'projection' | 'orientation';

export interface IntellectualProduct {
  readonly kind: ProductKind;
  readonly content: string;
  readonly attribution: Attribution;
  readonly uncertainty: string;
  readonly abstained: boolean;
  readonly evidence: readonly string[];
  readonly provider: string;
  readonly providerVersion: string;
  /** Estructural: un producto jamás es una decisión vinculante. El tipo lo garantiza. */
  readonly bindingDecision: false;
}

export interface IntelligenceRequest {
  readonly operation: ProductKind;
  readonly input: string;
  readonly maxCost?: number;
  readonly timeoutMs?: number;
  /** Política de datos: qué puede salir hacia el proveedor. */
  readonly dataPolicy: 'may-leave-org' | 'must-stay-internal';
}

/** Puerto neutral: el dominio jamás llama a un SDK externo (Const. 2.5). */
export interface IntelligenceProvider {
  readonly name: string;
  readonly version: string;
  operate(
    ctx: RequestContext,
    req: IntelligenceRequest,
    signal?: AbortSignal,
  ): Promise<IntellectualProduct>;
}
