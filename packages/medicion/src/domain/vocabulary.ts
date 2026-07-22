/**
 * Vocabulario canónico de métricas (F2-MET-01 §4.3). Las métricas heterogéneas de
 * los proveedores se convierten a este vocabulario, conservando el dato original y la
 * versión del mapper. Distingue métricas acumulativas de incrementales, y estimadas
 * de confirmadas (en la métrica normalizada), sin conversiones silenciosas.
 */
export type MetricaCanonica =
  | 'impresiones'
  | 'alcance'
  | 'visualizaciones'
  | 'reproducciones'
  | 'clics'
  | 'clics_unicos'
  | 'interacciones'
  | 'comentarios'
  | 'compartidos'
  | 'guardados'
  | 'aperturas'
  | 'respuestas'
  | 'sesiones'
  | 'leads'
  | 'leads_calificados'
  | 'conversiones'
  | 'ventas_atribuidas'
  | 'ingresos_atribuidos'
  | 'gasto'
  | 'costo'
  | 'tiempo_visualizacion'
  | 'tasa_finalizacion';

export type UnidadMetrica = 'conteo' | 'monetario' | 'segundos' | 'porcentaje';

const MONETARIAS: ReadonlySet<MetricaCanonica> = new Set(['gasto', 'costo', 'ingresos_atribuidos', 'ventas_atribuidas']);

export function esMonetaria(m: MetricaCanonica): boolean {
  return MONETARIAS.has(m);
}

/** Mapa de nombres de proveedor → métrica canónica (extensible por adaptador). */
const MAPA_PROVEEDOR: Readonly<Record<string, MetricaCanonica>> = {
  impresiones: 'impresiones',
  impressions: 'impresiones',
  clics: 'clics',
  clicks: 'clics',
  leads: 'leads',
  conversiones: 'conversiones',
  conversions: 'conversiones',
  gasto: 'gasto',
  spend: 'gasto',
  ingresos: 'ingresos_atribuidos',
};

export function aCanonica(nombreProveedor: string): MetricaCanonica | null {
  return MAPA_PROVEEDOR[nombreProveedor] ?? null;
}

export const MAPPER_METRICAS_VERSION = 'metrics-mapper-emulado@1';
