/**
 * @soec/cia · dominio · RESERVA DE PRESUPUESTO (event-sourced).
 *
 * El presupuesto sigue el ciclo: estimar → validar → RESERVAR → ejecutar → CONFIRMAR consumo | LIBERAR.
 * Una reserva bloquea disponibilidad ANTES del efecto (simulado); al terminar, se confirma (pasa a consumo)
 * o se libera (vuelve a estar disponible). Todo SIMULADO/ESTIMADO, jamás dinero real.
 *
 *   RESERVADA → CONFIRMADA | LIBERADA | EXPIRADA | CANCELADA (terminales)
 */
import type { RecordedEvent } from '@soec/contracts';

export type EstadoReserva = 'RESERVADA' | 'CONFIRMADA' | 'LIBERADA' | 'EXPIRADA' | 'CANCELADA';

export interface ReservaState {
  readonly organizationId: string;
  readonly reservaId: string;
  readonly capacidadId: string;
  readonly monto: number;
  readonly estado: EstadoReserva;
  readonly version: number;
  readonly existe: boolean;
}

export const EVENTOS_RESERVA = {
  reservada: 'cia.reserva.reservada',
  confirmada: 'cia.reserva.confirmada',
  liberada: 'cia.reserva.liberada',
  expirada: 'cia.reserva.expirada',
  cancelada: 'cia.reserva.cancelada',
} as const;

export function reservaStreamId(org: string, reservaId: string): string { return `cia-reserva:${org}:${reservaId}`; }

export function estadoInicialReserva(org: string, reservaId: string): ReservaState {
  return { organizationId: org, reservaId, capacidadId: '', monto: 0, estado: 'RESERVADA', version: 0, existe: false };
}

interface PayloadReservada { readonly capacidadId: string; readonly monto: number }

export function aplicarReserva(state: ReservaState, event: RecordedEvent): ReservaState {
  const next = { ...state, version: state.version + 1 };
  switch (event.type) {
    case EVENTOS_RESERVA.reservada: { const p = event.payload as PayloadReservada; return { ...next, existe: true, estado: 'RESERVADA', capacidadId: p.capacidadId, monto: p.monto }; }
    case EVENTOS_RESERVA.confirmada: return { ...next, estado: 'CONFIRMADA' };
    case EVENTOS_RESERVA.liberada: return { ...next, estado: 'LIBERADA' };
    case EVENTOS_RESERVA.expirada: return { ...next, estado: 'EXPIRADA' };
    case EVENTOS_RESERVA.cancelada: return { ...next, estado: 'CANCELADA' };
    default: return next;
  }
}

export function reconstruirReserva(org: string, reservaId: string, eventos: readonly RecordedEvent[]): ReservaState {
  return eventos.reduce(aplicarReserva, estadoInicialReserva(org, reservaId));
}

export function esReservaTerminal(e: EstadoReserva): boolean { return e !== 'RESERVADA'; }
