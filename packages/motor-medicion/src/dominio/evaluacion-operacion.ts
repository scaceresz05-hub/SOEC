/**
 * @soec/motor-medicion · dominio · EVALUACIÓN OPERACIONAL (registro event-sourced GRANULAR).
 *
 * Se construye por PASOS event-sourced —medición, resultado, atribución, hipótesis, recomendación, cierre—
 * de modo que cada paso es una FRONTERA real de fallo/recuperación: un fallo entre pasos deja un estado
 * parcial verificable y un reintento repara SÓLO lo faltante (cada paso es idempotente). Se INVALIDA
 * (REQUIERE_REVISION/OBSOLETA) cuando cambian sus supuestos; nunca en silencio. Multi-tenant.
 *
 * Estados: ABIERTA → EMITIDA → REQUIERE_REVISION → OBSOLETA (o EMITIDA→OBSOLETA directo).
 */
import type { RecordedEvent } from '@soec/contracts';
import type { EvaluacionResultado } from './evaluacion-resultado';
import type { EvaluacionHipotesis } from './evaluacion-hipotesis';
import type { AtribucionOperacional } from './atribucion-op';
import type { Recomendacion } from './recomendacion';

export type EstadoEvaluacion = 'ABIERTA' | 'EMITIDA' | 'REQUIERE_REVISION' | 'OBSOLETA';

/** Snapshot de la medición usada (observado). Distingue ausencia (valor null) de cero. */
export interface MedicionSnapshot {
  readonly valor: number | null;
  readonly calidad: string;
  readonly cobertura: number;
  readonly unidad: string;
  readonly naturaleza: string;
}

export interface CuerpoEvaluacion {
  readonly observacionId: string;
  readonly hipotesisId: string | null;
  readonly kpiId: string;
  readonly segmento: string;
  readonly contexto: string;
  readonly medicion: MedicionSnapshot | null;
  readonly resultado: EvaluacionResultado | null;
  readonly hipotesis: EvaluacionHipotesis | null;
  readonly atribucion: AtribucionOperacional | null;
  readonly recomendacion: Recomendacion | null;
  readonly explicacion: string;
}

export interface EvaluacionOperacionState {
  readonly organizacionId: string;
  readonly evaluacionId: string;
  readonly version: number;
  readonly existe: boolean;
  readonly estado: EstadoEvaluacion;
  readonly cuerpo: CuerpoEvaluacion;
  readonly motivoObsolescencia: string | null;
}

export const EVENTOS_EVALUACION = {
  medicion: 'evaluacion.medicion',
  resultado: 'evaluacion.resultado',
  atribucion: 'evaluacion.atribucion',
  hipotesis: 'evaluacion.hipotesis',
  recomendacion: 'evaluacion.recomendacion',
  cerrada: 'evaluacion.cerrada',
  revision: 'evaluacion.revision',
  obsoleta: 'evaluacion.obsoleta',
} as const;

export function evaluacionStreamId(organizacionId: string, evaluacionId: string): string {
  return `evaluacion-op:${organizacionId}:${evaluacionId}`;
}

const CUERPO_VACIO: CuerpoEvaluacion = {
  observacionId: '', hipotesisId: null, kpiId: '', segmento: '', contexto: '', medicion: null, resultado: null, hipotesis: null, atribucion: null, recomendacion: null, explicacion: '',
};

export function estadoInicialEvaluacion(organizacionId: string, evaluacionId: string): EvaluacionOperacionState {
  return { organizacionId, evaluacionId, version: 0, existe: false, estado: 'ABIERTA', cuerpo: CUERPO_VACIO, motivoObsolescencia: null };
}

export function aplicarEvaluacion(state: EvaluacionOperacionState, event: RecordedEvent): EvaluacionOperacionState {
  const next = { ...state, version: state.version + 1 };
  const c = state.cuerpo;
  const p = event.payload as Record<string, unknown>;
  switch (event.type) {
    case EVENTOS_EVALUACION.medicion:
      if (c.medicion) return next; // idempotente por paso
      return { ...next, existe: true, cuerpo: { ...c, observacionId: p.observacionId as string, hipotesisId: (p.hipotesisId as string) ?? null, kpiId: p.kpiId as string, segmento: p.segmento as string, contexto: (p.contexto as string) ?? '', medicion: p.medicion as MedicionSnapshot } };
    case EVENTOS_EVALUACION.resultado:
      if (c.resultado) return next;
      return { ...next, existe: true, cuerpo: { ...c, resultado: p.resultado as EvaluacionResultado } };
    case EVENTOS_EVALUACION.atribucion:
      if (c.atribucion) return next;
      return { ...next, existe: true, cuerpo: { ...c, atribucion: (p.atribucion as AtribucionOperacional) ?? null } };
    case EVENTOS_EVALUACION.hipotesis:
      if (c.hipotesis) return next;
      return { ...next, existe: true, cuerpo: { ...c, hipotesis: (p.hipotesis as EvaluacionHipotesis) ?? null } };
    case EVENTOS_EVALUACION.recomendacion:
      if (c.recomendacion) return next;
      return { ...next, existe: true, cuerpo: { ...c, recomendacion: p.recomendacion as Recomendacion, explicacion: p.explicacion as string } };
    case EVENTOS_EVALUACION.cerrada:
      if (state.estado !== 'ABIERTA') return next;
      return { ...next, estado: 'EMITIDA' };
    case EVENTOS_EVALUACION.revision:
      if (state.estado !== 'EMITIDA') return next;
      return { ...next, estado: 'REQUIERE_REVISION', motivoObsolescencia: (p.motivo as string) ?? null };
    case EVENTOS_EVALUACION.obsoleta:
      if (state.estado !== 'EMITIDA' && state.estado !== 'REQUIERE_REVISION') return next;
      return { ...next, estado: 'OBSOLETA', motivoObsolescencia: (p.motivo as string) ?? state.motivoObsolescencia };
    default:
      return next;
  }
}

export function reconstruirEvaluacion(organizacionId: string, evaluacionId: string, events: readonly RecordedEvent[]): EvaluacionOperacionState {
  return events.reduce(aplicarEvaluacion, estadoInicialEvaluacion(organizacionId, evaluacionId));
}

/** ¿La evaluación está VIGENTE (emitida y no invalidada)? */
export function evaluacionVigente(st: EvaluacionOperacionState): boolean {
  return st.existe && st.estado === 'EMITIDA';
}
