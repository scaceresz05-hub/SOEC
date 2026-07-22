/**
 * Calidad de la evidencia (F2-MET-01 §6). La ausencia de datos NO es un resultado
 * negativo. La calidad considera procedencia, completitud, retraso, tamaño de muestra,
 * consistencia y duplicados. Determina si hay evidencia suficiente para concluir.
 */
export type NivelCalidad = 'no_disponible' | 'insuficiente' | 'baja' | 'media' | 'alta' | 'confirmada';

export interface SenalesCalidad {
  readonly observaciones: number;
  readonly muestra: number; // p. ej. impresiones o clics
  readonly duplicados: number;
  readonly inconsistencias: number;
  readonly estimadas: number;
  readonly cobertura: number; // [0,1] fracción de métricas requeridas presentes
}

const ORDEN: readonly NivelCalidad[] = ['no_disponible', 'insuficiente', 'baja', 'media', 'alta', 'confirmada'];

export function calidadAlMenos(nivel: NivelCalidad, minimo: NivelCalidad): boolean {
  return ORDEN.indexOf(nivel) >= ORDEN.indexOf(minimo);
}

/** Umbral mínimo de muestra para considerar la evidencia suficiente (declarado, no estadístico). */
export function evaluarCalidad(s: SenalesCalidad, muestraMinima: number): { nivel: NivelCalidad; suficiente: boolean; motivos: string[] } {
  const motivos: string[] = [];
  if (s.observaciones === 0) return { nivel: 'no_disponible', suficiente: false, motivos: ['sin observaciones'] };
  if (s.inconsistencias > 0) motivos.push('hay métricas inconsistentes');
  if (s.cobertura < 0.6) motivos.push('cobertura insuficiente de métricas');
  if (s.muestra < muestraMinima) motivos.push(`muestra ${s.muestra} < mínimo ${muestraMinima}`);

  let nivel: NivelCalidad;
  if (s.muestra < muestraMinima) nivel = 'insuficiente';
  else if (s.inconsistencias > 0 || s.cobertura < 0.6) nivel = 'baja';
  else if (s.estimadas > 0) nivel = 'media';
  else nivel = 'alta';

  const suficiente = nivel !== 'insuficiente' && s.inconsistencias === 0;
  return { nivel, suficiente, motivos };
}
