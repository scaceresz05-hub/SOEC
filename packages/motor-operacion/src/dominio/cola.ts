/**
 * @soec/motor-operacion · dominio · COLA de trabajos operacionales con LEASE (agregado event-sourced).
 *
 * Cada trabajo tiene identidad DETERMINISTA (por orden + intento lógico), pertenece a una organización, y
 * se reclama con un LEASE que expira. Garantías: entrega AL MENOS UNA VEZ (el trabajo se puede reclamar de
 * nuevo si el lease vence); efectos EXACTAMENTE UNA VEZ por la clave de idempotencia del efecto (fuera de
 * aquí); recuperación de trabajos abandonados (lease vencido → reclamable); aislamiento multi-tenant (el
 * stream lleva la organización; nadie de otra org puede reclamarlo). Reloj INYECTADO (instantes ISO).
 *
 * Estados: DISPONIBLE → RECLAMADO → (COMPLETADO | FALLIDO). Un RECLAMADO con lease vencido vuelve a ser
 * reclamable (no cambia de estado en el log hasta que alguien lo re-reclama). Stream `trabajo:<org>:<id>`.
 */
import type { RecordedEvent } from '@soec/contracts';

export type EstadoTrabajo = 'DISPONIBLE' | 'RECLAMADO' | 'COMPLETADO' | 'FALLIDO';

export interface TrabajoState {
  readonly organizacionId: string;
  readonly trabajoId: string;
  readonly version: number;
  readonly existe: boolean;
  readonly ordenId: string;
  readonly intentoLogico: number;
  readonly prioridad: number;
  readonly disponibleDesde: string;
  readonly estado: EstadoTrabajo;
  /** Titular actual del lease (worker id) y su vencimiento ISO; null si no está reclamado. */
  readonly leaseTitular: string | null;
  readonly leaseVenceEn: string | null;
  readonly resultado: string | null;
}

export const EVENTOS_TRABAJO = {
  encolado: 'trabajo.encolado',
  reclamado: 'trabajo.reclamado',
  completado: 'trabajo.completado',
  fallido: 'trabajo.fallido',
} as const;

export function trabajoStreamId(organizacionId: string, trabajoId: string): string {
  return `trabajo:${organizacionId}:${trabajoId}`;
}

export function estadoInicialTrabajo(organizacionId: string, trabajoId: string): TrabajoState {
  return {
    organizacionId,
    trabajoId,
    version: 0,
    existe: false,
    ordenId: '',
    intentoLogico: 0,
    prioridad: 0,
    disponibleDesde: '',
    estado: 'DISPONIBLE',
    leaseTitular: null,
    leaseVenceEn: null,
    resultado: null,
  };
}

/** ¿El trabajo puede reclamarse AHORA? Disponible, o reclamado con lease VENCIDO (abandonado). */
export function reclamable(state: TrabajoState, ahora: string): boolean {
  if (!state.existe) return false;
  if (state.estado === 'COMPLETADO' || state.estado === 'FALLIDO') return false;
  if (state.estado === 'DISPONIBLE') return Date.parse(state.disponibleDesde) <= Date.parse(ahora);
  // RECLAMADO: solo si el lease venció.
  return state.leaseVenceEn !== null && Date.parse(state.leaseVenceEn) <= Date.parse(ahora);
}

interface PEncolado {
  ordenId: string;
  intentoLogico: number;
  prioridad: number;
  disponibleDesde: string;
}
interface PReclamado {
  titular: string;
  venceEn: string;
}

export function aplicarTrabajo(state: TrabajoState, event: RecordedEvent): TrabajoState {
  const next = { ...state, version: state.version + 1 };
  switch (event.type) {
    case EVENTOS_TRABAJO.encolado: {
      if (state.existe) return next; // idempotente por id determinista
      const p = event.payload as PEncolado;
      return { ...next, existe: true, ordenId: p.ordenId, intentoLogico: p.intentoLogico, prioridad: p.prioridad, disponibleDesde: p.disponibleDesde, estado: 'DISPONIBLE' };
    }
    case EVENTOS_TRABAJO.reclamado: {
      const p = event.payload as PReclamado;
      return { ...next, estado: 'RECLAMADO', leaseTitular: p.titular, leaseVenceEn: p.venceEn };
    }
    case EVENTOS_TRABAJO.completado: {
      const p = event.payload as { resultado: string };
      return { ...next, estado: 'COMPLETADO', resultado: p.resultado, leaseTitular: null, leaseVenceEn: null };
    }
    case EVENTOS_TRABAJO.fallido: {
      const p = event.payload as { resultado: string };
      return { ...next, estado: 'FALLIDO', resultado: p.resultado, leaseTitular: null, leaseVenceEn: null };
    }
    default:
      return next;
  }
}

export function reconstruirTrabajo(organizacionId: string, trabajoId: string, events: readonly RecordedEvent[]): TrabajoState {
  return events.reduce(aplicarTrabajo, estadoInicialTrabajo(organizacionId, trabajoId));
}
