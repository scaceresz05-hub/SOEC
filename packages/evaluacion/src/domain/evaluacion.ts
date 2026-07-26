/**
 * @soec/evaluacion · dominio · Evaluación (captura real del Director).
 *
 * Reemplaza el diagnóstico sembrado por la CAPTURA de respuestas del Director a las
 * preguntas GOBERNADAS del rubro. Cada evaluación tiene identidad propia
 * (`Organización + Departamento + EvaluacionId`) y stream `evaluacion:<org>:<dep>:<id>`,
 * de modo que dos sesiones NUNCA mezclan respuestas y las decisiones anteriores se
 * preservan. Append-only; la última respuesta por pregunta gobierna (permite corrección);
 * una «comprensión generada» CONGELA el conjunto de respuestas proyectado a
 * `RespuestasDiagnostico` (con huella) para alimentar Diagnóstico→Estrategia de forma
 * determinista, sin alterar la procedencia de decisiones ya congeladas.
 *
 * Estados: BORRADOR → GENERADA (≥1 generación) → CERRADA / ARCHIVADA. Una evaluación
 * cerrada o archivada no admite más respuestas; nunca se borra ni se reinicia de forma
 * destructiva. Normalización SEGURA: un valor cerrado ambiguo produce `NO_NORMALIZABLE`
 * (la señal queda INDETERMINADA); nunca se asume verdadero/falso. La evidencia original se
 * conserva EXACTAMENTE. Cada evento lleva `schemaVersion` (compatibilidad explícita).
 */
import { createHash } from 'node:crypto';
import type { RecordedEvent } from '@soec/contracts';
import type { Respuesta, RespuestasDiagnostico } from '@soec/diagnostico';

/** Versión de esquema de los eventos de evaluación. Sube al cambiar la forma de payloads. */
export const SCHEMA_VERSION_EVAL = 1;

export type TipoPregunta = 'CERRADA_BOOLEAN' | 'ABIERTA';
export type EstadoRespuesta = 'SIN_RESPONDER' | 'RESPONDIDA' | 'CONTRADICTORIA' | 'NO_NORMALIZABLE';
export type EstadoEvaluacion = 'BORRADOR' | 'GENERADA' | 'CERRADA' | 'ARCHIVADA';

/** Entrada CRUDA del Director, conservada EXACTAMENTE como fue ingresada. */
export type EntradaRespuesta =
  | { readonly clase: 'ABIERTA'; readonly texto: string; readonly sustento?: string }
  | { readonly clase: 'CERRADA'; readonly valorCrudo: string }
  | { readonly clase: 'CONTRADICCION'; readonly aFavor: string; readonly enContra: string }
  | { readonly clase: 'SIN_INFORMACION' };

export interface RespuestaRegistrada {
  readonly preguntaId: string;
  readonly tipoPregunta: TipoPregunta;
  readonly entrada: EntradaRespuesta;
  readonly estado: EstadoRespuesta;
  readonly valorNormalizado: boolean | null;
  readonly en: string;
}

export interface GeneracionComprension {
  readonly generacionId: string;
  readonly respuestas: RespuestasDiagnostico;
  readonly huella: string;
  readonly en: string;
}

export interface EvaluacionState {
  readonly organizationId: string;
  readonly departamentoId: string;
  readonly evaluacionId: string;
  readonly rubroId: string | null;
  readonly titulo: string | null;
  readonly version: number;
  readonly existe: boolean;
  readonly cerrada: boolean;
  readonly archivada: boolean;
  readonly creadaEn: string | null;
  readonly respuestas: Readonly<Record<string, RespuestaRegistrada>>;
  readonly generaciones: readonly GeneracionComprension[];
}

export const EVENTOS_EVAL = {
  iniciada: 'evaluacion.iniciada',
  respondida: 'evaluacion.respondida',
  generada: 'evaluacion.comprension_generada',
  cerrada: 'evaluacion.cerrada',
  archivada: 'evaluacion.archivada',
} as const;

export function evalStreamId(
  organizationId: string,
  departamentoId: string,
  evaluacionId: string,
): string {
  return `evaluacion:${organizationId}:${departamentoId}:${evaluacionId}`;
}

/** Error del versionado de esquema: un evento declara una versión que este código no entiende. */
export class EsquemaEvaluacionDesconocidoError extends Error {
  constructor(version: number) {
    super(`Versión de esquema de evaluación no soportada: ${version} (máx ${SCHEMA_VERSION_EVAL})`);
    this.name = 'EsquemaEvaluacionDesconocidoError';
  }
}

