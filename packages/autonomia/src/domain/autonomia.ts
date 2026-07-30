/**
 * @soec/autonomia · dominio · Política de autonomía y MODO SEGURO (Bloque H).
 *
 * Motor de autorización que gobierna las acciones con efecto del ciclo autónomo (programar,
 * publicar-simulado, reintentar, aumentar presupuesto, modificar campaña activa, aplicar
 * optimización). Invariantes de seguridad, no negociables:
 *   - Ninguna acción gobernada se ejecuta sin una autorización válida (misma org, misma acción,
 *     no vencida, no consumida).
 *   - La PAUSA (modo seguro) prevalece incluso sobre una aprobación previa: en pausa, nada corre.
 *   - SOEC no puede subir su propia autonomía; sólo un humano la eleva.
 *   - Una aprobación vencida o de otra organización no autoriza.
 *   - Una acción iniciada ANTES de una PAUSA no puede continuar en silencio tras ella.
 *   - Reanudar exige un actor humano y deja traza (quién y por qué).
 *
 * Comparación temporal por strings ISO-8601 UTC (sin reloj interno). Event-sourced
 * (`autonomia:<org>`).
 */
import type { RecordedEvent } from '@soec/contracts';

export type AccionGobernada =
  | 'PROGRAMAR'
  | 'PUBLICAR_SIMULADO'
  | 'REINTENTAR'
  | 'AUMENTAR_PRESUPUESTO'
  | 'MODIFICAR_CAMPANA_ACTIVA'
  | 'APLICAR_OPTIMIZACION';

export const ACCIONES_GOBERNADAS: readonly AccionGobernada[] = [
  'PROGRAMAR',
  'PUBLICAR_SIMULADO',
  'REINTENTAR',
  'AUMENTAR_PRESUPUESTO',
  'MODIFICAR_CAMPANA_ACTIVA',
  'APLICAR_OPTIMIZACION',
];

/** Quién solicita un cambio: un humano o el propio agente autónomo. */
export type Solicitante = 'humano' | 'soec';

export interface Autorizacion {
  readonly id: string;
  readonly organizacionId: string;
  readonly accion: AccionGobernada;
  /** Entidad concreta (campaña/contenido) que se autoriza; '*' = cualquiera de esa acción. */
  readonly entidadRef: string;
  readonly actorHumano: string;
  readonly otorgadaEn: string;
  readonly expiraEn: string;
}

export interface AccionIniciada {
  readonly accionId: string;
  readonly accion: AccionGobernada;
  readonly entidadRef: string;
  readonly pausaSeqAlIniciar: number;
  readonly finalizada: boolean;
}

export interface Reanudacion {
  readonly actorHumano: string;
  readonly motivo: string;
  readonly en: string;
}

export interface EstadoAutonomia {
  readonly organizacionId: string;
  readonly nivel: number; // N0..N5
  readonly pausado: boolean;
  readonly pausaSeq: number; // nº de pausas ocurridas; sella las acciones en vuelo
  readonly autorizaciones: readonly Autorizacion[];
  readonly accionesIniciadas: readonly AccionIniciada[];
  readonly reanudaciones: readonly Reanudacion[];
  readonly version: number;
  readonly existe: boolean;
}

export const EVENTOS_AUTONOMIA = {
  politicaEstablecida: 'autonomia.politica_establecida',
  nivelCambiado: 'autonomia.nivel_cambiado',
  pausado: 'autonomia.pausado',
  reanudado: 'autonomia.reanudado',
  autorizado: 'autonomia.autorizado',
  accionIniciada: 'autonomia.accion_iniciada',
  accionFinalizada: 'autonomia.accion_finalizada',
} as const;

export function autonomiaStreamId(organizacionId: string): string {
  return `autonomia:${organizacionId}`;
}

export function estadoInicialAutonomia(organizacionId: string): EstadoAutonomia {
  return {
    organizacionId,
    nivel: 0,
    pausado: false,
    pausaSeq: 0,
    autorizaciones: [],
    accionesIniciadas: [],
    reanudaciones: [],
    version: 0,
    existe: false,
  };
}

export function aplicarAutonomia(state: EstadoAutonomia, event: RecordedEvent): EstadoAutonomia {
  const next = { ...state, version: state.version + 1, existe: true };
  switch (event.type) {
    case EVENTOS_AUTONOMIA.politicaEstablecida:
      return { ...next, nivel: (event.payload as { nivel: number }).nivel };
    case EVENTOS_AUTONOMIA.nivelCambiado:
      return { ...next, nivel: (event.payload as { nivel: number }).nivel };
    case EVENTOS_AUTONOMIA.pausado:
      return { ...next, pausado: true, pausaSeq: state.pausaSeq + 1 };
    case EVENTOS_AUTONOMIA.reanudado:
      return { ...next, pausado: false, reanudaciones: [...state.reanudaciones, event.payload as Reanudacion] };
    case EVENTOS_AUTONOMIA.autorizado:
      return { ...next, autorizaciones: [...state.autorizaciones, event.payload as Autorizacion] };
    case EVENTOS_AUTONOMIA.accionIniciada:
      return { ...next, accionesIniciadas: [...state.accionesIniciadas, event.payload as AccionIniciada] };
    case EVENTOS_AUTONOMIA.accionFinalizada: {
      const id = (event.payload as { accionId: string }).accionId;
      return { ...next, accionesIniciadas: state.accionesIniciadas.map((a) => (a.accionId === id ? { ...a, finalizada: true } : a)) };
    }
    default:
      return next;
  }
}

export function reconstruirAutonomia(organizacionId: string, events: readonly RecordedEvent[]): EstadoAutonomia {
  return events.reduce(aplicarAutonomia, estadoInicialAutonomia(organizacionId));
}

export interface Veredicto {
  readonly permitida: boolean;
  readonly motivo: string;
}

/**
 * Decide si una acción gobernada puede ejecutarse AHORA. La PAUSA gana sobre cualquier
 * aprobación; luego exige una autorización válida (org, acción, entidad, no vencida).
 */
export function puedeEjecutar(state: EstadoAutonomia, org: string, accion: AccionGobernada, entidadRef: string, ahora: string): Veredicto {
  if (state.pausado) return { permitida: false, motivo: 'MODO_SEGURO: sistema en pausa; ninguna acción procede' };
  const auth = state.autorizaciones.find(
    (a) => a.organizacionId === org && a.accion === accion && (a.entidadRef === entidadRef || a.entidadRef === '*') && a.expiraEn > ahora,
  );
  if (!auth) return { permitida: false, motivo: `sin autorización válida para ${accion} sobre ${entidadRef}` };
  return { permitida: true, motivo: `autorizada por ${auth.actorHumano} (${auth.id})` };
}

/** Una acción en vuelo puede continuar sólo si no hay pausa vigente ni la hubo desde que inició. */
export function puedeContinuar(state: EstadoAutonomia, accionId: string): Veredicto {
  if (state.pausado) return { permitida: false, motivo: 'MODO_SEGURO: pausa vigente' };
  const acc = state.accionesIniciadas.find((a) => a.accionId === accionId);
  if (!acc) return { permitida: false, motivo: 'acción no iniciada' };
  if (acc.finalizada) return { permitida: false, motivo: 'acción ya finalizada' };
  if (acc.pausaSeqAlIniciar !== state.pausaSeq) {
    return { permitida: false, motivo: 'hubo una PAUSA desde que la acción inició; no puede continuar en silencio' };
  }
  return { permitida: true, motivo: 'sin pausas desde el inicio' };
}
