/**
 * @soec/cia · dominio · PLAN DE ACCIÓN EXTERNA (event-sourced, ciclo de vida completo) + decisión pura.
 *
 * Dado un objetivo y una capacidad AUTORIZADA, SOEC decide QUÉ herramienta usar detrás de la frontera y
 * gobierna la acción por su ciclo de vida:
 *
 *   PROPUESTO → PENDIENTE_APROBACION → AUTORIZADO → PROGRAMADO → EN_EJECUCION → COMPLETADO_SIMULADO
 *                                                                             ↘ ABSTENIDO / FALLIDO
 *   (en cualquier punto no terminal) → CANCELADO / OBSOLETO
 *
 * Distingue ACCIÓN LÓGICA (identidad idempotente `claveLogica` + `huella` de contenido) del INTENTO técnico y
 * del PROVEEDOR interno (opaco, sólo auditoría). Misma clave + mismo contenido converge; misma clave + otro
 * contenido = conflicto. El efecto es SIEMPRE SIMULADO.
 */
import type { RecordedEvent } from '@soec/contracts';
import type { CapacidadMarketing } from './catalogo';
import { disponibleSimulado, nivelEfectivo, riesgoEfectivo, type AutorizacionState } from './autorizacion';
import { estaBloqueada, type KillSwitchState } from './kill-switch';

export type EstadoPlan =
  | 'PROPUESTO' | 'PENDIENTE_APROBACION' | 'AUTORIZADO' | 'PROGRAMADO' | 'EN_EJECUCION'
  | 'COMPLETADO_SIMULADO' | 'ABSTENIDO' | 'FALLIDO' | 'CANCELADO' | 'OBSOLETO';

const TERMINALES: readonly EstadoPlan[] = ['COMPLETADO_SIMULADO', 'ABSTENIDO', 'FALLIDO', 'CANCELADO', 'OBSOLETO'];
export function esPlanTerminal(e: EstadoPlan): boolean { return TERMINALES.includes(e); }

export interface PlanState {
  readonly organizationId: string;
  readonly planId: string;
  readonly version: number;
  readonly existe: boolean;
  readonly estado: EstadoPlan;
  readonly capacidadId: string;
  readonly objetivo: string;
  readonly costoEstimado: number;
  readonly requiereAprobacion: boolean;
  /** Identidad de la ACCIÓN LÓGICA (idempotencia). Un cambio de proveedor NO crea otra acción lógica. */
  readonly claveLogica: string;
  /** Huella del CONTENIDO lógico (capacidad+objetivo+costo). Misma clave + otra huella = conflicto. */
  readonly huella: string;
  /** Proveedor elegido DETRÁS de la frontera. Opaco. Nunca en vistas de usuario. */
  readonly proveedorElegidoRef: string | null;
  /** Evidencia SIMULADA producida al ejecutar (nunca datos reales). */
  readonly evidenciaSimulada: string | null;
  readonly aprobadoPor: string | null;
}

export const EVENTOS_PLAN = {
  propuesta: 'cia.plan.propuesta',
  aprobacionRequerida: 'cia.plan.aprobacion_requerida',
  autorizado: 'cia.plan.autorizado',
  programado: 'cia.plan.programado',
  enEjecucion: 'cia.plan.en_ejecucion',
  completadoSimulado: 'cia.plan.completado_simulado',
  abstenido: 'cia.plan.abstenido',
  fallido: 'cia.plan.fallido',
  cancelado: 'cia.plan.cancelado',
  obsoleto: 'cia.plan.obsoleto',
} as const;

export function planStreamId(org: string, planId: string): string { return `cia-plan:${org}:${planId}`; }

export function estadoInicialPlan(org: string, planId: string): PlanState {
  return {
    organizationId: org, planId, version: 0, existe: false, estado: 'PROPUESTO',
    capacidadId: '', objetivo: '', costoEstimado: 0, requiereAprobacion: true,
    claveLogica: '', huella: '', proveedorElegidoRef: null, evidenciaSimulada: null, aprobadoPor: null,
  };
}

interface PayloadPropuesta {
  readonly capacidadId: string; readonly objetivo: string; readonly costoEstimado: number;
  readonly requiereAprobacion: boolean; readonly proveedorElegidoRef: string; readonly claveLogica: string; readonly huella: string;
}
interface PayloadAutorizado { readonly aprobadoPor: string | null }
interface PayloadEjecutada { readonly evidenciaSimulada: string }

