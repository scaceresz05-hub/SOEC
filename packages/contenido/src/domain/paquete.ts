/**
 * Paquete publicable (F2-CONT-01 §4.5, §5.4) — agrupa pieza fuente, adaptaciones,
 * activos, política evaluada, validaciones, revisiones, versión, destino, estado,
 * huellas de integridad y referencias a la actividad/campaña. Es el CONTRATO que
 * consumirá el adaptador de publicación. Agregado event-sourced; una pieza inválida
 * nunca alcanza el estado ejecutable. Ningún efecto externo real (ejecución simulada).
 */
import type { RecordedEvent } from '@soec/contracts';
import type { Activo } from './activo';
import type { Adaptacion } from './adaptacion';
import type { FormatoPieza, PiezaFuente, TrazaAfirmacion } from './pieza';
import type { Revision } from './revision';
import type { Hallazgo } from './validacion';

export type EstadoPaquete =
  | 'ensamblando'
  | 'incompleto'
  | 'validando'
  | 'denegado'
  | 'listo'
  | 'autorizado'
  | 'entregado'
  | 'ejecutado'
  | 'verificado'
  | 'fallido'
  | 'retirado';

export type ResultadoProduccion = 'listo' | 'denegado' | 'incompleto';

export const EVENTOS_PAQ = {
  producido: 'paq.producido',
  entregado: 'paq.entregado',
  ejecutado: 'paq.ejecutado',
  retirado: 'paq.retirado',
  gobernanza: 'paq.gobernanza_creativa_vinculada',
  obsoleta: 'paq.gobernanza_obsoleta',
} as const;

/** M6: materializa la obsolescencia de la pieza respecto de M5 (aditivo, idempotente). */
export interface PayloadObsoletaCreativa {
  readonly vigencia: 'OBSOLETO' | 'REQUIERE_REVISION';
  readonly motivo: string;
}

/** M6: gobernanza creativa que se ADJUNTA a la pieza de un paquete ya producido (aditivo). */
export interface PayloadGobernanzaCreativa {
  readonly formato: FormatoPieza;
  readonly objetivo: string;
  readonly segmento: string;
  readonly briefId: string;
  readonly territorioId: string;
  readonly estrategiaCreativaId: string;
  readonly mensajesUtilizados: readonly string[];
  readonly referenciasM5: readonly { readonly afirmacionId: string; readonly version: number }[];
  readonly resultadoValidacion: 'VALIDO' | 'INVALIDO' | 'REQUIERE_REVISION';
  readonly versionConocimiento: number;
  readonly trazabilidad: readonly TrazaAfirmacion[];
}

export function paqueteStreamId(paqueteId: string): string {
  return `paquete:${paqueteId}`;
}

export interface PaqueteState {
  readonly paqueteId: string;
  readonly organizationId: string;
  readonly version: number;
  readonly existe: boolean;
  readonly briefRef: string;
  readonly marcaRef: string;
  readonly canal: string;
  readonly planRef: string;
  readonly campaniaRef: string;
  readonly actividadRef: string;
  readonly pieza: PiezaFuente | null;
  readonly historialPiezas: readonly PiezaFuente[];
  readonly adaptaciones: readonly Adaptacion[];
  readonly activos: readonly Activo[];
  readonly revisiones: readonly Revision[];
  readonly hallazgos: readonly Hallazgo[];
  readonly resultadoProduccion: ResultadoProduccion | null;
  readonly huella: string;
  readonly costoProduccion: number;
  readonly estado: EstadoPaquete;
  readonly executionRef: string | null;
  readonly permitida: boolean | null;
  readonly resultadoEjecucion: string | null;
  readonly historial: readonly { estado: EstadoPaquete; en: string }[];
}

export function estadoInicialPaquete(paqueteId: string, organizationId: string): PaqueteState {
  return {
    paqueteId,
    organizationId,
    version: 0,
    existe: false,
    briefRef: '',
    marcaRef: '',
    canal: '',
    planRef: '',
    campaniaRef: '',
    actividadRef: '',
    pieza: null,
    historialPiezas: [],
    adaptaciones: [],
    activos: [],
    revisiones: [],
    hallazgos: [],
    resultadoProduccion: null,
    huella: '',
    costoProduccion: 0,
    estado: 'ensamblando',
    executionRef: null,
    permitida: null,
    resultadoEjecucion: null,
    historial: [],
  };
}

