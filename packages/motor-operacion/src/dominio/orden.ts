/**
 * @soec/motor-operacion · dominio · ORDEN DE EJECUCIÓN (agregado event-sourced, M7).
 *
 * La unidad operacional de SOEC: transforma un artefacto creativo APROBADO+VIGENTE+CALENDARIZADO de M6
 * en una ejecución gobernada, medible y recuperable — SIEMPRE SIMULADA. No re-piensa la estrategia (M5)
 * ni la dirección creativa (M6): referencia por id+versión y vuelve a validar contra `LecturaCreativa`.
 *
 * Máquina de estados EXPLÍCITA (11 estados, transiciones tabuladas; prohibido cualquier atajo):
 *   BORRADOR → VALIDADA → PROGRAMADA → EN_COLA → EN_EJECUCION → EJECUTADA_SIMULADA
 *   con ramas CANCELADA / EXPIRADA / OBSOLETA (antes de ejecutar), FALLIDA (tras ejecutar), y
 *   COMPENSADA (acción inversa lógica de una ejecución/fallo). Terminal: EJECUTADA_SIMULADA (salvo
 *   compensación), CANCELADA, COMPENSADA, EXPIRADA, OBSOLETA.
 *
 * Event-sourced, multi-tenant, stream `orden:<org>:<ordenId>`. Naturaleza SIEMPRE `SIMULADO`.
 */
import type { RecordedEvent } from '@soec/contracts';

export type EstadoOrden =
  | 'BORRADOR'
  | 'VALIDADA'
  | 'PROGRAMADA'
  | 'EN_COLA'
  | 'EN_EJECUCION'
  | 'EJECUTADA_SIMULADA'
  | 'FALLIDA'
  | 'CANCELADA'
  | 'COMPENSADA'
  | 'EXPIRADA'
  | 'OBSOLETA';

export const ESTADOS_TERMINALES: readonly EstadoOrden[] = ['EJECUTADA_SIMULADA', 'CANCELADA', 'COMPENSADA', 'EXPIRADA', 'OBSOLETA'] as const;

export function esTerminal(estado: EstadoOrden): boolean {
  return ESTADOS_TERMINALES.includes(estado);
}

/**
 * Clasificación SEMÁNTICA para M8 (medición/optimización). M8 no razona sobre el estado crudo de la FSM:
 * necesita saber si una orden es medible, y por qué no lo es. Determinista.
 *  - COMPLETA: ejecutada con evidencia (medible como resultado real-simulado).
 *  - PARCIAL: ejecutada SIN evidencia (anómala: efecto sin traza → no medir hasta reconciliar).
 *  - COMPENSADA / CANCELADA / OBSOLETA / EXPIRADA / FALLIDA: terminales no-exitosas (excluidas del KPI de éxito).
 *  - NO_RECONCILIADA: EN_EJECUCION (en curso o abandonada) → pendiente de reconciliación; nunca medir.
 *  - EN_PROCESO: BORRADOR/VALIDADA/PROGRAMADA/EN_COLA (aún no ejecutada).
 */
export type ClasificacionM8 =
  | 'COMPLETA' | 'PARCIAL' | 'COMPENSADA' | 'CANCELADA' | 'OBSOLETA' | 'EXPIRADA' | 'FALLIDA' | 'NO_RECONCILIADA' | 'EN_PROCESO';

export function clasificarM8(estado: EstadoOrden, tieneEvidencia: boolean): ClasificacionM8 {
  switch (estado) {
    case 'EJECUTADA_SIMULADA': return tieneEvidencia ? 'COMPLETA' : 'PARCIAL';
    case 'COMPENSADA': return 'COMPENSADA';
    case 'CANCELADA': return 'CANCELADA';
    case 'OBSOLETA': return 'OBSOLETA';
    case 'EXPIRADA': return 'EXPIRADA';
    case 'FALLIDA': return 'FALLIDA';
    case 'EN_EJECUCION': return 'NO_RECONCILIADA';
    default: return 'EN_PROCESO';
  }
}

/** ¿M8 puede medir esta orden como RESULTADO de ejecución? Solo COMPLETA. */
export function medibleM8(clas: ClasificacionM8): boolean {
  return clas === 'COMPLETA';
}

