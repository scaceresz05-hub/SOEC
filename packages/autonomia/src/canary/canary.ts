/**
 * @soec/autonomia · canary · CONTROLLED REAL CANARY — última milla (STANDBY, sin efecto real).
 *
 * Prepara la ejecución REAL de UNA sola capacidad reversible (excluir un término de búsqueda) sin
 * ejecutar nada: WRITE apagado, sin credencial de escritura, sin mutate. La ABSTENCIÓN es un
 * resultado válido: `NO_ACTION_REQUIRED`. Nada se fabrica para «probar»: SOEC espera una intención
 * comercial real que cumpla TODOS los requisitos. Fail-closed en cada frontera.
 */
import { metaDeAccion, type TipoAccion } from '../mandato/acciones';
import { evaluarAccion, type AccionPropuesta, type ContextoEjecucion } from '../mandato/gates';

// ─────────────────────────────────────────────────────────────────────────────
// 1 · WHITELIST DE CAPACIDADES REALES
// ─────────────────────────────────────────────────────────────────────────────

/** Única capacidad real habilitada para el primer canary. Todo lo demás se DENIEGA. */
export type CanaryCapability = 'ADD_NEGATIVE_KEYWORD_EXACT';
export const CAPACIDADES_CANARY_PERMITIDAS: readonly CanaryCapability[] = ['ADD_NEGATIVE_KEYWORD_EXACT'];

