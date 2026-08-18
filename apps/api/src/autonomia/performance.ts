/**
 * apps/api · V2-C · PERFORMANCE OBSERVATION. Deriva métricas SOLO de lo observado (impresiones, clics, gasto,
 * resultados). Respeta la epistemología SSR: no inventa ROI ni causalidad; si falta el dato, la métrica es
 * null y se explicita. Read-only puro: no muta nada, no llama a Meta (en shadow recibe datos ya persistidos).
 */

export interface ObservacionAnuncio {
  readonly adRef: string; // referencia del anuncio (simulada en shadow)
  readonly impresiones: number;
  readonly clics: number;
  readonly gastoMinor: number; // gasto observado (minor units)
  readonly resultados: number; // conversiones/resultados atribuidos por Meta (0 si no hay)
  readonly ventanaHoras: number; // antigüedad de la ventana observada
}

export type CalidadMetrica = 'MEDIBLE' | 'INSUFICIENTE' | 'SIN_DATO';

export interface MetricasAnuncio {
  readonly adRef: string;
  readonly ctr: number | null; // clics/impresiones; null si impresiones=0
  readonly cprMinor: number | null; // costo por resultado; null si resultados=0
  readonly cpcMinor: number | null; // costo por clic; null si clics=0
  readonly gastoMinor: number;
  readonly resultados: number;
  readonly calidad: CalidadMetrica; // ¿hay evidencia suficiente para evaluar?
  readonly nota: string;
}

const MIN_IMPRESIONES_EVALUABLE = 1000; // umbral mínimo para considerar la señal evaluable
const MAX_VENTANA_HORAS = 72; // datos más viejos que esto son STALE: no se decide sobre ellos

export function derivarMetricas(o: ObservacionAnuncio): MetricasAnuncio {
  const ctr = o.impresiones > 0 ? o.clics / o.impresiones : null;
  const cprMinor = o.resultados > 0 ? Math.round(o.gastoMinor / o.resultados) : null;
  const cpcMinor = o.clics > 0 ? Math.round(o.gastoMinor / o.clics) : null;
  let calidad: CalidadMetrica;
  let nota: string;
  if (o.impresiones === 0) {
    calidad = 'SIN_DATO';
    nota = 'sin impresiones observadas: no evaluable';
  } else if (o.ventanaHoras > MAX_VENTANA_HORAS) {
    calidad = 'INSUFICIENTE';
    nota = `datos obsoletos (ventana ${o.ventanaHoras}h > ${MAX_VENTANA_HORAS}h): no decidir sobre datos viejos`;
  } else if (o.impresiones < MIN_IMPRESIONES_EVALUABLE) {
    calidad = 'INSUFICIENTE';
    nota = `evidencia insuficiente (${o.impresiones} impresiones < ${MIN_IMPRESIONES_EVALUABLE}); no concluir`;
  } else {
    calidad = 'MEDIBLE';
    nota = 'evidencia suficiente para evaluar rendimiento relativo (no causal)';
  }
  return { adRef: o.adRef, ctr, cprMinor, cpcMinor, gastoMinor: o.gastoMinor, resultados: o.resultados, calidad, nota };
}

export function derivarLote(obs: readonly ObservacionAnuncio[]): MetricasAnuncio[] {
  return obs.map(derivarMetricas);
}
