/**
 * @soec/motor-creativo · dominio · SOLICITUD DE APROBACIÓN canónica.
 *
 * Formaliza el paso "solicitud de aprobación" de la cadena: pieza/variante → SOLICITUD (PENDIENTE) →
 * decisión humana (externa, `AprobacionService`) → comprobación de vigencia → calendario. La solicitud
 * tiene identidad DETERMINISTA por (recurso, versión), es idempotente (no se duplica en reintentos) y NO
 * equivale a aprobación. Ante un cambio de versión (obsolescencia), la solicitud de la versión anterior
 * queda OBSOLETA y se emite una nueva para la versión vigente. Event-sourced, multi-tenant.
 */
import type { RecordedEvent } from '@soec/contracts';

/** Alineado con `TipoRecurso` de la aprobación canónica de M3, para consultar `estaAprobada` sin mapear. */
export type TipoRecursoSolicitud = 'PIEZA' | 'VARIANTE' | 'ESTRATEGIA_CREATIVA';

export type EstadoSolicitud = 'PENDIENTE' | 'APROBADA' | 'OBSOLETA';

export const EVENTOS_SOLICITUD = { registrada: 'creativo-solicitud.registrada' } as const;

export function solicitudDeterministaId(org: string, tipo: TipoRecursoSolicitud, resourceId: string, version: number): string {
  return `sol:${org}:${tipo}:${resourceId}:v${version}`;
}

export function solicitudStreamId(org: string, tipo: TipoRecursoSolicitud, resourceId: string): string {
  return `creativo-solicitud:${org}:${tipo}:${resourceId}`;
}

export interface RegistroSolicitud {
  readonly solicitudId: string;
  readonly version: number;
}

export interface SolicitudState {
  readonly organizacionId: string;
  readonly tipo: TipoRecursoSolicitud;
  readonly resourceId: string;
  readonly version: number;
  /** Una solicitud por versión (append-only); la historia se conserva. */
  readonly solicitudes: readonly RegistroSolicitud[];
}

export function estadoInicialSolicitud(org: string, tipo: TipoRecursoSolicitud, resourceId: string): SolicitudState {
  return { organizacionId: org, tipo, resourceId, version: 0, solicitudes: [] };
}

export function aplicarSolicitud(state: SolicitudState, event: RecordedEvent): SolicitudState {
  const next = { ...state, version: state.version + 1 };
  if (event.type !== EVENTOS_SOLICITUD.registrada) return next;
  const p = event.payload as RegistroSolicitud;
  if (state.solicitudes.some((s) => s.version === p.version)) return next; // idempotente por versión
  return { ...next, solicitudes: [...state.solicitudes, { solicitudId: p.solicitudId, version: p.version }] };
}

export function reconstruirSolicitud(org: string, tipo: TipoRecursoSolicitud, resourceId: string, events: readonly RecordedEvent[]): SolicitudState {
  return events.reduce(aplicarSolicitud, estadoInicialSolicitud(org, tipo, resourceId));
}
