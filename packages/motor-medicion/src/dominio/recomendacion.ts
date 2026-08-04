/**
 * @soec/motor-medicion · dominio · RECOMENDACIÓN EXPLICABLE (determinista).
 *
 * M8 puede RECOMENDAR pero NUNCA ejecutar. Cuando la evidencia es insuficiente, se ABSTIENE (no recomienda
 * una acción). Toda recomendación declara fundamento, evidencia, contraevidencia, confianza, limitaciones,
 * impacto esperado, riesgos y datos faltantes. La decisión de actuar es de M9/el humano, no de M8.
 */
import type { Confianza, EstadoHipotesis } from './evaluacion-hipotesis';
import type { EstadoResultado } from './evaluacion-resultado';

export type TipoRecomendacion =
  | 'repetir' | 'detener' | 'revisar' | 'ampliar_evidencia' | 'cambiar_hipotesis'
  | 'cambiar_segmento' | 'cambiar_mensaje' | 'repetir_experimento' | 'no_actuar';
export type EstadoRecomendacion = 'RECOMENDACION' | 'ABSTENCION';
export const RECOMENDACION_VERSION = 'recomendacion@1';

export interface Recomendacion {
  readonly version: string;
  readonly estado: EstadoRecomendacion;
  readonly tipo: TipoRecomendacion;
  readonly fundamento: string;
  readonly evidencia: readonly string[];
  readonly contraevidencia: readonly string[];
  readonly confianza: Confianza;
  readonly limitaciones: readonly string[];
  readonly impactoEsperado: string;
  readonly riesgos: readonly string[];
  readonly datosFaltantes: readonly string[];
}

export interface EntradaRecomendacion {
  readonly estadoHipotesis: EstadoHipotesis;
  readonly estadoResultado: EstadoResultado;
  readonly confianza: Confianza;
  readonly evidencia: readonly string[];
  readonly contraevidencia: readonly string[];
  readonly datosFaltantes: readonly string[];
}

export function recomendar(e: EntradaRecomendacion): Recomendacion {
  const comun = {
    version: RECOMENDACION_VERSION, confianza: e.confianza, evidencia: e.evidencia, contraevidencia: e.contraevidencia,
    datosFaltantes: e.datosFaltantes, limitaciones: ['recomendación NO ejecutable por M8; decide M9/el humano'],
  };
  const mk = (estado: EstadoRecomendacion, tipo: TipoRecomendacion, fundamento: string, impactoEsperado: string, riesgos: string[]): Recomendacion =>
    ({ ...comun, estado, tipo, fundamento, impactoEsperado, riesgos });

  // ABSTENCIÓN: sin poder concluir o sin evidencia suficiente ⇒ no se recomienda una acción con efecto.
  if (e.estadoHipotesis === 'NO_EVALUABLE' || e.estadoResultado === 'NO_EVALUABLE' || e.estadoResultado === 'INCONSISTENTE') {
    return mk('ABSTENCION', 'ampliar_evidencia', 'la evidencia es insuficiente o inconsistente para recomendar una acción', 'ninguno hasta obtener datos', ['actuar sin evidencia suficiente']);
  }
  if (e.estadoHipotesis === 'INCONCLUSA') {
    return mk('ABSTENCION', 'repetir_experimento', 'evaluable pero no decide; conviene repetir antes de actuar', 'reduce incertidumbre', ['sobre-reaccionar a ruido']);
  }
  if (e.estadoHipotesis === 'RESPALDADA') {
    return mk('RECOMENDACION', 'repetir', 'el experimento respalda la hipótesis (local); repetir para confirmar antes de generalizar', 'consolidar la señal positiva', ['generalizar desde un solo experimento']);
  }
  if (e.estadoHipotesis === 'REFUTADA') {
    return mk('RECOMENDACION', 'revisar', 'el experimento refuta la hipótesis (local); revisar hipótesis o mensaje', 'evitar continuar una vía sin soporte', ['descartar una vía por un único resultado']);
  }
  // PARCIAL
  return mk('RECOMENDACION', 'ampliar_evidencia', 'señal parcial; ampliar evidencia antes de decidir el rumbo', 'clarificar una señal ambigua', ['interpretar una señal parcial como conclusión']);
}
