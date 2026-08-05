/**
 * @soec/cia · dominio · AUTORIZACIÓN DE CAPACIDAD (event-sourced).
 *
 * Registra que una persona autorizó a SOEC a ejercer una CAPACIDAD (un resultado del catálogo) con un límite
 * y un nivel de autonomía. Es el corazón del principio del CIA: el usuario autoriza capacidades, no
 * herramientas. La autorización NUNCA nombra un proveedor. El nivel de autonomía reutiliza la semántica de
 * `@soec/autonomia` (M4-D); su enforcement autoritativo (la pausa prevalece, aprobaciones vencidas no
 * autorizan, SOEC no eleva su propia autonomía) se delega a ese guardián en la ejecución, no se reimplementa.
 */
import type { RecordedEvent } from '@soec/contracts';

export type EstadoAutorizacion = 'SOLICITADA' | 'AUTORIZADA' | 'SUSPENDIDA';

/** Niveles de autonomía del producto (alineados con `@soec/autonomia`/M4-D). */
export type NivelAutonomia = 'SOLO_OBSERVAR' | 'RECOMENDAR' | 'EJECUTAR_CON_APROBACION' | 'EJECUTAR_AUTOMATICO';

export interface AutorizacionState {
  readonly organizationId: string;
  readonly capacidadId: string;
  readonly version: number;
  readonly existe: boolean;
  readonly estado: EstadoAutorizacion;
  /** Límite que fija el usuario, en la unidad del catálogo. 0 = aún sin autorizar gasto/uso. */
  readonly limite: number;
  /** Consumo SIMULADO acumulado del período (nunca dinero real). */
  readonly consumidoSimulado: number;
  readonly nivelAutonomia: NivelAutonomia;
  readonly autorizadaPor: string | null;
}

export const EVENTOS_AUTORIZACION = {
  solicitada: 'cia.autorizacion.solicitada',
  autorizada: 'cia.autorizacion.autorizada',
  limiteFijado: 'cia.autorizacion.limite_fijado',
  suspendida: 'cia.autorizacion.suspendida',
  reactivada: 'cia.autorizacion.reactivada',
  consumoSimulado: 'cia.autorizacion.consumo_simulado',
} as const;

export function autorizacionStreamId(org: string, capacidadId: string): string {
  return `cia-autorizacion:${org}:${capacidadId}`;
}

export function estadoInicialAutorizacion(org: string, capacidadId: string): AutorizacionState {
  return {
    organizationId: org,
    capacidadId,
    version: 0,
    existe: false,
    estado: 'SOLICITADA',
    limite: 0,
    consumidoSimulado: 0,
    nivelAutonomia: 'RECOMENDAR',
    autorizadaPor: null,
  };
}

interface PayloadAutorizada { readonly limite: number; readonly nivelAutonomia: NivelAutonomia; readonly actorHumano: string }
interface PayloadLimite { readonly limite: number }
interface PayloadConsumo { readonly monto: number }

export function aplicarAutorizacion(state: AutorizacionState, event: RecordedEvent): AutorizacionState {
  const next = { ...state, version: state.version + 1 };
  switch (event.type) {
    case EVENTOS_AUTORIZACION.solicitada:
      return { ...next, existe: true, estado: 'SOLICITADA' };
    case EVENTOS_AUTORIZACION.autorizada: {
      const p = event.payload as PayloadAutorizada;
      return { ...next, existe: true, estado: 'AUTORIZADA', limite: p.limite, nivelAutonomia: p.nivelAutonomia, autorizadaPor: p.actorHumano };
    }
    case EVENTOS_AUTORIZACION.limiteFijado: {
      const p = event.payload as PayloadLimite;
      return { ...next, limite: p.limite };
    }
    case EVENTOS_AUTORIZACION.suspendida:
      return { ...next, estado: 'SUSPENDIDA' };
    case EVENTOS_AUTORIZACION.reactivada:
      return { ...next, estado: 'AUTORIZADA' };
    case EVENTOS_AUTORIZACION.consumoSimulado: {
      const p = event.payload as PayloadConsumo;
      return { ...next, consumidoSimulado: state.consumidoSimulado + p.monto };
    }
    default:
      return next;
  }
}

export function reconstruirAutorizacion(org: string, capacidadId: string, eventos: readonly RecordedEvent[]): AutorizacionState {
  return eventos.reduce(aplicarAutorizacion, estadoInicialAutorizacion(org, capacidadId));
}

/** Disponibilidad de consumo simulado restante bajo el límite. */
export function disponibleSimulado(state: AutorizacionState): number {
  return Math.max(0, state.limite - state.consumidoSimulado);
}
