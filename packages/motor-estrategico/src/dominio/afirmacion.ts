/**
 * @soec/motor-estrategico · dominio · AFIRMACIÓN ESTRATÉGICA (agregado event-sourced).
 *
 * La unidad de CONOCIMIENTO estratégico de SOEC. Generaliza el patrón de oro de la hipótesis comercial
 * (`@soec/crm-comercial`) a TODA entidad estratégica del Bloque Maestro M5 (empresa, mercado, competencia,
 * ICP, buyer persona, propuesta de valor, objetivo, estrategia, plan, KPI), sin duplicar los agregados
 * especializados que ya existen: una afirmación puede APUNTAR (por `sujetoRef`) a un perfil de
 * `@soec/crm-comercial`, a un ítem de `@soec/negocio` o a una hipótesis, pero nunca copia su contenido.
 *
 * Principio del Bloque Maestro: «SOEC no almacena respuestas; almacena conocimiento; las respuestas son
 * consecuencia del conocimiento». Por eso este agregado guarda SOLO conocimiento (el enunciado, su
 * evidencia y sus enlaces) y NUNCA persiste un veredicto: el estado de evaluabilidad se DERIVA siempre
 * en el momento con el motor puro `evaluar()`. Así el replay es trivialmente determinista y no hay dos
 * fuentes de verdad para "la respuesta".
 *
 * Event-sourced, multi-tenant, stream `estrategico:<org>:<afirmacionId>`. Append-only; la evidencia y
 * los enlaces se acumulan; una afirmación puede RETIRARSE (deja de contar) pero su historia se conserva.
 */
import type { RecordedEvent } from '@soec/contracts';
import type { Evidencia } from '../nucleo/evidencia';

/**
 * Clase de entidad estratégica que la afirmación describe. Cubre el núcleo del dominio M5. `HIPOTESIS`
 * existe para poder enlazar/mirar hipótesis desde el grafo estratégico; su ciclo de vida rico sigue
 * viviendo en `@soec/crm-comercial` (SSOT de hipótesis), no aquí.
 */
export type ClaseAfirmacion =
  | 'EMPRESA'
  | 'MERCADO'
  | 'COMPETENCIA'
  | 'ICP'
  | 'BUYER_PERSONA'
  | 'PROPUESTA_VALOR'
  | 'OBJETIVO'
  | 'ESTRATEGIA'
  | 'PLAN'
  | 'KPI'
  | 'HIPOTESIS';

export const CLASES_AFIRMACION: readonly ClaseAfirmacion[] = [
  'EMPRESA',
  'MERCADO',
  'COMPETENCIA',
  'ICP',
  'BUYER_PERSONA',
  'PROPUESTA_VALOR',
  'OBJETIVO',
  'ESTRATEGIA',
  'PLAN',
  'KPI',
  'HIPOTESIS',
] as const;

/**
 * Relación TIPADA y EXPLÍCITA entre afirmaciones. Nunca se infiere por nombre ni posición (misma
 * disciplina que `hipotesis.segmentoId`). El servicio valida que el destino exista y sea de la MISMA
 * organización antes de enlazar.
 *
 * - `PERTENECE_A`  — p. ej. una BUYER_PERSONA pertenece a un ICP (varias por ICP).
 * - `RESPONDE_A`   — una ESTRATEGIA responde a un OBJETIVO.
 * - `DERIVA_DE`    — un PLAN deriva de una ESTRATEGIA.
 * - `MIDE`         — un KPI mide un OBJETIVO.
 * - `SUSTENTA`     — una afirmación sustenta a otra (evidencia estructural).
 * - `CONTRADICE`   — una afirmación tensiona/contradice a otra.
 */
export type TipoEnlace = 'PERTENECE_A' | 'RESPONDE_A' | 'DERIVA_DE' | 'MIDE' | 'SUSTENTA' | 'CONTRADICE';

