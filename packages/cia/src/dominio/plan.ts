/**
 * @soec/cia · dominio · PLAN DE ACCIÓN EXTERNA (event-sourced) + decisión pura del planificador.
 *
 * Dado un objetivo y una capacidad AUTORIZADA, SOEC decide QUÉ herramienta usar detrás de la frontera y si la
 * acción puede ejecutarse (simulada) sola, requiere aprobación, o no procede. El proveedor elegido
 * (`proveedorElegidoRef`) es una referencia OPACA que nunca llega a la vista del usuario: sólo vive en la
 * auditoría. La decisión respeta kill-switch, límite y nivel de autonomía; el efecto siempre es SIMULADO.
 */
import type { RecordedEvent } from '@soec/contracts';
import type { CapacidadMarketing } from './catalogo';
import { disponibleSimulado, type AutorizacionState } from './autorizacion';
import { estaBloqueada, type KillSwitchState } from './kill-switch';

export type EstadoPlan = 'PLANIFICADA' | 'EJECUTADA_SIMULADA' | 'RECHAZADA';

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
  /** Proveedor elegido DETRÁS de la frontera. Opaco. Nunca en vistas de usuario. */
  readonly proveedorElegidoRef: string | null;
  /** Evidencia SIMULADA producida al ejecutar (nunca datos reales). */
  readonly evidenciaSimulada: string | null;
}

export const EVENTOS_PLAN = {
  planificada: 'cia.plan.planificada',
  ejecutadaSimulada: 'cia.plan.ejecutada_simulada',
  rechazada: 'cia.plan.rechazada',
} as const;

export function planStreamId(org: string, planId: string): string {
  return `cia-plan:${org}:${planId}`;
}

export function estadoInicialPlan(org: string, planId: string): PlanState {
  return {
    organizationId: org,
    planId,
    version: 0,
    existe: false,
    estado: 'PLANIFICADA',
    capacidadId: '',
    objetivo: '',
    costoEstimado: 0,
    requiereAprobacion: true,
    proveedorElegidoRef: null,
    evidenciaSimulada: null,
  };
}

interface PayloadPlanificada {
  readonly capacidadId: string;
  readonly objetivo: string;
  readonly costoEstimado: number;
  readonly requiereAprobacion: boolean;
  readonly proveedorElegidoRef: string;
}
interface PayloadEjecutada { readonly evidenciaSimulada: string }

export function aplicarPlan(state: PlanState, event: RecordedEvent): PlanState {
  const next = { ...state, version: state.version + 1 };
  switch (event.type) {
    case EVENTOS_PLAN.planificada: {
      const p = event.payload as PayloadPlanificada;
      return { ...next, existe: true, estado: 'PLANIFICADA', capacidadId: p.capacidadId, objetivo: p.objetivo, costoEstimado: p.costoEstimado, requiereAprobacion: p.requiereAprobacion, proveedorElegidoRef: p.proveedorElegidoRef };
    }
    case EVENTOS_PLAN.ejecutadaSimulada: {
      const p = event.payload as PayloadEjecutada;
      return { ...next, estado: 'EJECUTADA_SIMULADA', evidenciaSimulada: p.evidenciaSimulada };
    }
    case EVENTOS_PLAN.rechazada:
      return { ...next, estado: 'RECHAZADA' };
    default:
      return next;
  }
}

export function reconstruirPlan(org: string, planId: string, eventos: readonly RecordedEvent[]): PlanState {
  return eventos.reduce(aplicarPlan, estadoInicialPlan(org, planId));
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

/**
 * Elige el proveedor a usar DETRÁS de la frontera. Determinista (sin azar): toma el `override` si es un
 * candidato válido; si no, el primer candidato. Este es el punto donde «SOEC decide qué herramienta usar» —
 * y la elección es sustituible sin cambiar la experiencia del usuario.
 */
export function elegirProveedor(cap: CapacidadMarketing, override?: string): string {
  if (override && cap.proveedoresRef.includes(override)) return override;
  return cap.proveedoresRef[0] ?? 'sin-proveedor';
}

/** Evidencia SIMULADA determinista de un proveedor (stand-in del adaptador real, aún bloqueado). */
export function simularProveedor(proveedorElegidoRef: string, cap: CapacidadMarketing, costo: number): string {
  return `[SIMULADO] Capacidad "${cap.id}" ejecutada tras la frontera (consumo simulado ${costo}). Sin efecto real, sin red, sin gasto.`;
}

/** Decide si la acción procede y bajo qué régimen, respetando kill-switch, autorización, límite y autonomía. */
export function decidirPlan(auth: AutorizacionState, kill: KillSwitchState, cap: CapacidadMarketing, costoEstimado: number): Decision {
  if (estaBloqueada(kill, cap.id)) return { permitido: false, motivo: 'kill_switch', requiereAprobacion: false, ejecutableAuto: false };
  if (auth.estado !== 'AUTORIZADA') return { permitido: false, motivo: 'no_autorizada', requiereAprobacion: false, ejecutableAuto: false };
  if (auth.nivelAutonomia === 'SOLO_OBSERVAR') return { permitido: false, motivo: 'solo_observar', requiereAprobacion: false, ejecutableAuto: false };
  const excede = cap.unidadLimite !== 'SIN_GASTO' && costoEstimado > disponibleSimulado(auth);
  const auto = auth.nivelAutonomia === 'EJECUTAR_AUTOMATICO' && !excede;
  return {
    permitido: true,
    motivo: excede ? 'excede_limite' : auto ? 'ejecutable_auto' : 'requiere_aprobacion',
    requiereAprobacion: !auto,
    ejecutableAuto: auto,
  };
}