/** Interpreta la versión declarada por un evento; los eventos de dev sin campo son v1. */
export function interpretarVersion(payload: unknown): number {
  const v = (payload as { schemaVersion?: unknown })?.schemaVersion;
  if (v === undefined || v === null) return 1; // compatibilidad: eventos previos = versión inicial
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) return 1;
  if (v > SCHEMA_VERSION_EVAL) throw new EsquemaEvaluacionDesconocidoError(v);
  return v;
}

export function estadoDe(s: {
  archivada: boolean;
  cerrada: boolean;
  generaciones: readonly unknown[];
}): EstadoEvaluacion {
  if (s.archivada) return 'ARCHIVADA';
  if (s.cerrada) return 'CERRADA';
  if (s.generaciones.length > 0) return 'GENERADA';
  return 'BORRADOR';
}

export function estadoInicialEvaluacion(
  organizationId: string,
  departamentoId: string,
  evaluacionId: string,
): EvaluacionState {
  return {
    organizationId,
    departamentoId,
    evaluacionId,
    rubroId: null,
    titulo: null,
    version: 0,
    existe: false,
    cerrada: false,
    archivada: false,
    creadaEn: null,
    respuestas: {},
    generaciones: [],
  };
}

// --- Normalización segura ---------------------------------------------------

const VERDADEROS = new Set(['si', 'sí', 'true', 'verdadero', '1']);
const FALSOS = new Set(['no', 'false', 'falso', '0']);

/** Interpreta un valor cerrado SOLO cuando es inequívoco; si no, null (→ NO_NORMALIZABLE). */
export function normalizarBoolean(valorCrudo: string): boolean | null {
  const v = valorCrudo.trim().toLowerCase();
  if (VERDADEROS.has(v)) return true;
  if (FALSOS.has(v)) return false;
  return null;
}

export function normalizarRespuesta(
  tipoPregunta: TipoPregunta,
  entrada: EntradaRespuesta,
): { estado: EstadoRespuesta; valorNormalizado: boolean | null } {
  switch (entrada.clase) {
    case 'SIN_INFORMACION':
      return { estado: 'SIN_RESPONDER', valorNormalizado: null };
    case 'CONTRADICCION':
      return { estado: 'CONTRADICTORIA', valorNormalizado: null };
    case 'ABIERTA':
      return entrada.texto.trim() === ''
        ? { estado: 'SIN_RESPONDER', valorNormalizado: null }
        : { estado: 'RESPONDIDA', valorNormalizado: null };
    case 'CERRADA': {
      if (entrada.valorCrudo.trim() === '')
        return { estado: 'SIN_RESPONDER', valorNormalizado: null };
      const b = normalizarBoolean(entrada.valorCrudo);
      return b === null
        ? { estado: 'NO_NORMALIZABLE', valorNormalizado: null }
        : { estado: 'RESPONDIDA', valorNormalizado: b };
    }
  }
}

// --- Proyección a RespuestasDiagnostico (pura) ------------------------------

export function aRespuestasDiagnostico(state: EvaluacionState): RespuestasDiagnostico {
  const salida: Respuesta[] = [];
  for (const r of Object.values(state.respuestas)) {
    if (r.estado === 'NO_NORMALIZABLE') continue; // señal INDETERMINADA; nunca asumir valor
    switch (r.entrada.clase) {
      case 'SIN_INFORMACION':
        salida.push({ preguntaId: r.preguntaId, tipo: 'ausente' });
        break;
      case 'ABIERTA':
        if (r.estado === 'RESPONDIDA')
          salida.push({
            preguntaId: r.preguntaId,
            tipo: 'afirmada',
            enunciado: r.entrada.texto.trim(),
            sustento: r.entrada.sustento?.trim() || 'declarado por el Director',
          });
        break;
      case 'CERRADA':
        if (r.estado === 'RESPONDIDA' && r.valorNormalizado !== null)
          salida.push({
            preguntaId: r.preguntaId,
            tipo: 'afirmada',
            enunciado: r.valorNormalizado ? 'Sí' : 'No',
            sustento: 'respuesta del Director',
            valor: r.valorNormalizado,
          });
        break;
      case 'CONTRADICCION':
        salida.push({
          preguntaId: r.preguntaId,
          tipo: 'contradictoria',
          enunciado: 'El Director declara evidencia contradictoria',
          aFavor: r.entrada.aFavor,
          enContra: r.entrada.enContra,
        });
        break;
    }
  }
  return salida;
}