export interface PayloadProducido {
  briefRef: string;
  marcaRef: string;
  canal: string;
  planRef: string;
  campaniaRef: string;
  actividadRef: string;
  pieza: PiezaFuente;
  historialPiezas: PiezaFuente[];
  adaptaciones: Adaptacion[];
  activos: Activo[];
  revisiones: Revision[];
  hallazgos: Hallazgo[];
  resultado: ResultadoProduccion;
  huella: string;
  costoProduccion: number;
  estado: EstadoPaquete;
}
interface PayloadEntregado {
  actividadRef: string;
}
interface PayloadEjecutado {
  executionRef: string;
  permitida: boolean;
  resultado: string;
  nuevoEstado: EstadoPaquete;
}
interface PayloadRetirado {
  motivo: string;
}

export function aplicarPaquete(state: PaqueteState, event: RecordedEvent): PaqueteState {
  const next = { ...state, version: state.version + 1 };
  switch (event.type) {
    case EVENTOS_PAQ.producido: {
      const p = event.payload as PayloadProducido;
      return {
        ...next,
        existe: true,
        briefRef: p.briefRef,
        marcaRef: p.marcaRef,
        canal: p.canal,
        planRef: p.planRef,
        campaniaRef: p.campaniaRef,
        actividadRef: p.actividadRef,
        pieza: p.pieza,
        historialPiezas: p.historialPiezas,
        adaptaciones: p.adaptaciones,
        activos: p.activos,
        revisiones: p.revisiones,
        hallazgos: p.hallazgos,
        resultadoProduccion: p.resultado,
        huella: p.huella,
        costoProduccion: p.costoProduccion,
        estado: p.estado,
        historial: [...state.historial, { estado: p.estado, en: event.recordedAt }],
      };
    }
    case EVENTOS_PAQ.entregado: {
      const p = event.payload as PayloadEntregado;
      if (state.estado !== 'listo') return next; // solo un paquete listo se entrega
      return { ...next, actividadRef: p.actividadRef, estado: 'autorizado', historial: [...state.historial, { estado: 'autorizado', en: event.recordedAt }] };
    }
    case EVENTOS_PAQ.ejecutado: {
      const p = event.payload as PayloadEjecutado;
      return {
        ...next,
        executionRef: p.executionRef,
        permitida: p.permitida,
        resultadoEjecucion: p.resultado,
        estado: p.nuevoEstado,
        historial: [...state.historial, { estado: p.nuevoEstado, en: event.recordedAt }],
      };
    }
    case EVENTOS_PAQ.retirado: {
      const p = event.payload as PayloadRetirado;
      return { ...next, estado: 'retirado', resultadoEjecucion: p.motivo, historial: [...state.historial, { estado: 'retirado', en: event.recordedAt }] };
    }
    case EVENTOS_PAQ.obsoleta: {
      if (!state.pieza) return next;
      const p = event.payload as PayloadObsoletaCreativa;
      return { ...next, pieza: { ...state.pieza, vigencia: p.vigencia } };
    }
    case EVENTOS_PAQ.gobernanza: {
      if (!state.pieza) return next; // requiere una pieza ya producida
      const p = event.payload as PayloadGobernanzaCreativa;
      return {
        ...next,
        pieza: {
          ...state.pieza,
          formato: p.formato,
          objetivo: p.objetivo,
          segmento: p.segmento,
          briefId: p.briefId,
          territorioId: p.territorioId,
          estrategiaCreativaId: p.estrategiaCreativaId,
          mensajesUtilizados: p.mensajesUtilizados,
          referenciasM5: p.referenciasM5,
          resultadoValidacion: p.resultadoValidacion,
          versionConocimiento: p.versionConocimiento,
          naturaleza: 'SIMULADO',
          trazabilidad: p.trazabilidad,
        },
      };
    }
    default:
      return next;
  }
}

export function reconstruirPaquete(paqueteId: string, organizationId: string, events: readonly RecordedEvent[]): PaqueteState {
  return events.reduce(aplicarPaquete, estadoInicialPaquete(paqueteId, organizationId));
}

/** Huella de integridad determinista del contenido del paquete (sin azar). */
export function huellaPaquete(pieza: PiezaFuente, adaptaciones: readonly Adaptacion[]): string {
  const base = `${pieza.cuerpo}|${adaptaciones.map((a) => `${a.canal}:${a.cuerpo}`).join('|')}`;
  let hh = 0;
  for (let i = 0; i < base.length; i += 1) hh = (hh * 131 + base.charCodeAt(i)) % 1_000_000_007;
  return `p${hh.toString(16)}`;
}

/** Solo un paquete ejecutable puede convertirse en acción; una pieza inválida no. */
export function esEjecutable(state: PaqueteState): boolean {
  return state.estado === 'listo' || state.estado === 'autorizado';
}
