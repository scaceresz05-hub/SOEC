/**
 * @soec/cia · dominio · AUTORIZACIÓN DE CAPACIDAD (event-sourced, ciclo de vida completo).
 *
 * Registra que una persona autorizó a SOEC a ejercer una CAPACIDAD (un resultado del catálogo) con unas
 * CONDICIONES (límite, nivel de autonomía, período, alcance, riesgo). El usuario autoriza capacidades, no
 * herramientas: aquí no hay proveedor. Ciclo de vida gobernado y distinto del de la capacidad PCE:
 *
 *   BORRADOR → PENDIENTE → AUTORIZADA ⇄ PAUSADA
 *                              ↓            ↓
 *                      REVOCADA / EXPIRADA / REEMPLAZADA / ELIMINADA (terminales)
 *
 * Regla de aprobación: una MODIFICACIÓN MATERIAL (cambia límite, autonomía, período, alcance o riesgo)
 * invalida la aprobación anterior y devuelve a PENDIENTE — nunca hereda una aprobación en silencio.
 * El nivel de autonomía reutiliza la semántica de `@soec/autonomia`/M4-D (enforcement en la ejecución).
 */
import type { RecordedEvent } from '@soec/contracts';

export type EstadoAutorizacion =
  | 'BORRADOR' | 'PENDIENTE' | 'AUTORIZADA' | 'PAUSADA'
  | 'REVOCADA' | 'EXPIRADA' | 'REEMPLAZADA' | 'ELIMINADA';

export type NivelAutonomia = 'SOLO_OBSERVAR' | 'RECOMENDAR' | 'EJECUTAR_CON_APROBACION' | 'EJECUTAR_AUTOMATICO';
export type Riesgo = 'bajo' | 'medio' | 'alto';

/** Condiciones que la persona autoriza. Cualquier cambio en ellas es MATERIAL. */
export interface CondicionesAutorizacion {
  readonly limite: number;
  readonly nivelAutonomia: NivelAutonomia;
  readonly periodo: string; // p. ej. 'MENSUAL'
  readonly alcance: string; // p. ej. 'organizacion'
  readonly riesgo: Riesgo;
}

export const CONDICIONES_POR_DEFECTO: CondicionesAutorizacion = {
  limite: 0, nivelAutonomia: 'RECOMENDAR', periodo: 'MENSUAL', alcance: 'organizacion', riesgo: 'bajo',
};

export interface AutorizacionState {
  readonly organizationId: string;
  readonly capacidadId: string;
  readonly version: number;
  readonly existe: boolean;
  readonly estado: EstadoAutorizacion;
  /** Condiciones vigentes (propuestas cuando PENDIENTE; aprobadas cuando AUTORIZADA). */
  readonly condiciones: CondicionesAutorizacion;
  /** Últimas condiciones efectivamente aprobadas por un humano (null si nunca). */
  readonly aprobadas: CondicionesAutorizacion | null;
  readonly consumidoSimulado: number;
  readonly autorizadaPor: string | null;
  readonly reemplazadaPor: string | null;
  readonly terminada: boolean;
}

export const EVENTOS_AUTORIZACION = {
  creada: 'cia.autorizacion.creada',
  aprobacionSolicitada: 'cia.autorizacion.aprobacion_solicitada',
  autorizada: 'cia.autorizacion.autorizada',
  modificada: 'cia.autorizacion.modificada',
  pausada: 'cia.autorizacion.pausada',
  reanudada: 'cia.autorizacion.reanudada',
  revocada: 'cia.autorizacion.revocada',
  expirada: 'cia.autorizacion.expirada',
  reemplazada: 'cia.autorizacion.reemplazada',
  eliminada: 'cia.autorizacion.eliminada',
  consumoSimulado: 'cia.autorizacion.consumo_simulado',
} as const;

export function autorizacionStreamId(org: string, capacidadId: string): string {
  return `cia-autorizacion:${org}:${capacidadId}`;
}

