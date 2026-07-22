/**
 * Evaluación y clasificación de desempeño (F2-MET-01 §4.5, §14, §15). Compara un
 * indicador contra su línea base y meta, con suficiencia de evidencia. Usa umbrales
 * DETERMINISTAS declarados (no inventa significancia estadística). La ausencia de
 * datos no es fracaso: se distingue "evidencia insuficiente" de "por debajo de umbral".
 */
import type { NivelCalidad } from './quality';

export type ClasificacionDesempeno =
  | 'sin_datos'
  | 'evidencia_insuficiente'
  | 'bajo_observacion'
  | 'bajo_umbral'
  | 'dentro_de_rango'
  | 'sobre_objetivo'
  | 'anomalia'
  | 'no_comparable';

export const EVALUACION_VERSION = 'evaluacion@1';

export interface CriterioObjetivo {
  readonly objetivoId: string;
  readonly indicador: string;
  readonly lineaBase: number;
  readonly meta: number;
  readonly tolerancia: number; // fracción [0,1] alrededor de la línea base que se considera "dentro de rango"
  readonly muestraMinima: number;
}

export interface Evaluacion {
  readonly objetivoId: string;
  readonly indicador: string;
  readonly version: string;
  readonly lineaBase: number;
  readonly meta: number;
  readonly resultado: number | null;
  readonly diferencia: number | null;
  readonly clasificacion: ClasificacionDesempeno;
  readonly evidenciaSuficiente: boolean;
  readonly calidad: NivelCalidad;
  readonly explicacion: string;
  readonly limitaciones: readonly string[];
  readonly faltantes: readonly string[];
}

export function evaluar(
  criterio: CriterioObjetivo,
  resultado: number | null,
  calidad: NivelCalidad,
  suficiente: boolean,
  hayAnomalia: boolean,
  faltantes: readonly string[],
): Evaluacion {
  const comun = { objetivoId: criterio.objetivoId, indicador: criterio.indicador, version: EVALUACION_VERSION, lineaBase: criterio.lineaBase, meta: criterio.meta, calidad, faltantes };
  if (resultado === null || calidad === 'no_disponible') {
    return { ...comun, resultado: null, diferencia: null, clasificacion: 'sin_datos', evidenciaSuficiente: false, explicacion: 'no hay datos para evaluar el objetivo', limitaciones: ['la ausencia de datos no implica un resultado negativo'] };
  }
  if (hayAnomalia) {
    return { ...comun, resultado, diferencia: resultado - criterio.lineaBase, clasificacion: 'anomalia', evidenciaSuficiente: false, explicacion: 'se detectó una anomalía; el resultado no es comparable', limitaciones: ['resolver la anomalía antes de concluir'] };
  }
  if (!suficiente) {
    return { ...comun, resultado, diferencia: resultado - criterio.lineaBase, clasificacion: 'evidencia_insuficiente', evidenciaSuficiente: false, explicacion: 'la evidencia todavía no alcanza el mínimo definido por la política', limitaciones: ['esperar más observaciones antes de decidir'] };
  }
  const diferencia = resultado - criterio.lineaBase;
  const rango = Math.abs(criterio.lineaBase) * criterio.tolerancia;
  let clasificacion: ClasificacionDesempeno;
  if (resultado >= criterio.meta) clasificacion = 'sobre_objetivo';
  else if (diferencia < -rango) clasificacion = 'bajo_umbral';
  else clasificacion = 'dentro_de_rango';
  return { ...comun, resultado, diferencia, clasificacion, evidenciaSuficiente: true, explicacion: `resultado ${resultado.toFixed(4)} vs línea base ${criterio.lineaBase} y meta ${criterio.meta}`, limitaciones: [] };
}
