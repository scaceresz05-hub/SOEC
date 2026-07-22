/**
 * Observaciones y métricas normalizadas (F2-MET-01 §4.2, §4.3, §10, §11). Una
 * observación es un dato recibido de una fuente; se normaliza a un vocabulario
 * canónico conservando el dato original, la unidad, la versión del mapper y (si hay
 * conversión de moneda) la TASA explícita. La deduplicación conserva la corrección
 * legítima (mayor secuencia del proveedor) y descarta el duplicado exacto.
 */
import { type MetricaCanonica, type UnidadMetrica, MAPPER_METRICAS_VERSION, aCanonica, esMonetaria } from './vocabulary';

export interface Observacion {
  readonly fuenteId: string;
  readonly canal: string;
  readonly cuenta: string;
  readonly externalRef: string;
  readonly metricaProveedor: string;
  readonly valor: number;
  readonly unidad: string;
  readonly moneda: string | null;
  readonly periodo: string;
  readonly dimension: string;
  readonly ocurridoEn: string;
  readonly recibidoEn: string;
  /** Secuencia del proveedor: una corrección posterior trae una secuencia mayor. */
  readonly proveedorSeq: number;
  readonly acumulativa: boolean;
  readonly estimada: boolean;
}

export interface MetricaNormalizada {
  readonly metrica: MetricaCanonica;
  readonly valor: number;
  readonly unidad: UnidadMetrica;
  readonly moneda: string | null;
  readonly tasaCambio: number | null;
  readonly periodo: string;
  readonly ocurridoEn: string;
  readonly acumulativa: boolean;
  readonly estimada: boolean;
  readonly mapperVersion: string;
  readonly original: { nombre: string; valor: number; unidad: string };
  readonly externalRef: string;
  readonly proveedorSeq: number;
}

/** Clave estable de deduplicación (sin proveedorSeq: una corrección comparte clave). */
export function claveDedup(o: Pick<Observacion, 'fuenteId' | 'cuenta' | 'externalRef' | 'metricaProveedor' | 'periodo' | 'dimension'>): string {
  return `${o.fuenteId}|${o.cuenta}|${o.externalRef}|${o.metricaProveedor}|${o.periodo}|${o.dimension}`;
}

function unidadCanonica(u: string, monetaria: boolean): UnidadMetrica {
  if (monetaria) return 'monetario';
  if (u === 'segundos') return 'segundos';
  if (u === 'porcentaje') return 'porcentaje';
  return 'conteo';
}

/** Normaliza una observación al vocabulario canónico; null si la métrica es desconocida. */
export function normalizar(o: Observacion): MetricaNormalizada | null {
  const metrica = aCanonica(o.metricaProveedor);
  if (!metrica) return null;
  const monetaria = esMonetaria(metrica);
  return {
    metrica,
    valor: o.valor,
    unidad: unidadCanonica(o.unidad, monetaria),
    moneda: monetaria ? o.moneda : null,
    tasaCambio: null, // sin conversión silenciosa: la conversión de moneda exige una tasa explícita
    periodo: o.periodo,
    ocurridoEn: o.ocurridoEn,
    acumulativa: o.acumulativa,
    estimada: o.estimada,
    mapperVersion: MAPPER_METRICAS_VERSION,
    original: { nombre: o.metricaProveedor, valor: o.valor, unidad: o.unidad },
    externalRef: o.externalRef,
    proveedorSeq: o.proveedorSeq,
  };
}

/**
 * Deduplica un lote de observaciones conservando, por clave, la de MAYOR secuencia del
 * proveedor (la corrección legítima). Los duplicados exactos (misma secuencia) se descartan.
 */
export function deduplicar(observaciones: readonly Observacion[]): { conservadas: Observacion[]; duplicadosDescartados: number; correcciones: number } {
  const porClave = new Map<string, Observacion>();
  let duplicados = 0;
  let correcciones = 0;
  for (const o of observaciones) {
    const k = claveDedup(o);
    const prev = porClave.get(k);
    if (!prev) {
      porClave.set(k, o);
    } else if (o.proveedorSeq > prev.proveedorSeq) {
      porClave.set(k, o);
      correcciones += 1;
    } else {
      duplicados += 1;
    }
  }
  return { conservadas: [...porClave.values()], duplicadosDescartados: duplicados, correcciones };
}
