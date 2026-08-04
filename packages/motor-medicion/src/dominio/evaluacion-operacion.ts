/**
 * @soec/motor-medicion · dominio · EVALUACIÓN OPERACIONAL (registro event-sourced).
 *
 * Consolida, para una observación, el resultado, la evaluación de hipótesis, la atribución y la
 * recomendación — SIEMPRE con explicación. Es la unidad que el aprendizaje y M9 consumen. Se INVALIDA
 * (OBSOLETA) cuando cambia la hipótesis/KPI/segmento/evidencia (no se modifica en silencio). Multi-tenant.
 *
 * Estados: EMITIDA → OBSOLETA.
 */
import type { RecordedEvent } from '@soec/contracts';
import type { EvaluacionResultado } from './evaluacion-resultado';
import type { EvaluacionHipotesis } from './evaluacion-hipotesis';
import type { AtribucionOperacional } from './atribucion-op';
import type { Recomendacion } from './recomendacion';

export type EstadoEvaluacion = 'EMITIDA' | 'OBSOLETA';

export interface CuerpoEvaluacion {
  readonly observacionId: string;
  readonly hipotesisId: string | null;
  readonly kpiId: string;
  readonly segmento: string;
  readonly resultado: EvaluacionResultado;
  readonly hipotesis: EvaluacionHipotesis | null;
  readonly atribucion: AtribucionOperacional | null;
  readonly recomendacion: Recomendacion;
  readonly explicacion: string;
}

export interface EvaluacionOperacionState {
  readonly organizacionId: string;
  readonly evaluacionId: string;
  readonly version: number;
  readonly existe: boolean;
  readonly estado: EstadoEvaluacion;
  readonly cuerpo: CuerpoEvaluacion | null;
  readonly motivoObsolescencia: string | null;
}

export const EVENTOS_EVALUACION = { emitida: 'evaluacion.emitida', obsoleta: 'evaluacion.obsoleta' } as const;

export function evaluacionStreamId(organizacionId: string, evaluacionId: string): string {
  return `evaluacion-op:${organizacionId}:${evaluacionId}`;
}

export function estadoInicialEvaluacion(organizacionId: string, evaluacionId: string): EvaluacionOperacionState {
  return { organizacionId, evaluacionId, version: 0, existe: false, estado: 'EMITIDA', cuerpo: null, motivoObsolescencia: null };
}

export function aplicarEvaluacion(state: EvaluacionOperacionState, event: RecordedEvent): EvaluacionOperacionState {
  const next = { ...state, version: state.version + 1 };
  switch (event.type) {
    case EVENTOS_EVALUACION.emitida:
      if (state.existe) return next; // idempotente por id determinista ⇒ no hay evaluación duplicada
      return { ...next, existe: true, estado: 'EMITIDA', cuerpo: event.payload as CuerpoEvaluacion };
    case EVENTOS_EVALUACION.obsoleta:
      if (state.estado !== 'EMITIDA') return next;
      return { ...next, estado: 'OBSOLETA', motivoObsolescencia: (event.payload as { motivo?: string }).motivo ?? null };
    default:
      return next;
  }
}

export function reconstruirEvaluacion(organizacionId: string, evaluacionId: string, events: readonly RecordedEvent[]): EvaluacionOperacionState {
  return events.reduce(aplicarEvaluacion, estadoInicialEvaluacion(organizacionId, evaluacionId));
}
