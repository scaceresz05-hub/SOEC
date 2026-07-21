/**
 * Núcleo de dominio del Estado Cognitivo Empresarial (ECE).
 *
 * Realiza el Documento #12 sin redefinirlo: el ECE es una representación
 * DERIVADA, reconstruible y temporal que integra las representaciones del MED y
 * del MDM haciendo visibles coherencias, contradicciones, ausencias, dependencias
 * y brechas. No decide, no recomienda, no eleva certeza, no cierra el lazo humano
 * ni origina afirmaciones sobre el mundo — solo sobre RELACIONES entre
 * representaciones (#12 inv. 2). No integra comprensión mediante inteligencia.
 *
 * Trazabilidad: #9 (invariantes) · #10/#11 (fuentes) · #12 (autoridad principal).
 */
import type { Attribution, RecordedEvent } from '@soec/contracts';
import type { Vigencia } from '@soec/models';

/** Categorías que #12 §3 confirma; no se agregan por conveniencia técnica. */
export type TipoElemento = 'coherencia' | 'contradiccion' | 'ausencia' | 'dependencia' | 'brecha';

/** Origen del elemento: derivado deterministamente del modelo, o declarado (registrado). */
export type OrigenElemento = 'derivado' | 'registrado';

export type EstadoRevision = 'vigente' | 'revisado' | 'superado';

export type EstadoSatisfaccion = 'satisfecha' | 'insatisfecha';

/** Referencia a un elemento de un modelo fuente; conserva el plano de procedencia. */
export interface RefModelo {
  readonly modelo: 'MED' | 'MDM';
  readonly instanceId: string;
  readonly elementoId: string | null;
  readonly elementoTipo: 'afirmacion' | 'entidad' | 'observacion' | 'modelo';
}

export interface CambioElemento {
  readonly estado: EstadoRevision;
  readonly motivo: string;
  readonly registradoEn: string;
}

/**
 * Elemento del ECE. Conserva explícitamente procedencia, evidencia, vigencia,
 * incertidumbre, limitaciones, atribución, contradicción/ausencia como primera
 * clase, estado de revisión, no-evaluabilidad e historial (§5, §6).
 */
export interface ElementoEce {
  readonly id: string;
  readonly tipo: TipoElemento;
  readonly origen: OrigenElemento;
  readonly referencias: readonly RefModelo[];
  readonly procedencia: string;
  readonly evidencia: readonly string[];
  readonly alcance: string;
  readonly vigencia: Vigencia | null;
  readonly atribucion: Attribution;
  readonly incertidumbre: string;
  readonly limitaciones: readonly string[];
  readonly estadoRevision: EstadoRevision;
  readonly noEvaluable: boolean;
  /** Solo dependencias: si la comprensión requerida está o no disponible. */
  readonly estadoSatisfaccion: EstadoSatisfaccion | null;
  readonly historial: readonly CambioElemento[];
}

/** Corte temporal de un modelo fuente: qué versión (tiempo de conocimiento) se integró. */
export interface CorteModelo {
  readonly instanceId: string;
  readonly version: number;
  readonly recordedAt: string | null;
}

export interface EceState {
  readonly eceId: string;
  readonly organizationId: string;
  /** Necesidad técnica (concurrencia optimista) — no es concepto de dominio. */
  readonly version: number;
  readonly existe: boolean;
  readonly medCorte: CorteModelo | null;
  readonly mdmCorte: CorteModelo | null;
  readonly construidoEn: string | null;
  readonly vigente: boolean;
  readonly requiereReconstruccion: boolean;
  readonly invalidadoPor: string | null;
  readonly elementos: Readonly<Record<string, ElementoEce>>;
}