export interface Enlace {
  readonly tipo: TipoEnlace;
  readonly hacia: string;
  readonly nota: string | null;
}

/** Referencia OPACA a la entidad descriptiva que la afirmación aborda (perfil crm, ítem negocio, hipótesis). */
export interface SujetoRef {
  /** Dominio dueño de la entidad referida (SSOT): p. ej. 'crm-comercial', 'negocio', 'hipotesis'. */
  readonly dominio: string;
  /** Id de la entidad en ESE dominio (mismo id, nunca una copia). */
  readonly id: string;
}

export interface AfirmacionState {
  readonly organizacionId: string;
  readonly afirmacionId: string;
  readonly version: number;
  readonly existe: boolean;
  readonly clase: ClaseAfirmacion;
  readonly enunciado: string;
  readonly sujetoRef: SujetoRef | null;
  readonly evidencias: readonly Evidencia[];
  readonly enlaces: readonly Enlace[];
  readonly retirada: boolean;
  readonly motivoRetiro: string | null;
}

export const EVENTOS_AFIRMACION = {
  registrada: 'estrategico.afirmacion_registrada',
  evidencia: 'estrategico.evidencia_agregada',
  enlazada: 'estrategico.afirmacion_enlazada',
  sujetoAsignado: 'estrategico.sujeto_asignado',
  retirada: 'estrategico.afirmacion_retirada',
} as const;

export function afirmacionStreamId(organizacionId: string, afirmacionId: string): string {
  return `estrategico:${organizacionId}:${afirmacionId}`;
}

export function estadoInicialAfirmacion(organizacionId: string, afirmacionId: string): AfirmacionState {
  return {
    organizacionId,
    afirmacionId,
    version: 0,
    existe: false,
    clase: 'EMPRESA',
    enunciado: '',
    sujetoRef: null,
    evidencias: [],
    enlaces: [],
    retirada: false,
    motivoRetiro: null,
  };
}

interface PRegistrada {
  clase: ClaseAfirmacion;
  enunciado: string;
  sujetoRef?: SujetoRef | null;
}
interface PEnlazada {
  tipo: TipoEnlace;
  hacia: string;
  nota?: string | null;
}
interface PRetirada {
  motivo: string;
}

export function aplicarAfirmacion(state: AfirmacionState, event: RecordedEvent): AfirmacionState {
  const next = { ...state, version: state.version + 1 };
  switch (event.type) {
    case EVENTOS_AFIRMACION.registrada: {
      const p = event.payload as PRegistrada;
      if (state.existe) return next; // idempotente ante re-registro
      return {
        ...next,
        existe: true,
        clase: p.clase,
        enunciado: p.enunciado,
        sujetoRef: p.sujetoRef ?? null,
      };
    }
    case EVENTOS_AFIRMACION.evidencia: {
      const p = event.payload as Evidencia;
      return { ...next, evidencias: [...state.evidencias, p] };
    }
    case EVENTOS_AFIRMACION.enlazada: {
      const p = event.payload as PEnlazada;
      return { ...next, enlaces: [...state.enlaces, { tipo: p.tipo, hacia: p.hacia, nota: p.nota ?? null }] };
    }
    case EVENTOS_AFIRMACION.sujetoAsignado: {
      const p = event.payload as SujetoRef;
      return { ...next, sujetoRef: { dominio: p.dominio, id: p.id } };
    }
    case EVENTOS_AFIRMACION.retirada: {
      const p = event.payload as PRetirada;
      return { ...next, retirada: true, motivoRetiro: p.motivo };
    }
    default:
      // Evento desconocido (p. ej. de una versión posterior): no rompe el replay.
      return next;
  }
}

export function reconstruirAfirmacion(
  organizacionId: string,
  afirmacionId: string,
  events: readonly RecordedEvent[],
): AfirmacionState {
  return events.reduce(aplicarAfirmacion, estadoInicialAfirmacion(organizacionId, afirmacionId));
}