export function estadoInicialAutorizacion(org: string, capacidadId: string): AutorizacionState {
  return {
    organizationId: org, capacidadId, version: 0, existe: false, estado: 'BORRADOR',
    condiciones: CONDICIONES_POR_DEFECTO, aprobadas: null, consumidoSimulado: 0,
    autorizadaPor: null, reemplazadaPor: null, terminada: false,
  };
}

/** ¿Difieren materialmente dos condiciones? (límite, autonomía, período, alcance o riesgo). */
export function esCambioMaterial(a: CondicionesAutorizacion, b: CondicionesAutorizacion): boolean {
  return a.limite !== b.limite || a.nivelAutonomia !== b.nivelAutonomia || a.periodo !== b.periodo
    || a.alcance !== b.alcance || a.riesgo !== b.riesgo;
}

interface PayloadCondiciones { readonly condiciones: CondicionesAutorizacion }
interface PayloadAutorizada { readonly actorHumano: string }
interface PayloadReemplazada { readonly porAutorizacionId: string }
interface PayloadConsumo { readonly monto: number }

export function aplicarAutorizacion(state: AutorizacionState, event: RecordedEvent): AutorizacionState {
  const next = { ...state, version: state.version + 1 };
  switch (event.type) {
    case EVENTOS_AUTORIZACION.creada:
      return { ...next, existe: true, estado: 'BORRADOR' };
    case EVENTOS_AUTORIZACION.aprobacionSolicitada: {
      const p = event.payload as PayloadCondiciones;
      return { ...next, existe: true, estado: 'PENDIENTE', condiciones: p.condiciones };
    }
    case EVENTOS_AUTORIZACION.autorizada: {
      const p = event.payload as PayloadAutorizada;
      return { ...next, estado: 'AUTORIZADA', aprobadas: state.condiciones, autorizadaPor: p.actorHumano };
    }
    case EVENTOS_AUTORIZACION.modificada: {
      // Modificación material: invalida la aprobación anterior → vuelve a PENDIENTE.
      const p = event.payload as PayloadCondiciones;
      return { ...next, estado: 'PENDIENTE', condiciones: p.condiciones };
    }
    case EVENTOS_AUTORIZACION.pausada:
      return { ...next, estado: 'PAUSADA' };
    case EVENTOS_AUTORIZACION.reanudada:
      return { ...next, estado: 'AUTORIZADA' };
    case EVENTOS_AUTORIZACION.revocada:
      return { ...next, estado: 'REVOCADA', terminada: true };
    case EVENTOS_AUTORIZACION.expirada:
      return { ...next, estado: 'EXPIRADA', terminada: true };
    case EVENTOS_AUTORIZACION.reemplazada: {
      const p = event.payload as PayloadReemplazada;
      return { ...next, estado: 'REEMPLAZADA', terminada: true, reemplazadaPor: p.porAutorizacionId };
    }
    case EVENTOS_AUTORIZACION.eliminada:
      return { ...next, estado: 'ELIMINADA', terminada: true };
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

/** Nivel de autonomía efectivo (el aprobado si está AUTORIZADA; el propuesto en otro caso). */
export function nivelEfectivo(state: AutorizacionState): NivelAutonomia {
  return (state.estado === 'AUTORIZADA' ? state.aprobadas?.nivelAutonomia : state.condiciones.nivelAutonomia)
    ?? state.condiciones.nivelAutonomia;
}

/** Límite efectivo (el aprobado si está AUTORIZADA). */
export function limiteEfectivo(state: AutorizacionState): number {
  return (state.estado === 'AUTORIZADA' ? state.aprobadas?.limite : state.condiciones.limite) ?? state.condiciones.limite;
}

/** Riesgo efectivo (el aprobado si está AUTORIZADA). Riesgo 'alto' = acción reservada al humano. */
export function riesgoEfectivo(state: AutorizacionState): Riesgo {
  return (state.estado === 'AUTORIZADA' ? state.aprobadas?.riesgo : state.condiciones.riesgo) ?? state.condiciones.riesgo;
}

/** Disponibilidad de consumo simulado restante bajo el límite efectivo. */
export function disponibleSimulado(state: AutorizacionState): number {
  return Math.max(0, limiteEfectivo(state) - state.consumidoSimulado);
}
