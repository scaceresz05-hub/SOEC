/**
 * @soec/motor-operacion · dominio · COMPENSACIÓN (agregado event-sourced de primera clase).
 *
 * Acción inversa LÓGICA de un efecto ya aplicado. NO borra ni altera el efecto original; NO promete
 * revertir efectos externos irreversibles; en M7 sólo ejecuta una compensación SIMULADA. Identidad
 * determinista por ejecución lógica; doble compensación converge (idempotente). Multi-tenant.
 *
 * Estados: PENDIENTE → EN_EJECUCION → (COMPENSADA | FALLIDA) · o NO_APLICABLE (nada que compensar).
 */
import type { RecordedEvent } from '@soec/contracts';

export type EstadoCompensacion = 'PENDIENTE' | 'EN_EJECUCION' | 'COMPENSADA' | 'FALLIDA' | 'NO_APLICABLE';

export function compensacionId(organizacionId: string, ordenId: string, claveLogica: string): string {
  return `comp:${organizacionId}:${ordenId}:${claveLogica}`;
}

export function compensacionStreamId(organizacionId: string, cid: string): string {
  return `compensacion:${organizacionId}:${cid}`;
}

export interface CompensacionState {
  readonly organizacionId: string;
  readonly compensacionId: string;
  readonly version: number;
  readonly existe: boolean;
  readonly ordenId: string;
  readonly claveLogica: string;
  readonly motivo: string;
  readonly estado: EstadoCompensacion;
  readonly evidenciaRef: string | null;
  readonly resultado: string | null;
}

export const EVENTOS_COMPENSACION = {
  iniciada: 'compensacion.iniciada',
  ejecutando: 'compensacion.ejecutando',
  compensada: 'compensacion.compensada',
  fallida: 'compensacion.fallida',
  noAplicable: 'compensacion.no_aplicable',
} as const;

const TRANSICIONES: Readonly<Record<EstadoCompensacion, readonly EstadoCompensacion[]>> = {
  PENDIENTE: ['EN_EJECUCION', 'NO_APLICABLE'],
  EN_EJECUCION: ['COMPENSADA', 'FALLIDA'],
  COMPENSADA: [],
  FALLIDA: ['EN_EJECUCION'],
  NO_APLICABLE: [],
};

export function transicionCompensacionValida(desde: EstadoCompensacion, hacia: EstadoCompensacion): boolean {
  return (TRANSICIONES[desde] ?? []).includes(hacia);
}

export function estadoInicialCompensacion(organizacionId: string, cid: string): CompensacionState {
  return { organizacionId, compensacionId: cid, version: 0, existe: false, ordenId: '', claveLogica: '', motivo: '', estado: 'PENDIENTE', evidenciaRef: null, resultado: null };
}

export function aplicarCompensacion(state: CompensacionState, event: RecordedEvent): CompensacionState {
  const next = { ...state, version: state.version + 1 };
  switch (event.type) {
    case EVENTOS_COMPENSACION.iniciada: {
      if (state.existe) return next; // idempotente: doble compensación converge
      const p = event.payload as { ordenId: string; claveLogica: string; motivo: string };
      return { ...next, existe: true, ordenId: p.ordenId, claveLogica: p.claveLogica, motivo: p.motivo, estado: 'PENDIENTE' };
    }
    case EVENTOS_COMPENSACION.ejecutando:
      if (!transicionCompensacionValida(state.estado, 'EN_EJECUCION')) return next;
      return { ...next, estado: 'EN_EJECUCION' };
    case EVENTOS_COMPENSACION.compensada:
      if (!transicionCompensacionValida(state.estado, 'COMPENSADA')) return next;
      return { ...next, estado: 'COMPENSADA', evidenciaRef: (event.payload as { evidenciaRef?: string }).evidenciaRef ?? null, resultado: 'reverso lógico simulado' };
    case EVENTOS_COMPENSACION.fallida:
      if (!transicionCompensacionValida(state.estado, 'FALLIDA')) return next;
      return { ...next, estado: 'FALLIDA', resultado: (event.payload as { resultado?: string }).resultado ?? 'fallo' };
    case EVENTOS_COMPENSACION.noAplicable:
      if (!transicionCompensacionValida(state.estado, 'NO_APLICABLE')) return next;
      return { ...next, estado: 'NO_APLICABLE', resultado: (event.payload as { resultado?: string }).resultado ?? 'nada que compensar' };
    default:
      return next;
  }
}

export function reconstruirCompensacion(organizacionId: string, cid: string, events: readonly RecordedEvent[]): CompensacionState {
  return events.reduce(aplicarCompensacion, estadoInicialCompensacion(organizacionId, cid));
}