/** Transiciones VÁLIDAS de la orden. Cualquier otra combinación es un atajo prohibido. */
const TRANSICIONES: Readonly<Record<EstadoOrden, readonly EstadoOrden[]>> = {
  BORRADOR: ['VALIDADA', 'CANCELADA', 'OBSOLETA'],
  VALIDADA: ['PROGRAMADA', 'CANCELADA', 'OBSOLETA', 'EXPIRADA'],
  PROGRAMADA: ['EN_COLA', 'CANCELADA', 'OBSOLETA', 'EXPIRADA'],
  EN_COLA: ['EN_EJECUCION', 'CANCELADA', 'OBSOLETA', 'EXPIRADA'],
  EN_EJECUCION: ['EJECUTADA_SIMULADA', 'FALLIDA', 'EXPIRADA'], // la ventana pudo vencer mientras el trabajo estaba tomado
  FALLIDA: ['EN_COLA', 'COMPENSADA', 'CANCELADA'],
  EJECUTADA_SIMULADA: ['COMPENSADA'],
  CANCELADA: [],
  COMPENSADA: [],
  EXPIRADA: [],
  OBSOLETA: [],
};

export function transicionValida(desde: EstadoOrden, hacia: EstadoOrden): boolean {
  return (TRANSICIONES[desde] ?? []).includes(hacia);
}

/** Referencia versionada a un artefacto de M6 (base de la revalidación de vigencia). */
export interface RefVersionada {
  readonly id: string;
  readonly version: number;
}

/** Datos inmutables de la orden fijados al crearla desde M6 (referencias, nunca copias del contenido). */
export interface DatosOrden {
  readonly capacidad: string;
  readonly pieza: RefVersionada;
  readonly variante: RefVersionada | null;
  readonly calendario: { readonly programaId: string; readonly entradaId: string };
  readonly contextoId: string;
  readonly segmento: string;
  readonly canalLogico: string;
  readonly instantePlanificado: string;
  readonly zonaHoraria: string;
  readonly politicaVersion: string;
  readonly idempotencyKey: string;
}

export interface OrdenState {
  readonly organizacionId: string;
  readonly ordenId: string;
  readonly version: number;
  readonly existe: boolean;
  readonly estado: EstadoOrden;
  readonly datos: DatosOrden | null;
  readonly presupuestoReservado: number | null;
  readonly intentos: number;
  readonly naturaleza: 'SIMULADO';
  readonly evidenciaRefs: readonly string[];
  readonly motivo: string | null;
  readonly historial: readonly { readonly estado: EstadoOrden; readonly en: string }[];
}

export const EVENTOS_ORDEN = {
  creada: 'orden.creada',
  transicionada: 'orden.transicionada',
  intento: 'orden.intento_registrado',
  evidencia: 'orden.evidencia_adjuntada',
  presupuesto: 'orden.presupuesto_reservado',
} as const;

export function ordenStreamId(organizacionId: string, ordenId: string): string {
  return `orden:${organizacionId}:${ordenId}`;
}

export function estadoInicialOrden(organizacionId: string, ordenId: string): OrdenState {
  return {
    organizacionId,
    ordenId,
    version: 0,
    existe: false,
    estado: 'BORRADOR',
    datos: null,
    presupuestoReservado: null,
    intentos: 0,
    naturaleza: 'SIMULADO',
    evidenciaRefs: [],
    motivo: null,
    historial: [],
  };
}

interface PTransicion {
  estado: EstadoOrden;
  motivo?: string;
}

export function aplicarOrden(state: OrdenState, event: RecordedEvent): OrdenState {
  const next = { ...state, version: state.version + 1 };
  switch (event.type) {
    case EVENTOS_ORDEN.creada: {
      if (state.existe) return next; // idempotente ante recreación
      const p = event.payload as DatosOrden;
      return { ...next, existe: true, estado: 'BORRADOR', datos: p, historial: [{ estado: 'BORRADOR', en: event.recordedAt }] };
    }
    case EVENTOS_ORDEN.transicionada: {
      const p = event.payload as PTransicion;
      if (!transicionValida(state.estado, p.estado)) return next; // guarda dura: atajo ignorado en replay
      return { ...next, estado: p.estado, motivo: p.motivo ?? null, historial: [...state.historial, { estado: p.estado, en: event.recordedAt }] };
    }
    case EVENTOS_ORDEN.intento:
      return { ...next, intentos: state.intentos + 1 };
    case EVENTOS_ORDEN.evidencia: {
      const p = event.payload as { evidenciaRef: string };
      return { ...next, evidenciaRefs: [...state.evidenciaRefs, p.evidenciaRef] };
    }
    case EVENTOS_ORDEN.presupuesto: {
      const p = event.payload as { unidades: number };
      return { ...next, presupuestoReservado: p.unidades };
    }
    default:
      return next;
  }
}

export function reconstruirOrden(organizacionId: string, ordenId: string, events: readonly RecordedEvent[]): OrdenState {
  return events.reduce(aplicarOrden, estadoInicialOrden(organizacionId, ordenId));
}