export function estadoInicialEce(eceId: string, organizationId: string): EceState {
  return {
    eceId,
    organizationId,
    version: 0,
    existe: false,
    medCorte: null,
    mdmCorte: null,
    construidoEn: null,
    vigente: false,
    requiereReconstruccion: false,
    invalidadoPor: null,
    elementos: {},
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Eventos del ECE (#12 / §13). Ninguno implica decisión, orientación, explicación,
// recomendación, predicción, ejecución ni aprendizaje: eso es capa posterior.
// ─────────────────────────────────────────────────────────────────────────────
export const EVENTOS_ECE = {
  construido: 'ece.construido',
  reconstruido: 'ece.reconstruido',
  coherencia: 'ece.coherencia_registrada',
  contradiccion: 'ece.contradiccion_registrada',
  ausencia: 'ece.ausencia_registrada',
  dependencia: 'ece.dependencia_registrada',
  brecha: 'ece.brecha_registrada',
  revisado: 'ece.elemento_revisado',
  invalidado: 'ece.invalidado',
} as const;

export function eceStreamId(eceId: string): string {
  return `ece:${eceId}`;
}

const EVENTO_POR_TIPO: Readonly<Record<TipoElemento, string>> = {
  coherencia: EVENTOS_ECE.coherencia,
  contradiccion: EVENTOS_ECE.contradiccion,
  ausencia: EVENTOS_ECE.ausencia,
  dependencia: EVENTOS_ECE.dependencia,
  brecha: EVENTOS_ECE.brecha,
};

export function eventoDeRegistro(tipo: TipoElemento): string {
  return EVENTO_POR_TIPO[tipo];
}

interface PayloadConstruido {
  medCorte: CorteModelo;
  mdmCorte: CorteModelo;
  derivados: ElementoEce[];
}
interface PayloadRegistro {
  elemento: ElementoEce;
}
interface PayloadRevision {
  elementoId: string;
  estadoRevision: EstadoRevision;
  motivo: string;
  estadoSatisfaccion?: EstadoSatisfaccion | null;
}
interface PayloadInvalidado {
  motivo: string;
}

function normalizarElemento(e: ElementoEce, registradoEn: string): ElementoEce {
  return {
    ...e,
    estadoRevision: 'vigente',
    historial: [{ estado: 'vigente', motivo: `alta (${e.origen})`, registradoEn }],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reducción: historia inmutable → estado del ECE (proyección, #9 inv. 4)
// ─────────────────────────────────────────────────────────────────────────────
export function aplicarEce(state: EceState, event: RecordedEvent): EceState {
  const next = { ...state, version: state.version + 1 };
  const t = event.type;

  if (t === EVENTOS_ECE.construido || t === EVENTOS_ECE.reconstruido) {
    const p = event.payload as PayloadConstruido;
    // Reemplaza el conjunto DERIVADO; conserva los elementos REGISTRADOS.
    const registrados = Object.fromEntries(
      Object.entries(state.elementos).filter(([, el]) => el.origen === 'registrado'),
    );
    const derivados = Object.fromEntries(
      p.derivados.map((el) => [el.id, normalizarElemento(el, event.recordedAt)]),
    );
    return {
      ...next,
      existe: true,
      medCorte: p.medCorte,
      mdmCorte: p.mdmCorte,
      construidoEn: event.recordedAt,
      vigente: true,
      requiereReconstruccion: false,
      invalidadoPor: null,
      elementos: { ...registrados, ...derivados },
    };
  }

  if (
    t === EVENTOS_ECE.coherencia ||
    t === EVENTOS_ECE.contradiccion ||
    t === EVENTOS_ECE.ausencia ||
    t === EVENTOS_ECE.dependencia ||
    t === EVENTOS_ECE.brecha
  ) {
    const p = event.payload as PayloadRegistro;
    return {
      ...next,
      elementos: {
        ...state.elementos,
        [p.elemento.id]: normalizarElemento({ ...p.elemento, origen: 'registrado' }, event.recordedAt),
      },
    };
  }

  if (t === EVENTOS_ECE.revisado) {
    const p = event.payload as PayloadRevision;
    const el = state.elementos[p.elementoId];
    if (!el) return next;
    return {
      ...next,
      elementos: {
        ...state.elementos,
        [p.elementoId]: {
          ...el,
          estadoRevision: p.estadoRevision,
          estadoSatisfaccion: p.estadoSatisfaccion ?? el.estadoSatisfaccion,
          historial: [
            ...el.historial,
            { estado: p.estadoRevision, motivo: p.motivo, registradoEn: event.recordedAt },
          ],
        },
      },
    };
  }

  if (t === EVENTOS_ECE.invalidado) {
    const p = event.payload as PayloadInvalidado;
    return {
      ...next,
      vigente: false,
      requiereReconstruccion: true,
      invalidadoPor: event.causationId ?? p.motivo,
    };
  }

  return next;
}

export function reconstruirEce(
  eceId: string,
  organizationId: string,
  events: readonly RecordedEvent[],
): EceState {
  return events.reduce(aplicarEce, estadoInicialEce(eceId, organizationId));
}

/** Elementos de un tipo dado (consulta del puerto de lectura). */
export function elementosPorTipo(state: EceState, tipo: TipoElemento): ElementoEce[] {
  return Object.values(state.elementos).filter((e) => e.tipo === tipo);
}
