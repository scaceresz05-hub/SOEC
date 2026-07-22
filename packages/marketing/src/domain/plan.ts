/**
 * Plan operativo de marketing (F2-MKT-01) — versionado y ejecutable, NO un
 * documento estratégico. Contiene iniciativas → campañas → actividades, con
 * calendario y presupuesto. Máquina de estados explícita; una replanificación
 * produce una nueva versión conservando historia, motivo, evidencia y diferencias.
 */
import type { RecordedEvent } from '@soec/contracts';

export type EstadoPlan =
  | 'borrador'
  | 'validando'
  | 'listo'
  | 'parcialmente_bloqueado'
  | 'activo'
  | 'pausado'
  | 'agotado'
  | 'completado'
  | 'cancelado'
  | 'reemplazado';

export type EstadoActividad =
  | 'propuesta'
  | 'planificada'
  | 'bloqueada'
  | 'autorizable'
  | 'autorizada'
  | 'en_ejecucion'
  | 'ejecutada'
  | 'verificada'
  | 'fallida'
  | 'reintentable'
  | 'omitida'
  | 'cancelada';

export interface Iniciativa {
  readonly id: string;
  readonly nombre: string;
  readonly porque: string;
  readonly objetivoAtendido: string;
}
export interface Campania {
  readonly id: string;
  readonly iniciativaId: string;
  readonly nombre: string;
  readonly canal: string;
  readonly presupuesto: number;
  readonly porque: string;
}
export interface Actividad {
  readonly id: string;
  readonly campaniaId: string;
  readonly tipo: string;
  readonly canal: string;
  readonly contenido: string;
  readonly costo: number;
  readonly fechaProgramada: string;
  readonly estado: EstadoActividad;
  readonly motivoBloqueo: string | null;
  readonly explicacion: string;
  readonly supuestos: readonly string[];
  readonly faltantes: readonly string[];
  readonly accionExecutionId: string | null;
  readonly resultado: string | null;
  /** Referencia al paquete de contenido que desbloqueó la actividad (F2-CONT-01), si aplica. */
  readonly paqueteContenidoRef: string | null;
  /** Última optimización aplicada a la actividad (F2-MET-01), si aplica. */
  readonly optimizacion: string | null;
}

/** Registro append-only de una optimización aplicada al plan (F2-MET-01). */
export interface OptimizacionAplicada {
  readonly tipo: string;
  readonly actividadId: string;
  readonly valorAnterior: string;
  readonly valorNuevo: string;
  readonly motivo: string;
  readonly optRef: string;
  readonly en: string;
}
export interface Calendario {
  readonly zonaHoraria: string;
  readonly desde: string;
  readonly hasta: string;
  readonly diasPermitidos: readonly number[]; // 0=domingo … 6=sábado
  readonly frecuenciaDias: number;
}
export interface PresupuestoPlan {
  readonly total: number;
  readonly moneda: string;
  readonly porCampania: Readonly<Record<string, number>>;
}

export interface PlanVersionContenido {
  readonly planVersion: number;
  readonly objetivoRef: string;
  readonly policyId: string;
  readonly iniciativas: readonly Iniciativa[];
  readonly campanias: readonly Campania[];
  readonly actividades: readonly Actividad[];
  readonly calendario: Calendario;
  readonly presupuesto: PresupuestoPlan;
  readonly estado: EstadoPlan;
  readonly motivo: string;
}

export const EVENTOS_PLAN = {
  generado: 'plan.generado',
  replanificado: 'plan.replanificado',
  pausado: 'plan.pausado',
  reanudado: 'plan.reanudado',
  actividadTransicion: 'plan.actividad_transicion',
  actividadEjecutada: 'plan.actividad_ejecutada',
  actividadPreparada: 'plan.actividad_preparada',
  optimizado: 'plan.optimizado',
} as const;

export function planStreamId(planId: string): string {
  return `plan:${planId}`;
}

export interface PlanState {
  readonly planId: string;
  readonly organizationId: string;
  readonly version: number;
  readonly existe: boolean;
  readonly planVersion: number;
  readonly objetivoRef: string;
  readonly policyId: string;
  readonly estado: EstadoPlan;
  readonly iniciativas: readonly Iniciativa[];
  readonly campanias: readonly Campania[];
  readonly actividades: Readonly<Record<string, Actividad>>;
  readonly calendario: Calendario | null;
  readonly presupuesto: PresupuestoPlan | null;
  readonly historial: readonly { planVersion: number; motivo: string; en: string }[];
  readonly optimizaciones: readonly OptimizacionAplicada[];
}

export function estadoInicialPlan(planId: string, organizationId: string): PlanState {
  return {
    planId,
    organizationId,
    version: 0,
    existe: false,
    planVersion: 0,
    objetivoRef: '',
    policyId: '',
    estado: 'borrador',
    iniciativas: [],
    campanias: [],
    actividades: {},
    calendario: null,
    presupuesto: null,
    historial: [],
    optimizaciones: [],
  };
}

/** Transiciones válidas de una actividad (no se permiten otras). */
const TRANSICIONES_ACT: Readonly<Record<EstadoActividad, readonly EstadoActividad[]>> = {
  propuesta: ['planificada', 'bloqueada', 'cancelada'],
  planificada: ['autorizable', 'bloqueada', 'omitida', 'cancelada'],
  bloqueada: ['autorizable', 'planificada', 'omitida', 'cancelada'],
  autorizable: ['autorizada', 'bloqueada', 'omitida', 'cancelada'],
  autorizada: ['en_ejecucion', 'omitida', 'cancelada'],
  en_ejecucion: ['ejecutada', 'fallida', 'cancelada'],
  ejecutada: ['verificada', 'fallida'],
  verificada: [],
  fallida: ['reintentable', 'cancelada'],
  reintentable: ['autorizable', 'cancelada'],
  omitida: [],
  cancelada: [],
};

