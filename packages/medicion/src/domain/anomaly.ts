/**
 * Detección de anomalías (F2-MET-01 §21). Produce hallazgos estructurados con código,
 * severidad, evidencia, impacto, acción posible y necesidad de intervención. Una
 * discrepancia de gasto relevante debe bloquear el escalamiento (lo aplica el motor
 * de optimización).
 */
import type { MetricaCanonica } from './vocabulary';

export type SeveridadAnomalia = 'info' | 'menor' | 'mayor' | 'critico';

export interface Anomalia {
  readonly codigo: string;
  readonly severidad: SeveridadAnomalia;
  readonly evidencia: string;
  readonly impacto: string;
  readonly accionPosible: string;
  readonly requiereIntervencion: boolean;
}

type Metricas = Partial<Record<MetricaCanonica, number>>;

export function detectarAnomalias(m: Metricas, gastoAutorizado: number | null): readonly Anomalia[] {
  const out: Anomalia[] = [];
  const g = (k: MetricaCanonica) => m[k] ?? 0;

  if (g('gasto') > 0 && g('conversiones') === 0 && g('clics') > 0) {
    out.push({ codigo: 'conversiones_cero_con_gasto', severidad: 'mayor', evidencia: `gasto ${g('gasto')} con 0 conversiones`, impacto: 'posible ineficiencia', accionPosible: 'revisar segmentación o pausar', requiereIntervencion: false });
  }
  if (g('conversiones') > g('impresiones') && g('impresiones') > 0) {
    out.push({ codigo: 'tasa_imposible', severidad: 'critico', evidencia: `conversiones ${g('conversiones')} > impresiones ${g('impresiones')}`, impacto: 'datos no confiables', accionPosible: 'descartar y reconsultar la fuente', requiereIntervencion: true });
  }
  if (gastoAutorizado !== null && g('gasto') > gastoAutorizado) {
    out.push({ codigo: 'gasto_superior_autorizado', severidad: 'critico', evidencia: `gasto ${g('gasto')} > autorizado ${gastoAutorizado}`, impacto: 'riesgo presupuestario', accionPosible: 'bloquear escalamiento y alertar', requiereIntervencion: true });
  }
  return out;
}

/** Anomalía de datos que retroceden (una métrica acumulativa disminuyó respecto al valor previo). */
export function anomaliaRetroceso(metrica: MetricaCanonica, previo: number, actual: number): Anomalia | null {
  if (actual < previo) {
    return { codigo: 'datos_retroceden', severidad: 'mayor', evidencia: `${metrica} acumulativa bajó de ${previo} a ${actual}`, impacto: 'inconsistencia temporal', accionPosible: 'reconciliar con la fuente', requiereIntervencion: true };
  }
  return null;
}
