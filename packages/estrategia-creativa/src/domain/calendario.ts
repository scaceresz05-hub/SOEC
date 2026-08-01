/**
 * @soec/estrategia-creativa · dominio · Calendario editorial de PRIMERA CLASE (Tramo 5, M3).
 *
 * Asocia piezas/variantes a slots de publicación con estados gobernados. Reglas: no se programa
 * contenido no aprobado; no se solapan piezas del mismo canal en el mismo instante; la publicación
 * simulada nunca se presenta como real (naturaleza SIMULADO); la reprogramación es trazable y el
 * historial se conserva (event-sourced). Multi-tenant. No produce efectos externos.
 */
import type { RecordedEvent } from '@soec/contracts';

export type EstadoEntrada = 'BORRADOR' | 'PENDIENTE_APROBACION' | 'APROBADA' | 'PROGRAMADA_SIMULADA' | 'PUBLICADA_SIMULADA' | 'CANCELADA';

export interface EntradaCalendario {
  readonly entradaId: string;
  readonly fechaHora: string;
  readonly canal: string;
  readonly piezaId: string;
  readonly varianteId: string | null;
  readonly objetivo: string;
  readonly segmento: string;
  readonly estado: EstadoEntrada;
  readonly naturaleza: 'SIMULADO';
}

export interface CalendarioState {
  readonly organizacionId: string;
  readonly programaId: string;
  readonly version: number;
  readonly existe: boolean;
  readonly zonaHoraria: string;
  readonly entradas: readonly EntradaCalendario[];
}

export const EVENTOS_CAL = {
  creado: 'cal.creado',
  entrada: 'cal.entrada_agregada',
  transicion: 'cal.entrada_transicionada',
} as const;

export function calendarioStreamId(organizacionId: string, programaId: string): string {
  return `calendario:${organizacionId}:${programaId}`;
}

export function estadoInicialCalendario(organizacionId: string, programaId: string): CalendarioState {
  return { organizacionId, programaId, version: 0, existe: false, zonaHoraria: 'UTC', entradas: [] };
}

const OCUPAN: readonly EstadoEntrada[] = ['PROGRAMADA_SIMULADA', 'PUBLICADA_SIMULADA'];

/** Transiciones válidas del estado de una entrada del calendario. */
export function transicionCalValida(desde: EstadoEntrada, hacia: EstadoEntrada): boolean {
  if (hacia === 'CANCELADA') return desde !== 'PUBLICADA_SIMULADA';
  const flujo: Record<EstadoEntrada, readonly EstadoEntrada[]> = {
    BORRADOR: ['PENDIENTE_APROBACION'],
    PENDIENTE_APROBACION: ['APROBADA', 'BORRADOR'],
    APROBADA: ['PROGRAMADA_SIMULADA'],
    PROGRAMADA_SIMULADA: ['PUBLICADA_SIMULADA', 'APROBADA'], // reprogramar vuelve a APROBADA (trazable)
    PUBLICADA_SIMULADA: [],
    CANCELADA: [],
  };
  return flujo[desde].includes(hacia);
}

/** ¿La entrada `nueva` solapa con una ya OCUPANTE del mismo canal en el mismo instante? */
export function haySolape(entradas: readonly EntradaCalendario[], canal: string, fechaHora: string, exceptoId?: string): boolean {
  return entradas.some((e) => e.entradaId !== exceptoId && e.canal === canal && e.fechaHora === fechaHora && OCUPAN.includes(e.estado));
}

export function aplicarCalendario(state: CalendarioState, event: RecordedEvent): CalendarioState {
  const next = { ...state, version: state.version + 1 };
  switch (event.type) {
    case EVENTOS_CAL.creado: {
      const p = event.payload as { zonaHoraria: string };
      return { ...next, existe: true, zonaHoraria: p.zonaHoraria };
    }
    case EVENTOS_CAL.entrada: {
      const p = event.payload as EntradaCalendario;
      if (state.entradas.some((e) => e.entradaId === p.entradaId)) return next; // idempotente
      return { ...next, entradas: [...state.entradas, p] };
    }
    case EVENTOS_CAL.transicion: {
      const p = event.payload as { entradaId: string; estado: EstadoEntrada; fechaHora?: string };
      return { ...next, entradas: state.entradas.map((e) => (e.entradaId === p.entradaId ? { ...e, estado: p.estado, ...(p.fechaHora ? { fechaHora: p.fechaHora } : {}) } : e)) };
    }
    default:
      return next;
  }
}

export function reconstruirCalendario(organizacionId: string, programaId: string, events: readonly RecordedEvent[]): CalendarioState {
  return events.reduce(aplicarCalendario, estadoInicialCalendario(organizacionId, programaId));
}