function canon(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return (
      '{' +
      Object.keys(o)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + canon(o[k]))
        .join(',') +
      '}'
    );
  }
  return JSON.stringify(v);
}

export function huellaRespuestas(respuestas: RespuestasDiagnostico): string {
  return createHash('sha256').update(canon(respuestas), 'utf8').digest('hex');
}

// --- Reducer ----------------------------------------------------------------

interface PIniciada {
  rubroId: string;
  titulo?: string;
}
interface PRespondida {
  preguntaId: string;
  tipoPregunta: TipoPregunta;
  entrada: EntradaRespuesta;
  estado: EstadoRespuesta;
  valorNormalizado: boolean | null;
}
interface PGenerada {
  generacionId: string;
  respuestas: RespuestasDiagnostico;
  huella: string;
}

export function aplicarEvaluacion(state: EvaluacionState, event: RecordedEvent): EvaluacionState {
  interpretarVersion(event.payload); // valida versión; lanza si es desconocida (futura)
  const next = { ...state, version: state.version + 1, existe: true };
  switch (event.type) {
    case EVENTOS_EVAL.iniciada: {
      const p = event.payload as PIniciada;
      return { ...next, rubroId: p.rubroId, titulo: p.titulo ?? null, creadaEn: event.recordedAt };
    }
    case EVENTOS_EVAL.respondida: {
      const p = event.payload as PRespondida;
      const registrada: RespuestaRegistrada = {
        preguntaId: p.preguntaId,
        tipoPregunta: p.tipoPregunta,
        entrada: p.entrada,
        estado: p.estado,
        valorNormalizado: p.valorNormalizado,
        en: event.recordedAt,
      };
      return { ...next, respuestas: { ...state.respuestas, [p.preguntaId]: registrada } };
    }
    case EVENTOS_EVAL.generada: {
      const p = event.payload as PGenerada;
      const gen: GeneracionComprension = {
        generacionId: p.generacionId,
        respuestas: p.respuestas,
        huella: p.huella,
        en: event.recordedAt,
      };
      return { ...next, generaciones: [...state.generaciones, gen] };
    }
    case EVENTOS_EVAL.cerrada:
      return { ...next, cerrada: true };
    case EVENTOS_EVAL.archivada:
      return { ...next, archivada: true };
    default:
      return next;
  }
}

export function reconstruirEvaluacion(
  organizationId: string,
  departamentoId: string,
  evaluacionId: string,
  events: readonly RecordedEvent[],
): EvaluacionState {
  return events.reduce(
    aplicarEvaluacion,
    estadoInicialEvaluacion(organizationId, departamentoId, evaluacionId),
  );
}

export function generacionVigente(state: EvaluacionState): GeneracionComprension | null {
  return state.generaciones.length > 0 ? state.generaciones[state.generaciones.length - 1]! : null;
}

// --- Índice de evaluaciones por (org, departamento) -------------------------

export const EVENTOS_INDICE = { registrada: 'evalindice.registrada' } as const;

export function indiceStreamId(organizationId: string, departamentoId: string): string {
  return `evalindice:${organizationId}:${departamentoId}`;
}

export interface EntradaIndice {
  readonly evaluacionId: string;
  readonly titulo: string | null;
  readonly creadaEn: string;
}
export interface IndiceState {
  readonly organizationId: string;
  readonly departamentoId: string;
  readonly version: number;
  readonly evaluaciones: readonly EntradaIndice[];
}

export function reconstruirIndice(
  organizationId: string,
  departamentoId: string,
  events: readonly RecordedEvent[],
): IndiceState {
  return events.reduce<IndiceState>(
    (s, e) => {
      interpretarVersion(e.payload);
      if (e.type !== EVENTOS_INDICE.registrada) return { ...s, version: s.version + 1 };
      const p = e.payload as { evaluacionId: string; titulo?: string };
      return {
        ...s,
        version: s.version + 1,
        evaluaciones: [
          ...s.evaluaciones,
          { evaluacionId: p.evaluacionId, titulo: p.titulo ?? null, creadaEn: e.recordedAt },
        ],
      };
    },
    { organizationId, departamentoId, version: 0, evaluaciones: [] },
  );
}
