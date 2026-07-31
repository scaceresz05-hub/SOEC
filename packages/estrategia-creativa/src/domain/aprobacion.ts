/**
 * @soec/estrategia-creativa · dominio · Aprobación humana GRANULAR (Tramo G). Gate común y persistente
 * para estrategia/campaña/pieza/variante/entrada de calendario. Cada decisión se liga a un recurso Y a
 * una VERSIÓN concreta: si el recurso cambia de versión, la aprobación anterior deja de valer (no se
 * "hereda"). Aprobar un recurso NO aprueba sus dependientes. Event-sourced, multi-tenant, auditable.
 */
import type { RecordedEvent } from '@soec/contracts';

export type TipoRecurso = 'ESTRATEGIA_CREATIVA' | 'CAMPANIA' | 'PIEZA' | 'VARIANTE' | 'ENTRADA_CALENDARIO';
export type DecisionAprobacion = 'APROBADA' | 'RECHAZADA' | 'CAMBIOS_SOLICITADOS';

export interface Aprobacion {
  readonly approvalId: string;
  readonly organizationId: string;
  readonly resourceType: TipoRecurso;
  readonly resourceId: string;
  readonly resourceVersion: number;
  readonly actorUserId: string;
  readonly decision: DecisionAprobacion;
  readonly comment: string;
  readonly scope: string;
  readonly timestamp: string;
}

export interface AprobacionState {
  readonly organizationId: string;
  readonly resourceType: TipoRecurso;
  readonly resourceId: string;
  readonly version: number;
  readonly historial: readonly Aprobacion[];
  readonly ultima: Aprobacion | null;
}

export const EVENTOS_APROBACION = { decidida: 'aprobacion.decidida' } as const;

export function aprobacionStreamId(org: string, tipo: TipoRecurso, resourceId: string): string {
  return `aprobacion:${org}:${tipo}:${resourceId}`;
}

export function estadoInicialAprobacion(org: string, tipo: TipoRecurso, resourceId: string): AprobacionState {
  return { organizationId: org, resourceType: tipo, resourceId, version: 0, historial: [], ultima: null };
}

export function aplicarAprobacion(state: AprobacionState, event: RecordedEvent): AprobacionState {
  const next = { ...state, version: state.version + 1 };
  if (event.type === EVENTOS_APROBACION.decidida) {
    const a = event.payload as Aprobacion;
    return { ...next, historial: [...state.historial, a], ultima: a };
  }
  return next;
}

export function reconstruirAprobacion(org: string, tipo: TipoRecurso, resourceId: string, events: readonly RecordedEvent[]): AprobacionState {
  return events.reduce(aplicarAprobacion, estadoInicialAprobacion(org, tipo, resourceId));
}

/** Un recurso está aprobado SOLO si su última decisión es APROBADA y corresponde a esa versión exacta. */
export function estaAprobada(state: AprobacionState, resourceVersion: number): boolean {
  return state.ultima !== null && state.ultima.decision === 'APROBADA' && state.ultima.resourceVersion === resourceVersion;
}
