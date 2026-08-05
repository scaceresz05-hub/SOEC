/**
 * @soec/cia · dominio · KILL-SWITCH (event-sourced).
 *
 * Detiene el efecto de golpe, a tres alcances: global (toda la organización), por capacidad, o —vía el modo—
 * global de despliegue (`AUTONOMOUS_REAL`). Un kill activo prevalece sobre cualquier autorización o plan: el
 * planificador rehúsa mientras esté puesto. Es reversible por acto humano y deja traza. No borra historia.
 */
import type { RecordedEvent } from '@soec/contracts';

/** Alcance del kill: 'ORG' detiene todo en la organización; cualquier otro valor es un `capacidadId`. */
export type AlcanceKill = 'ORG' | (string & {});

export interface KillSwitchState {
  readonly organizationId: string;
  readonly version: number;
  readonly activos: readonly string[]; // alcances con kill puesto
}

export const EVENTOS_KILL = {
  activado: 'cia.kill.activado',
  desactivado: 'cia.kill.desactivado',
} as const;

export function killStreamId(org: string): string {
  return `cia-killswitch:${org}`;
}

export function estadoInicialKill(org: string): KillSwitchState {
  return { organizationId: org, version: 0, activos: [] };
}

interface PayloadKill { readonly alcance: string }

export function aplicarKill(state: KillSwitchState, event: RecordedEvent): KillSwitchState {
  const next = { ...state, version: state.version + 1 };
  const p = event.payload as PayloadKill;
  switch (event.type) {
    case EVENTOS_KILL.activado:
      return state.activos.includes(p.alcance) ? next : { ...next, activos: [...state.activos, p.alcance] };
    case EVENTOS_KILL.desactivado:
      return { ...next, activos: state.activos.filter((a) => a !== p.alcance) };
    default:
      return next;
  }
}

export function reconstruirKill(org: string, eventos: readonly RecordedEvent[]): KillSwitchState {
  return eventos.reduce(aplicarKill, estadoInicialKill(org));
}

/** ¿Está bloqueada esta capacidad? Lo está si hay kill de organización o kill de esa capacidad. */
export function estaBloqueada(state: KillSwitchState, capacidadId: string): boolean {
  return state.activos.includes('ORG') || state.activos.includes(capacidadId);
}
