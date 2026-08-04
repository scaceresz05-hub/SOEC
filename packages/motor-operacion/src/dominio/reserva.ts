/**
 * @soec/motor-operacion · dominio · RESERVA PRESUPUESTARIA (agregado event-sourced).
 *
 * Ciclo: estimación conservadora → validación del límite → RESERVA → ejecución → CONFIRMACIÓN del consumo;
 * ante fallo/cancelación → LIBERACIÓN idempotente. Unidades LÓGICAS; naturaleza SIEMPRE `ESTIMADO`/`SIMULADO`,
 * nunca `REAL`. Identidad determinista por ejecución lógica (no por intento técnico). Multi-tenant.
 *
 * Estados: RESERVADA → (CONFIRMADA | LIBERADA | EXPIRADA | CANCELADA). Terminal salvo RESERVADA.
 */
import type { RecordedEvent } from '@soec/contracts';

export type EstadoReserva = 'RESERVADA' | 'CONFIRMADA' | 'LIBERADA' | 'EXPIRADA' | 'CANCELADA';

export function reservaId(organizacionId: string, ordenId: string, claveLogica: string): string {
  return `res:${organizacionId}:${ordenId}:${claveLogica}`;
}

export function reservaStreamId(organizacionId: string, rid: string): string {
  return `reserva:${organizacionId}:${rid}`;
}

export interface ReservaState {
  readonly organizacionId: string;
  readonly reservaId: string;
  readonly version: number;
  readonly existe: boolean;
  readonly ordenId: string;
  readonly claveLogica: string;
  readonly unidades: number;
  readonly naturaleza: 'ESTIMADO' | 'SIMULADO';
  readonly ventanaMs: number;
  readonly politicaVersion: string;
  readonly estado: EstadoReserva;
  readonly motivo: string | null;
  readonly creadaEn: string | null;
}

export const EVENTOS_RESERVA = {
  reservada: 'reserva.reservada',
  confirmada: 'reserva.confirmada',
  liberada: 'reserva.liberada',
  expirada: 'reserva.expirada',
  cancelada: 'reserva.cancelada',
} as const;

const TRANSICIONES: Readonly<Record<EstadoReserva, readonly EstadoReserva[]>> = {
  RESERVADA: ['CONFIRMADA', 'LIBERADA', 'EXPIRADA', 'CANCELADA'],
  CONFIRMADA: [],
  LIBERADA: [],
  EXPIRADA: [],
  CANCELADA: [],
};

export function transicionReservaValida(desde: EstadoReserva, hacia: EstadoReserva): boolean {
  return (TRANSICIONES[desde] ?? []).includes(hacia);
}

export function estadoInicialReserva(organizacionId: string, rid: string): ReservaState {
  return { organizacionId, reservaId: rid, version: 0, existe: false, ordenId: '', claveLogica: '', unidades: 0, naturaleza: 'ESTIMADO', ventanaMs: 0, politicaVersion: '', estado: 'RESERVADA', motivo: null, creadaEn: null };
}

interface PReservada {
  ordenId: string;
  claveLogica: string;
  unidades: number;
  ventanaMs: number;
  politicaVersion: string;
}

export function aplicarReserva(state: ReservaState, event: RecordedEvent): ReservaState {
  const next = { ...state, version: state.version + 1 };
  switch (event.type) {
    case EVENTOS_RESERVA.reservada: {
      if (state.existe) return next; // idempotente
      const p = event.payload as PReservada;
      return { ...next, existe: true, ordenId: p.ordenId, claveLogica: p.claveLogica, unidades: p.unidades, ventanaMs: p.ventanaMs, politicaVersion: p.politicaVersion, estado: 'RESERVADA', creadaEn: event.recordedAt };
    }
    case EVENTOS_RESERVA.confirmada:
      if (!transicionReservaValida(state.estado, 'CONFIRMADA')) return next;
      return { ...next, estado: 'CONFIRMADA' };
    case EVENTOS_RESERVA.liberada:
      if (!transicionReservaValida(state.estado, 'LIBERADA')) return next;
      return { ...next, estado: 'LIBERADA', motivo: (event.payload as { motivo?: string }).motivo ?? null };
    case EVENTOS_RESERVA.expirada:
      if (!transicionReservaValida(state.estado, 'EXPIRADA')) return next;
      return { ...next, estado: 'EXPIRADA' };
    case EVENTOS_RESERVA.cancelada:
      if (!transicionReservaValida(state.estado, 'CANCELADA')) return next;
      return { ...next, estado: 'CANCELADA', motivo: (event.payload as { motivo?: string }).motivo ?? null };
    default:
      return next;
  }
}

export function reconstruirReserva(organizacionId: string, rid: string, events: readonly RecordedEvent[]): ReservaState {
  return events.reduce(aplicarReserva, estadoInicialReserva(organizacionId, rid));
}

/** ¿La reserva compromete presupuesto ahora (RESERVADA o CONFIRMADA)? */
export function comprometeReserva(estado: EstadoReserva): boolean {
  return estado === 'RESERVADA' || estado === 'CONFIRMADA';
}