export function transicionValida(desde: EstadoActividad, hacia: EstadoActividad): boolean {
  return (TRANSICIONES_ACT[desde] ?? []).includes(hacia);
}

interface PayloadGenerado {
  contenido: PlanVersionContenido;
}
interface PayloadTransicion {
  actividadId: string;
  nuevoEstado: EstadoActividad;
  motivo: string;
}
interface PayloadEjecutada {
  actividadId: string;
  accionExecutionId: string;
  permitida: boolean;
  resultado: string;
  nuevoEstado: EstadoActividad;
}
interface PayloadPreparada {
  actividadId: string;
  contenido: string;
  paqueteContenidoRef: string;
}
interface PayloadOptimizado {
  optimizacion: OptimizacionAplicada;
  /** Estado destino de la actividad (p. ej. 'omitida' al pausar); null si no cambia. */
  nuevoEstadoActividad: EstadoActividad | null;
}

function cargarContenido(state: PlanState, next: PlanState, c: PlanVersionContenido, en: string): PlanState {
  return {
    ...next,
    existe: true,
    planVersion: c.planVersion,
    objetivoRef: c.objetivoRef,
    policyId: c.policyId,
    estado: c.estado,
    iniciativas: c.iniciativas,
    campanias: c.campanias,
    actividades: Object.fromEntries(c.actividades.map((a) => [a.id, a])),
    calendario: c.calendario,
    presupuesto: c.presupuesto,
    historial: [...state.historial, { planVersion: c.planVersion, motivo: c.motivo, en }],
  };
}

export function aplicarPlan(state: PlanState, event: RecordedEvent): PlanState {
  const next = { ...state, version: state.version + 1 };
  switch (event.type) {
    case EVENTOS_PLAN.generado:
    case EVENTOS_PLAN.replanificado: {
      const p = event.payload as PayloadGenerado;
      return cargarContenido(state, next, p.contenido, event.recordedAt);
    }
    case EVENTOS_PLAN.pausado:
      return { ...next, estado: 'pausado' };
    case EVENTOS_PLAN.reanudado:
      return { ...next, estado: 'activo' };
    case EVENTOS_PLAN.actividadTransicion: {
      const p = event.payload as PayloadTransicion;
      const a = state.actividades[p.actividadId];
      if (!a || !transicionValida(a.estado, p.nuevoEstado)) return next; // ignora transición inválida
      return { ...next, actividades: { ...state.actividades, [p.actividadId]: { ...a, estado: p.nuevoEstado, motivoBloqueo: p.nuevoEstado === 'bloqueada' ? p.motivo : a.motivoBloqueo } } };
    }
    case EVENTOS_PLAN.actividadEjecutada: {
      const p = event.payload as PayloadEjecutada;
      const a = state.actividades[p.actividadId];
      if (!a) return next;
      return {
        ...next,
        actividades: {
          ...state.actividades,
          [p.actividadId]: { ...a, estado: p.nuevoEstado, accionExecutionId: p.accionExecutionId, resultado: p.resultado },
        },
      };
    }
    case EVENTOS_PLAN.actividadPreparada: {
      const p = event.payload as PayloadPreparada;
      const a = state.actividades[p.actividadId];
      // Solo desbloquea actividades bloqueadas por falta de contenido; conserva la máquina de estados.
      if (!a || a.estado !== 'bloqueada' || a.motivoBloqueo !== 'contenido_faltante') return next;
      if (!transicionValida(a.estado, 'autorizable')) return next;
      return {
        ...next,
        actividades: {
          ...state.actividades,
          [p.actividadId]: { ...a, estado: 'autorizable', motivoBloqueo: null, contenido: p.contenido, paqueteContenidoRef: p.paqueteContenidoRef, faltantes: [] },
        },
      };
    }
    case EVENTOS_PLAN.optimizado: {
      const p = event.payload as PayloadOptimizado;
      const o = p.optimizacion;
      const a = state.actividades[o.actividadId];
      const optimizaciones = [...state.optimizaciones, o];
      if (!a) return { ...next, optimizaciones };
      // El efecto sobre la actividad es autoritativo (resultado de optimización autorizada).
      const actualizada: Actividad = { ...a, optimizacion: `${o.tipo}: ${o.motivo}`, estado: p.nuevoEstadoActividad ?? a.estado };
      return { ...next, optimizaciones, actividades: { ...state.actividades, [o.actividadId]: actualizada } };
    }
    default:
      return next;
  }
}

export function reconstruirPlan(planId: string, organizationId: string, events: readonly RecordedEvent[]): PlanState {
  return events.reduce(aplicarPlan, estadoInicialPlan(planId, organizationId));
}

/** Selecciona la próxima actividad ejecutable (autorizable, por fecha). */
export function siguienteActividad(state: PlanState): Actividad | null {
  const candidatas = Object.values(state.actividades)
    .filter((a) => a.estado === 'autorizable')
    .sort((x, y) => x.fechaProgramada.localeCompare(y.fechaProgramada) || x.id.localeCompare(y.id));
  return candidatas[0] ?? null;
}