export function aplicarPlan(state: PlanState, event: RecordedEvent): PlanState {
  const next = { ...state, version: state.version + 1 };
  switch (event.type) {
    case EVENTOS_PLAN.propuesta: {
      const p = event.payload as PayloadPropuesta;
      return { ...next, existe: true, estado: 'PROPUESTO', capacidadId: p.capacidadId, objetivo: p.objetivo, costoEstimado: p.costoEstimado, requiereAprobacion: p.requiereAprobacion, proveedorElegidoRef: p.proveedorElegidoRef, claveLogica: p.claveLogica, huella: p.huella };
    }
    case EVENTOS_PLAN.aprobacionRequerida:
      return { ...next, estado: 'PENDIENTE_APROBACION' };
    case EVENTOS_PLAN.autorizado: {
      const p = event.payload as PayloadAutorizado;
      return { ...next, estado: 'AUTORIZADO', aprobadoPor: p.aprobadoPor };
    }
    case EVENTOS_PLAN.programado: return { ...next, estado: 'PROGRAMADO' };
    case EVENTOS_PLAN.enEjecucion: return { ...next, estado: 'EN_EJECUCION' };
    case EVENTOS_PLAN.completadoSimulado: {
      const p = event.payload as PayloadEjecutada;
      return { ...next, estado: 'COMPLETADO_SIMULADO', evidenciaSimulada: p.evidenciaSimulada };
    }
    case EVENTOS_PLAN.abstenido: {
      const p = event.payload as PayloadEjecutada;
      return { ...next, estado: 'ABSTENIDO', evidenciaSimulada: p.evidenciaSimulada };
    }
    case EVENTOS_PLAN.fallido: return { ...next, estado: 'FALLIDO' };
    case EVENTOS_PLAN.cancelado: return { ...next, estado: 'CANCELADO' };
    case EVENTOS_PLAN.obsoleto: return { ...next, estado: 'OBSOLETO' };
    default: return next;
  }
}

export function reconstruirPlan(org: string, planId: string, eventos: readonly RecordedEvent[]): PlanState {
  return eventos.reduce(aplicarPlan, estadoInicialPlan(org, planId));
}

/** Huella determinista del contenido lógico (FNV-1a). No criptográfica: sólo detección de cambio. */
export function huellaContenido(capacidadId: string, objetivo: string, costoEstimado: number): string {
  const s = `${capacidadId}|${objetivo}|${costoEstimado}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

// ─────────────────────────────────────────────────────────────────────────────
// Decisión pura del planificador — detrás de la frontera
// ─────────────────────────────────────────────────────────────────────────────

export interface Decision {
  readonly permitido: boolean;
  readonly motivo: 'kill_switch' | 'no_autorizada' | 'solo_observar' | 'excede_limite' | 'requiere_aprobacion' | 'ejecutable_auto';
  readonly requiereAprobacion: boolean;
  readonly ejecutableAuto: boolean;
}

export function elegirProveedor(cap: CapacidadMarketing, override?: string): string {
  if (override && cap.proveedoresRef.includes(override)) return override;
  return cap.proveedoresRef[0] ?? 'sin-proveedor';
}

export function decidirPlan(auth: AutorizacionState, kill: KillSwitchState, cap: CapacidadMarketing, costoEstimado: number): Decision {
  if (estaBloqueada(kill, cap.id)) return { permitido: false, motivo: 'kill_switch', requiereAprobacion: false, ejecutableAuto: false };
  if (auth.estado !== 'AUTORIZADA') return { permitido: false, motivo: 'no_autorizada', requiereAprobacion: false, ejecutableAuto: false };
  const nivel = nivelEfectivo(auth);
  if (nivel === 'SOLO_OBSERVAR') return { permitido: false, motivo: 'solo_observar', requiereAprobacion: false, ejecutableAuto: false };
  const excede = cap.unidadLimite !== 'SIN_GASTO' && costoEstimado > disponibleSimulado(auth);
  // Riesgo alto = acción reservada al humano: NI SIQUIERA el nivel automático la ejecuta sola.
  const reservadaAlHumano = riesgoEfectivo(auth) === 'alto';
  const auto = nivel === 'EJECUTAR_AUTOMATICO' && !excede && !reservadaAlHumano;
  return {
    permitido: true,
    motivo: excede ? 'excede_limite' : auto ? 'ejecutable_auto' : 'requiere_aprobacion',
    requiereAprobacion: !auto,
    ejecutableAuto: auto,
  };
}
