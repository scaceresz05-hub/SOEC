/**
 * @soec/negocio · dominio · SSOT del conocimiento de negocio de INSTANCIA (Bloque A).
 *
 * Reemplaza la ausencia de conocimiento comercial por empresa: entidades de negocio
 * (organización, marca, producto, público, competidor, mercado, presupuesto, indicador…)
 * gobernadas y **acotadas por organización** (aislamiento multiempresa por diseño). Cada
 * ítem lleva su ORIGEN de evidencia; la confianza se aplica solo donde tiene significado
 * (nunca como campo decorativo). La información faltante es de primera clase (Evaluabilidad:
 * la ausencia nunca es una conclusión). Event-sourced sobre `@soec/event-store` (stream
 * `negocio:<org>`); la última versión por ítem gobierna (permite corrección).
 */
import type { RecordedEvent } from '@soec/contracts';

/** Naturaleza epistémica del dato: distingue hecho de suposición (Constitución §6.3). */
export type TipoEvidencia =
  | 'HECHO_VERIFICADO'
  | 'DATO_DECLARADO_POR_USUARIO'
  | 'DATO_IMPORTADO'
  | 'INFERENCIA'
  | 'HIPOTESIS'
  | 'ESTIMACION'
  | 'SIMULACION'
  | 'DESCONOCIDO';

export type TipoEntidad =
  | 'ORGANIZACION'
  | 'UNIDAD_NEGOCIO'
  | 'MARCA'
  | 'PRODUCTO'
  | 'PUBLICO'
  | 'PROPUESTA_VALOR'
  | 'PROBLEMA_CLIENTE'
  | 'COMPETIDOR'
  | 'MERCADO'
  | 'CANAL'
  | 'RESTRICCION'
  | 'POLITICA'
  | 'PRESUPUESTO'
  | 'INDICADOR'
  | 'EVIDENCIA'
  | 'FUENTE';

/** Confianza SOLO donde tiene significado; `null` cuando el origen no la admite. */
export type Confianza = 'ALTA' | 'MEDIA' | 'BAJA' | null;

/**
 * Confianza por defecto según el origen. Una hipótesis, una simulación o lo desconocido
 * NO tienen confianza como si fueran hechos → `null` (no decorativo).
 */
export function confianzaPorDefecto(origen: TipoEvidencia): Confianza {
  switch (origen) {
    case 'HECHO_VERIFICADO':
      return 'ALTA';
    case 'DATO_DECLARADO_POR_USUARIO':
    case 'DATO_IMPORTADO':
      return 'MEDIA';
    case 'INFERENCIA':
    case 'ESTIMACION':
      return 'BAJA';
    case 'HIPOTESIS':
    case 'SIMULACION':
    case 'DESCONOCIDO':
      return null;
  }
}

export interface ItemConocimiento {
  readonly itemId: string;
  readonly organizacionId: string;
  readonly tipo: TipoEntidad;
  readonly nombre: string;
  readonly atributos: Readonly<Record<string, string>>;
  readonly origen: TipoEvidencia;
  readonly fuente: string | null;
  readonly confianza: Confianza;
  readonly autor: string;
  readonly en: string;
}

/** Información faltante: ausencia declarada, NUNCA una conclusión negativa. */
export interface Faltante {
  readonly faltanteId: string;
  readonly organizacionId: string;
  readonly sobre: string;
  readonly motivo: string;
  readonly en: string;
}

export interface ConocimientoState {
  readonly organizacionId: string;
  readonly version: number;
  readonly items: Readonly<Record<string, ItemConocimiento>>;
  readonly faltantes: Readonly<Record<string, Faltante>>;
}

export const EVENTOS_CONOCIMIENTO = {
  registrado: 'negocio.conocimiento_registrado',
  faltante: 'negocio.faltante_registrado',
} as const;

export function negocioStreamId(organizacionId: string): string {
  return `negocio:${organizacionId}`;
}

export function estadoInicialConocimiento(organizacionId: string): ConocimientoState {
  return { organizacionId, version: 0, items: {}, faltantes: {} };
}

interface PRegistrado {
  itemId: string;
  tipo: TipoEntidad;
  nombre: string;
  atributos: Record<string, string>;
  origen: TipoEvidencia;
  fuente: string | null;
  confianza: Confianza;
}
interface PFaltante {
  faltanteId: string;
  sobre: string;
  motivo: string;
}

export function aplicarConocimiento(state: ConocimientoState, event: RecordedEvent): ConocimientoState {
  const next = { ...state, version: state.version + 1 };
  switch (event.type) {
    case EVENTOS_CONOCIMIENTO.registrado: {
      const p = event.payload as PRegistrado;
      const item: ItemConocimiento = {
        itemId: p.itemId,
        organizacionId: state.organizacionId,
        tipo: p.tipo,
        nombre: p.nombre,
        atributos: p.atributos,
        origen: p.origen,
        fuente: p.fuente,
        confianza: p.confianza,
        autor: String(event.actor),
        en: event.recordedAt,
      };
      return { ...next, items: { ...state.items, [p.itemId]: item } };
    }
    case EVENTOS_CONOCIMIENTO.faltante: {
      const p = event.payload as PFaltante;
      const f: Faltante = { faltanteId: p.faltanteId, organizacionId: state.organizacionId, sobre: p.sobre, motivo: p.motivo, en: event.recordedAt };
      return { ...next, faltantes: { ...state.faltantes, [p.faltanteId]: f } };
    }
    default:
      return next;
  }
}

export function reconstruirConocimiento(organizacionId: string, events: readonly RecordedEvent[]): ConocimientoState {
  return events.reduce(aplicarConocimiento, estadoInicialConocimiento(organizacionId));
}
