/**
 * @soec/motor-medicion · CONTRATOS (puertos).
 *
 * `LecturaMedicion`: puerto de SOLO LECTURA para M9. M9 CONSUME el conocimiento operacional de M8
 * —observaciones, evaluaciones, atribuciones, consolidaciones, aprendizajes, recomendaciones, memoria,
 * contradicciones, vigencia, reconciliación— pero NO puede reescribir la historia de M8. Los snapshots son
 * profundamente inmutables (congelados en runtime). Se EXCLUYE o MARCA lo inválido/no-vigente/no-comparable.
 */
import type { RequestContext } from '@soec/contracts';
import type { ObservacionState, NaturalezaDato } from '../dominio/observacion';
import type { EvaluacionOperacionState, EstadoEvaluacion } from '../dominio/evaluacion-operacion';
import type { ConsolidacionState } from '../dominio/consolidacion-operacion';
import type { EstadoResultado } from '../dominio/evaluacion-resultado';
import type { EstadoHipotesis } from '../dominio/evaluacion-hipotesis';
import type { GradoAtribucion } from '../dominio/atribucion-op';
import type { EstadoRecomendacion, TipoRecomendacion } from '../dominio/recomendacion';
import type { EstadoConsolidacion } from '../dominio/consolidacion';

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
  readonly estado: EstadoEvaluacion; // ABIERTA | EMITIDA | REQUIERE_REVISION | OBSOLETA
  readonly vigente: boolean;
  readonly resultado: EstadoResultado | null;
  readonly hipotesis: EstadoHipotesis | null;
  readonly atribucion: GradoAtribucion | null;
  readonly recomendacion: { readonly estado: EstadoRecomendacion; readonly tipo: TipoRecomendacion } | null;
  readonly alcance: 'LOCAL_AL_EXPERIMENTO' | null;
  readonly naturaleza: string | null;
  readonly contradicciones: readonly string[];
  readonly medible: boolean; // sólo vigente y evaluable
  readonly explicacion: string;
}

export interface ConsolidacionM9 {
  readonly consolidacionId: string;
  readonly hipotesisId: string;
  readonly estado: EstadoConsolidacion;
  readonly alcance: 'LOCAL' | 'TRANSFERIBLE';
  readonly experimentosUnicos: number;
  readonly incluidas: readonly string[];
  readonly excluidas: readonly { readonly evaluacionId: string; readonly motivo: string }[];
  readonly contradicciones: readonly string[];
  readonly confianza: string;
  readonly explicacion: string;
}

export interface AprendizajeM9 {
  readonly aprendizajeId: string;
  readonly evaluacionId: string;
  readonly hipotesisId: string | null;
  readonly vigente: boolean; // falso si su evaluación quedó OBSOLETA/REQUIERE_REVISION
}

export interface MemoriaM9 {
  readonly intentos: number; // histórico persistido (memoria event-sourced)
  readonly respaldadas: readonly string[]; // hipótesis con evaluación RESPALDADA VIGENTE
  readonly refutadas: readonly string[];
  readonly inconclusas: readonly string[];
  readonly aprendizajesVigentes: readonly string[];
  readonly aprendizajesInvalidados: readonly string[];
  readonly simuladas: number;
}

/** PUERTO DE LECTURA para M9. Solo lectura; snapshots inmutables; excluye/marca lo inválido. */
export interface LecturaMedicion {
  cargarObservacion(ctx: RequestContext, observacionId: string): Promise<ObservacionState>;
  listarObservaciones(ctx: RequestContext): Promise<readonly ObservacionM9[]>;
  cargarEvaluacion(ctx: RequestContext, evaluacionId: string): Promise<EvaluacionOperacionState>;
  listarEvaluaciones(ctx: RequestContext): Promise<readonly EvaluacionM9[]>;
  cargarConsolidacion(ctx: RequestContext, consolidacionId: string): Promise<ConsolidacionState>;
  listarConsolidaciones(ctx: RequestContext): Promise<readonly ConsolidacionM9[]>;
  listarAprendizajes(ctx: RequestContext): Promise<readonly AprendizajeM9[]>;
  memoria(ctx: RequestContext): Promise<MemoriaM9>;
}
