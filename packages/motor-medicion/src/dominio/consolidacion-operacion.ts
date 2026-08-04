/**
 * @soec/motor-medicion · dominio · CONSOLIDACIÓN OPERACIONAL (registro event-sourced).
 *
 * Persiste el resultado de consolidar varias evaluaciones comparables. Determinista y recomputable;
 * idempotente por `consolidacionId`. NO crea otra hipótesis ni otro aprendizaje: agrega evaluaciones
 * existentes. Multi-tenant, reconstruible por replay. No modifica evaluaciones históricas.
 */
import type { RecordedEvent } from '@soec/contracts';
import type { CuerpoEvaluacion } from './evaluacion-operacion';
import type { ClaveComparacion, Consolidacion } from './consolidacion';

/** Deriva la clave de comparación de una evaluación desde su cuerpo (unidad y ventana forman la métrica). */
export function claveDeEvaluacion(c: CuerpoEvaluacion): ClaveComparacion {
  return {
    hipotesisId: c.hipotesisId ?? '',
    segmento: c.segmento,
    kpiId: c.kpiId,
    definicionMetrica: `${c.kpiId}:${c.medicion?.unidad ?? ''}`,
    ventana: c.atribucion?.ventana ?? '',
    naturaleza: c.medicion?.naturaleza ?? '',
    politicaAtribucion: c.atribucion?.modelo ?? '',
    contexto: c.contexto,
  };
}

export interface ConsolidacionState {
  readonly organizacionId: string;
  readonly consolidacionId: string;
  readonly version: number;
  readonly existe: boolean;
  readonly clave: ClaveComparacion | null;
  readonly cuerpo: Consolidacion | null;
}

export const EVENTOS_CONSOLIDACION = { emitida: 'consolidacion.emitida' } as const;

export function consolidacionStreamId(organizacionId: string, consolidacionId: string): string {
  return `consolidacion-op:${organizacionId}:${consolidacionId}`;
}

export function estadoInicialConsolidacion(organizacionId: string, consolidacionId: string): ConsolidacionState {
  return { organizacionId, consolidacionId, version: 0, existe: false, clave: null, cuerpo: null };
}

export function aplicarConsolidacion(state: ConsolidacionState, event: RecordedEvent): ConsolidacionState {
  const next = { ...state, version: state.version + 1 };
  if (event.type === EVENTOS_CONSOLIDACION.emitida) {
    if (state.existe) return next; // idempotente por id determinista
    const p = event.payload as { clave: ClaveComparacion; cuerpo: Consolidacion };
    return { ...next, existe: true, clave: p.clave, cuerpo: p.cuerpo };
  }
  return next;
}

export function reconstruirConsolidacion(organizacionId: string, consolidacionId: string, events: readonly RecordedEvent[]): ConsolidacionState {
  return events.reduce(aplicarConsolidacion, estadoInicialConsolidacion(organizacionId, consolidacionId));
}
