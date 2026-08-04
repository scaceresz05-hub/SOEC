/**
 * @soec/motor-medicion · dominio · CONSOLIDACIÓN ENTRE EXPERIMENTOS (determinista).
 *
 * Permite combinar múltiples evaluaciones SOLO si son compatibles en hipótesis, segmento, KPI, definición
 * de métrica, ventana, naturaleza, política de atribución y contexto. Si no lo son ⇒ NO_COMPARABLES.
 * PROHIBIDO promediar resultados incompatibles. La consolidación es lo único que puede elevar la confianza
 * más allá de un experimento — una sola evaluación nunca generaliza.
 */
import type { Confianza, EvaluacionHipotesis } from './evaluacion-hipotesis';

export interface ClaveComparacion {
  readonly hipotesisId: string;
  readonly segmento: string;
  readonly kpiId: string;
  readonly definicionMetrica: string;
  readonly ventana: string;
  readonly naturaleza: string;
  readonly politicaAtribucion: string;
  readonly contexto: string;
}

export type EstadoConsolidacion = 'CONSOLIDADA' | 'NO_COMPARABLES' | 'INSUFICIENTE';

export interface Consolidacion {
  readonly estado: EstadoConsolidacion;
  readonly hipotesisId: string;
  readonly experimentos: number;
  readonly respaldos: number;
  readonly refutaciones: number;
  readonly confianza: Confianza;
  readonly transferible: boolean; // solo si hay respaldo consistente en varios experimentos comparables
  readonly explicacion: string;
  readonly incompatibilidades: readonly string[];
}

function mismaClave(a: ClaveComparacion, b: ClaveComparacion): string[] {
  const dif: string[] = [];
  (Object.keys(a) as (keyof ClaveComparacion)[]).forEach((k) => { if (a[k] !== b[k]) dif.push(String(k)); });
  return dif;
}

export function consolidar(clave: ClaveComparacion, entradas: readonly { clave: ClaveComparacion; evaluacion: EvaluacionHipotesis }[]): Consolidacion {
  const incompat = new Set<string>();
  for (const e of entradas) mismaClave(clave, e.clave).forEach((d) => incompat.add(d));
  const comun = { hipotesisId: clave.hipotesisId, experimentos: entradas.length };

  if (incompat.size > 0) {
    return { ...comun, estado: 'NO_COMPARABLES', respaldos: 0, refutaciones: 0, confianza: 'nula', transferible: false, explicacion: 'las evaluaciones no son comparables; prohibido promediarlas', incompatibilidades: [...incompat] };
  }
  const respaldos = entradas.filter((e) => e.evaluacion.estado === 'RESPALDADA').length;
  const refutaciones = entradas.filter((e) => e.evaluacion.estado === 'REFUTADA').length;
  if (entradas.length < 2) {
    return { ...comun, estado: 'INSUFICIENTE', respaldos, refutaciones, confianza: 'baja', transferible: false, explicacion: 'una sola evaluación no permite generalizar', incompatibilidades: [] };
  }
  const consistente = respaldos >= 2 && refutaciones === 0;
  const confianza: Confianza = consistente ? 'alta' : respaldos > refutaciones ? 'media' : 'baja';
  return {
    ...comun, estado: 'CONSOLIDADA', respaldos, refutaciones, confianza, transferible: consistente,
    explicacion: consistente ? 'respaldo consistente en múltiples experimentos comparables' : 'evidencia mixta o insuficientemente consistente para transferir',
    incompatibilidades: [],
  };
}
