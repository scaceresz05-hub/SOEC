/**
 * Experimentos A/B (F2-MET-01 §20). Modelo con reglas DETERMINISTAS y transparentes:
 * no se declara ganador sin cumplir el mínimo de observaciones; sin motor estadístico
 * complejo. Compara una métrica principal entre control y variante.
 */
export type EstadoExperimento = 'activo' | 'concluido' | 'inconcluso' | 'cancelado';

export interface Experimento {
  readonly experimentoId: string;
  readonly hipotesis: string;
  readonly metricaPrincipal: string;
  readonly control: { actividadId: string; publicationId: string };
  readonly variante: { actividadId: string; publicationId: string };
  readonly minimoObservaciones: number;
  readonly margenMinimo: number; // diferencia relativa mínima para declarar ganador
}

export interface ResultadoExperimento {
  readonly estado: EstadoExperimento;
  readonly ganador: 'control' | 'variante' | null;
  readonly valorControl: number;
  readonly valorVariante: number;
  readonly evidencia: string;
}

/** Regla determinista: exige mínimo de observaciones y un margen relativo para declarar ganador. */
export function evaluarExperimento(
  exp: Experimento,
  valorControl: number,
  obsControl: number,
  valorVariante: number,
  obsVariante: number,
): ResultadoExperimento {
  if (obsControl < exp.minimoObservaciones || obsVariante < exp.minimoObservaciones) {
    return { estado: 'inconcluso', ganador: null, valorControl, valorVariante, evidencia: `observaciones insuficientes (control ${obsControl}, variante ${obsVariante}; mínimo ${exp.minimoObservaciones})` };
  }
  const mejor = Math.max(valorControl, valorVariante);
  const peor = Math.min(valorControl, valorVariante);
  const margen = peor === 0 ? (mejor > 0 ? 1 : 0) : (mejor - peor) / peor;
  if (margen < exp.margenMinimo) {
    return { estado: 'inconcluso', ganador: null, valorControl, valorVariante, evidencia: `diferencia ${(margen * 100).toFixed(1)}% < margen mínimo ${(exp.margenMinimo * 100).toFixed(1)}%` };
  }
  const ganador = valorVariante > valorControl ? 'variante' : 'control';
  return { estado: 'concluido', ganador, valorControl, valorVariante, evidencia: `${ganador} supera por ${(margen * 100).toFixed(1)}% con evidencia suficiente` };
}