/** Mapea una acción de dominio a su capacidad canary, o `null` si no está en la whitelist. */
export function capacidadCanaryDe(tipo: TipoAccion): CanaryCapability | null {
  return tipo === 'SEARCH_TERM_EXCLUDE' ? 'ADD_NEGATIVE_KEYWORD_EXACT' : null;
}
export function esCapacidadCanaryPermitida(tipo: TipoAccion): boolean {
  return capacidadCanaryDe(tipo) !== null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2 · CREDENCIAL DE ESCRITURA (contrato; sin token todavía)
// ─────────────────────────────────────────────────────────────────────────────

export interface CredencialWrite {
  /** Referencia OPACA a la credencial de escritura. `null` = no configurada (fail-closed). */
  readonly credentialRef: string | null;
  readonly organizationId: string;
  readonly provider: string;
  readonly externalAccountId: string;
  readonly permissionScope: 'WRITE';
  readonly capabilities: readonly CanaryCapability[];
}

export type EstadoCapacidadWrite = 'READY' | 'NOT_READY';

/**
 * ¿Está lista la capacidad de escritura para una organización/cuenta/capacidad? Fail-closed:
 * sin credentialRef, de otra org/cuenta, sin la capacidad o sin scope WRITE ⇒ NOT_READY.
 * NUNCA reutiliza la credencial de lectura.
 */
export function estadoCapacidadWrite(
  cred: CredencialWrite | null,
  org: string,
  externalAccountId: string,
  capacidad: CanaryCapability,
): { estado: EstadoCapacidadWrite; motivo: string } {
  if (!cred || !cred.credentialRef) return { estado: 'NOT_READY', motivo: 'WRITE_CREDENTIAL_NOT_CONFIGURED' };
  if (cred.permissionScope !== 'WRITE') return { estado: 'NOT_READY', motivo: 'CREDENTIAL_NOT_WRITE_SCOPE' };
  if (cred.organizationId !== org || cred.externalAccountId !== externalAccountId)
    return { estado: 'NOT_READY', motivo: 'WRITE_CREDENTIAL_CROSS_TENANT' };
  if (!cred.capabilities.includes(capacidad)) return { estado: 'NOT_READY', motivo: 'CAPABILITY_NOT_IN_CREDENTIAL' };
  // Detecta reutilización silenciosa de la credencial de lectura.
  if (/refresh_token|read/i.test(cred.credentialRef) && !/write/i.test(cred.credentialRef))
    return { estado: 'NOT_READY', motivo: 'LOOKS_LIKE_READ_CREDENTIAL' };
  return { estado: 'READY', motivo: 'ok' };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3 · LÍMITES DEL CANARY
// ─────────────────────────────────────────────────────────────────────────────

export const LIMITES_CANARY = {
  MAX_REAL_ACTIONS: 1,
  MAX_CAMPAIGNS_TOUCHED: 1,
  MAX_TARGETS: 1,
  FINANCIAL_IMPACT_MAX: 0,
  REVERSIBLE_OBLIGATORIO: true,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// 4 · CANDIDATO CANARY + ABSTENCIÓN
// ─────────────────────────────────────────────────────────────────────────────

export const NO_ACTION_REQUIRED = 'NO_ACTION_REQUIRED' as const;

export interface PlanRollbackCanary {
  readonly tipo: 'REMOVE_ONLY_ENTITY_CREATED_BY_ACTION_ID';
  readonly actionId: string;
  /** Se completa DESPUÉS de la (futura) ejecución real; nunca borra entidades ajenas. */
  readonly createdResourceName: string | null;
  readonly beforeState: string;
  readonly expectedAfterState: string;
}

export interface CanaryCandidate {
  readonly actionId: string;
  readonly capability: CanaryCapability;
  readonly organizationId: string;
  readonly externalAccountId: string;
  readonly campaignId: string;
  readonly targetId: string;
  readonly desiredState: string;
  readonly evidencia: { readonly muestra: number; readonly ventanaHoras: number; readonly confianza?: number };
  readonly expectedEffect: string;
  readonly risk: 'bajo' | 'medio' | 'alto';
  readonly rollbackPlan: PlanRollbackCanary;
  readonly mandateVersion: number;
  /** Instante de la evidencia usada; base para detectar obsolescencia (staleness). */
  readonly freshnessAt: string;
}

export type ResultadoCandidato =
  | { readonly estado: 'NONE'; readonly motivo: string }
  | { readonly estado: 'CANDIDATE'; readonly candidato: CanaryCandidate };

/**
 * Deriva un CANDIDATO canary de una acción propuesta, o `NONE` (abstención) si no cumple TODO.
 * Exige: gates EXECUTE + capacidad en whitelist + reversible + no financiera + rollback disponible +
 * dentro de los límites del canary. NUNCA fuerza una acción: si no hay, `NONE` es un PASS.
 */
export function evaluarCandidatoCanary(
  accion: AccionPropuesta,
  ctx: ContextoEjecucion,
  campaignId: string,
): ResultadoCandidato {
  const gate = evaluarAccion(accion, ctx);
  if (gate.decision !== 'EXECUTE') return { estado: 'NONE', motivo: `GATE_${gate.razon}` };

  if (!esCapacidadCanaryPermitida(accion.tipo)) return { estado: 'NONE', motivo: 'CAPABILITY_NOT_WHITELISTED' };

  const meta = metaDeAccion(accion.tipo);
  if (meta.reversibilidad !== 'REVERSIBLE') return { estado: 'NONE', motivo: 'NOT_REVERSIBLE' };
  if (meta.financiera || (accion.montoCambio ?? 0) !== 0) return { estado: 'NONE', motivo: 'FINANCIAL_IMPACT_NOT_ZERO' };
  if (!accion.rollbackDisponible) return { estado: 'NONE', motivo: 'ROLLBACK_UNAVAILABLE' };

  const capability = capacidadCanaryDe(accion.tipo)!;
  return {
    estado: 'CANDIDATE',
    candidato: {
      actionId: accion.actionId,
      capability,
      organizationId: accion.organizationId,
      externalAccountId: accion.externalAccountId,
      campaignId,
      targetId: accion.targetId,
      desiredState: accion.desiredState,
      evidencia: { muestra: accion.evidencia.muestra, ventanaHoras: accion.evidencia.ventanaHoras, ...(accion.evidencia.confianza !== undefined ? { confianza: accion.evidencia.confianza } : {}) },
      expectedEffect: 'dejar de mostrar el anuncio para un término irrelevante; sin impacto directo de gasto',
      risk: 'bajo',
      rollbackPlan: {
        tipo: 'REMOVE_ONLY_ENTITY_CREATED_BY_ACTION_ID',
        actionId: accion.actionId,
        createdResourceName: null,
        beforeState: 'sin la negativa',
        expectedAfterState: accion.desiredState,
      },
      mandateVersion: accion.mandateVersionVista,
      freshnessAt: ctx.ahora,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5 · STALENESS (la evidencia de la aprobación debe seguir vigente)
// ─────────────────────────────────────────────────────────────────────────────

export type Frescura = 'FRESH' | 'STALE' | 'SUPERSEDED';

/** Compara el candidato con la evidencia ACTUAL. Si cambió la muestra o el mandato ⇒ obsoleto. */
export function evaluarFrescura(
  candidato: CanaryCandidate,
  actual: { muestra: number; mandateVersion: number },
): Frescura {
  if (actual.mandateVersion !== candidato.mandateVersion) return 'SUPERSEDED';
  if (actual.muestra !== candidato.evidencia.muestra) return 'STALE';
  return 'FRESH';
}

// ─────────────────────────────────────────────────────────────────────────────
// 6 · READ-BACK REAL (contrato; no ejecuta)
// ─────────────────────────────────────────────────────────────────────────────

export interface VerificacionReadBack {
  readonly expected: string;
  readonly actual: string | null;
  readonly verificado: boolean;
}
export function verificarReadBack(expected: string, actual: string | null): VerificacionReadBack {
  return { expected, actual, verificado: actual !== null && actual === expected };
}

// ─────────────────────────────────────────────────────────────────────────────
// 7 · PRE-MUTATE CHECK (revalidación total justo antes de un futuro mutate)
// ─────────────────────────────────────────────────────────────────────────────

export interface EntradaPreMutate {
  readonly candidato: CanaryCandidate;
  readonly accion: AccionPropuesta;
  readonly ctx: ContextoEjecucion; // mandato/kill/budget/velocity/cooldown/idempotencia/evidencia ACTUALES
  readonly credWrite: CredencialWrite | null;
  readonly autonomousReal: boolean; // interruptor maestro global
  readonly evidenciaActual: { muestra: number; mandateVersion: number };
}

export interface ResultadoPreMutate {
  /** Mientras WRITE esté apagado, es SIEMPRE `false`. */
  readonly puedeMutar: boolean;
  readonly razon: string;
  readonly writeEstado: EstadoCapacidadWrite;
  readonly frescura: Frescura;
  readonly traza: readonly string[];
}

/**
 * Revalida TODO inmediatamente antes de un futuro mutate. Fail-closed y ordenado: gates → capacidad →
 * frescura → credencial WRITE → interruptor maestro. Hoy `puedeMutar` es siempre `false` porque no hay
 * credencial de escritura y `autonomousReal` es `false`.
 */
export function preMutateCheck(e: EntradaPreMutate): ResultadoPreMutate {
  const traza: string[] = [];
  const capability = e.candidato.capability;
  const writeEstado = estadoCapacidadWrite(e.credWrite, e.candidato.organizationId, e.candidato.externalAccountId, capability);
  const frescura = evaluarFrescura(e.candidato, e.evidenciaActual);

  const gate = evaluarAccion(e.accion, e.ctx);
  traza.push(`gate=${gate.decision}:${gate.razon}`);
  if (gate.decision !== 'EXECUTE') return no(gate.razon, writeEstado.estado, frescura, traza);

  if (!esCapacidadCanaryPermitida(e.accion.tipo)) return no('CAPABILITY_NOT_WHITELISTED', writeEstado.estado, frescura, traza);
  traza.push('capability=whitelisted');

  if (frescura !== 'FRESH') return no(`EVIDENCE_${frescura}`, writeEstado.estado, frescura, traza);
  traza.push('freshness=FRESH');

  if (writeEstado.estado !== 'READY') return no(writeEstado.motivo, writeEstado.estado, frescura, traza);
  traza.push('write=READY');

  if (!e.autonomousReal) return no('REAL_EXECUTION_OFF', writeEstado.estado, frescura, traza);

  // Sólo aquí —jamás hoy— sería mutable. Y aun así, la mutación exige autorización humana explícita.
  return { puedeMutar: true, razon: 'ALL_PREMUTATE_GATES_PASSED', writeEstado: writeEstado.estado, frescura, traza };
}

function no(razon: string, writeEstado: EstadoCapacidadWrite, frescura: Frescura, traza: readonly string[]): ResultadoPreMutate {
  return { puedeMutar: false, razon, writeEstado, frescura, traza };
}
