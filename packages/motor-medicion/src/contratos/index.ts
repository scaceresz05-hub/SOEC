/**
 * @soec/motor-medicion · CONTRATOS (puertos).
 *
 * `LecturaMedicion`: puerto de SOLO LECTURA para M9 (optimización/adaptación). M9 CONSUME el conocimiento
 * operacional de M8 —observaciones, evaluaciones, atribuciones, aprendizajes, recomendaciones, memoria,
 * contradicciones, vigencia, reconciliación— pero NO puede reescribir la historia de M8. Los snapshots son
 * profundamente inmutables (congelados en runtime).
 */
import type { RequestContext } from '@soec/contracts';
import type { ObservacionState, NaturalezaDato } from '../dominio/observacion';
import type { EvaluacionOperacionState } from '../dominio/evaluacion-operacion';
import type { EstadoResultado } from '../dominio/evaluacion-resultado';
import type { EstadoHipotesis } from '../dominio/evaluacion-hipotesis';
import type { GradoAtribucion } from '../dominio/atribucion-op';
import type { EstadoRecomendacion, TipoRecomendacion } from '../dominio/recomendacion';

export interface ObservacionM9 {
  readonly observacionId: string;
  readonly ordenId: string;
  readonly kpiId: string;
  readonly hipotesisId: string | null;
  readonly estado: string;
  readonly valor: number | null;
  readonly naturaleza: NaturalezaDato;
  readonly medible: boolean;
}

export interface EvaluacionM9 {
  readonly evaluacionId: string;
  readonly observacionId: string;
  readonly kpiId: string;
  readonly hipotesisId: string | null;
  readonly segmento: string;
  readonly estado: string; // EMITIDA | OBSOLETA
  readonly resultado: EstadoResultado;
  readonly hipotesis: EstadoHipotesis | null;
  readonly atribucion: GradoAtribucion | null;
  readonly recomendacion: { readonly estado: EstadoRecomendacion; readonly tipo: TipoRecomendacion };
  readonly medible: boolean; // solo COMPLETA/evaluable y vigente
  readonly explicacion: string;
}

export interface AprendizajeM9 {
  readonly aprendizajeId: string;
  readonly evaluacionId: string;
  readonly hipotesisId: string | null;
  readonly vigente: boolean; // falso si su evaluación quedó OBSOLETA
}

export interface MemoriaM9 {
  readonly intentos: number;
  readonly respaldadas: readonly string[]; // hipótesis con evaluación RESPALDADA vigente
  readonly refutadas: readonly string[];
  readonly inconclusas: readonly string[];
  readonly aprendizajesVigentes: readonly string[];
  readonly aprendizajesInvalidados: readonly string[];
  readonly simuladas: number; // observaciones de naturaleza SIMULADA
}

/** PUERTO DE LECTURA para M9. Solo lectura; snapshots inmutables. */
export interface LecturaMedicion {
  cargarObservacion(ctx: RequestContext, observacionId: string): Promise<ObservacionState>;
  listarObservaciones(ctx: RequestContext): Promise<readonly ObservacionM9[]>;
  cargarEvaluacion(ctx: RequestContext, evaluacionId: string): Promise<EvaluacionOperacionState>;
  listarEvaluaciones(ctx: RequestContext): Promise<readonly EvaluacionM9[]>;
  listarAprendizajes(ctx: RequestContext): Promise<readonly AprendizajeM9[]>;
  memoria(ctx: RequestContext): Promise<MemoriaM9>;
}
