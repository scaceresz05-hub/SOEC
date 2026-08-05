/**
 * @soec/motor-medicion · dominio · EVALUACIÓN DE HIPÓTESIS (motor puro y determinista).
 *
 * Vincula una hipótesis CANÓNICA de M5 (su `EstadoEvaluabilidad`) con la evaluación de resultado y la
 * evidencia a favor/en contra. NO crea hipótesis paralelas: consume el veredicto epistémico de M5. Una
 * ÚNICA ejecución NO convierte una hipótesis en verdad general — la conclusión es LOCAL al experimento y la
 * confianza queda acotada; la generalización exige consolidación entre experimentos (ver consolidación).
 *
 * Estados: RESPALDADA · REFUTADA · PARCIAL · INCONCLUSA · NO_EVALUABLE.
 */
import type { EstadoEvaluabilidad } from '@soec/motor-estrategico';
import type { EstadoResultado } from './evaluacion-resultado';

export type EstadoHipotesis = 'RESPALDADA' | 'REFUTADA' | 'PARCIAL' | 'INCONCLUSA' | 'NO_EVALUABLE';
export type Confianza = 'nula' | 'baja' | 'media' | 'alta';
export const EVALUACION_HIPOTESIS_VERSION = 'eval-hipotesis@1';

export interface EntradaEvaluacionHipotesis {
  readonly hipotesisId: string;
  readonly hipotesisVersion: number;
  readonly estadoM5: EstadoEvaluabilidad; // veredicto epistémico canónico de M5
  readonly resultado: EstadoResultado; // de evaluarResultado
  readonly evidenciaAFavor: number;
  readonly evidenciaEnContra: number;
  readonly observacionesExcluidas: number;
  readonly suficiente: boolean; // ¿la evidencia es suficiente para concluir?
  readonly pertinente: boolean; // ¿la evidencia es pertinente a esta hipótesis?
}

export interface EvaluacionHipotesis {
  readonly version: string;
  readonly hipotesisId: string;
  readonly hipotesisVersion: number;
  readonly estado: EstadoHipotesis;
  readonly confianza: Confianza;
  readonly alcance: 'LOCAL_AL_EXPERIMENTO'; // nunca general desde una sola evaluación
  readonly conclusionOperacional: string;
  readonly explicacion: string;
  readonly evidenciaAFavor: number;
  readonly evidenciaEnContra: number;
  readonly observacionesExcluidas: number;
}

export function evaluarHipotesis(e: EntradaEvaluacionHipotesis): EvaluacionHipotesis {
  const comun = {
    version: EVALUACION_HIPOTESIS_VERSION, hipotesisId: e.hipotesisId, hipotesisVersion: e.hipotesisVersion,
    alcance: 'LOCAL_AL_EXPERIMENTO' as const, evidenciaAFavor: e.evidenciaAFavor, evidenciaEnContra: e.evidenciaEnContra,
    observacionesExcluidas: e.observacionesExcluidas,
  };
  const mk = (estado: EstadoHipotesis, confianza: Confianza, conclusionOperacional: string, explicacion: string): EvaluacionHipotesis =>
    ({ ...comun, estado, confianza, conclusionOperacional, explicacion });

  // NO_EVALUABLE: no pertinente, o M5 no concluyente, o resultado no evaluable ⇒ no se puede concluir.
  if (!e.pertinente) return mk('NO_EVALUABLE', 'nula', 'no actuar', 'la evidencia no es pertinente a la hipótesis');
  if (e.estadoM5 === 'NO_EVALUABLE' || e.resultado === 'NO_EVALUABLE') return mk('NO_EVALUABLE', 'nula', 'ampliar evidencia', 'la hipótesis o el resultado no son evaluables (ausencia/insuficiencia de datos)');

  // INCONCLUSA: resultado contradictorio, evidencia insuficiente, o señales mixtas ⇒ evaluable pero no decide.
  if (e.resultado === 'INCONSISTENTE' || !e.suficiente || e.estadoM5 === 'GRIS') {
    return mk('INCONCLUSA', 'baja', 'repetir experimento', 'es evaluable pero la evidencia no alcanza para decidir (insuficiente/gris/contradictoria)');
  }

  // Señal a favor vs en contra + resultado + veredicto M5.
  const aFavorDomina = e.evidenciaAFavor > e.evidenciaEnContra;
  const enContraDomina = e.evidenciaEnContra > e.evidenciaAFavor;
  const confianzaBase: Confianza = e.evidenciaAFavor + e.evidenciaEnContra >= 2 ? 'media' : 'baja'; // acotada: un experimento no da alta

  if ((e.resultado === 'SUPERADO' || e.resultado === 'CUMPLIDO') && e.estadoM5 !== 'FALSO' && aFavorDomina) {
    return mk('RESPALDADA', confianzaBase, 'repetir para confirmar (no generalizar aún)', 'el resultado alcanza el objetivo y la evidencia a favor domina, LOCAL a este experimento');
  }
  if (e.resultado === 'NO_CUMPLIDO' || e.estadoM5 === 'FALSO' || enContraDomina) {
    return mk('REFUTADA', confianzaBase, 'revisar hipótesis', 'el resultado no cumple o la evidencia en contra domina, LOCAL a este experimento');
  }
  // PARCIAL: mejora sin alcanzar, o señales equilibradas.
  return mk('PARCIAL', 'baja', 'ampliar evidencia', 'hay señal parcial: mejora sin alcanzar el umbral o evidencia equilibrada');
}
