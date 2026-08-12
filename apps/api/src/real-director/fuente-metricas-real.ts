/**
 * apps/api · CAPA DE COMPOSICIÓN · Fuente de métricas REAL para SOEC (implementa el puerto `MetricsSource`
 * de @soec/medicion en `modo: 'real'`). Traduce el ACUMULADO REAL vigente de la campaña de Google Ads —el
 * snapshot que también alimenta /resultados— a `FilaProveedor[]` canónicas, para que MeasurementService las
 * mida SIN saber que vienen de Google Ads. READ ONLY: solo lee estado ya persistido; no llama al proveedor.
 *
 * Por qué el snapshot y no las observaciones diarias: las observaciones diarias de M8 son first-wins por día,
 * así que el día EN CURSO queda congelado en el primer sync (clics/gasto de hoy no se reflejan). El snapshot
 * acumulado es la evidencia REAL fresca (all-time) que el panel ya usa. Las observaciones diarias siguen siendo
 * la traza granular gobernada en M8 (prueban REAL_DATA_REACHES_M8), pero NO son la fuente del acumulado vigente.
 *
 * INVARIANTES:
 *  - Solo métricas de CAMPAÑA de Google Ads (impresiones/clics/gasto). NUNCA eventos Growth ni diagnóstico.
 *  - NO atribuye conversiones a Ads: `conversiones = []` y la fila `conversiones = 0` es un HECHO observado
 *    (0 conversiones Ads-atribuibles), no una ausencia.
 */
import type { FilaProveedor, LoteMetricas, MetricsSource } from '@soec/medicion';

/** Acumulado vigente de la campaña (subconjunto del snapshot real). null en cualquier métrica ⇒ tratado como 0. */
export interface SnapshotCumulativo {
  readonly impressions: number | null;
  readonly clicks: number | null;
  readonly cost: number | null;
}

export interface OpcionesFilas {
  readonly campaignRef: string;
  readonly ocurridoEn: string;
  readonly periodo: string;
  /**
   * Secuencia del proveedor. Como el snapshot es ACUMULADO y se recalcula cada sync, cada corrida debe traer
   * una `proveedorSeq` MAYOR (una "corrección" que gana la deduplicación de MeasurementService), o el MedState
   * quedaría congelado en el primer valor del período. El llamador la incrementa por sincronización.
   */
  readonly proveedorSeq: number;
}

/**
 * Construye las filas canónicas ACUMULADAS desde el snapshot vigente. Función PURA, determinista.
 * Emite `conversiones = 0` como HECHO observado (0 conversiones Ads-atribuibles).
 */
export function filasDesdeSnapshot(snap: SnapshotCumulativo | null, opts: OpcionesFilas): FilaProveedor[] {
  const fila = (metrica: string, valor: number, unidad: string, moneda: string | null): FilaProveedor => ({
    externalId: opts.campaignRef, metrica, valor, unidad, moneda,
    periodo: opts.periodo, ocurridoEn: opts.ocurridoEn, proveedorSeq: opts.proveedorSeq, acumulativa: true, estimada: false,
  });
  return [
    fila('impresiones', snap?.impressions ?? 0, 'conteo', null),
    fila('clics', snap?.clicks ?? 0, 'conteo', null),
    fila('gasto', snap?.cost ?? 0, 'monetario', 'CLP'),
    fila('conversiones', 0, 'conteo', null), // 0 conversiones Ads-atribuibles: HECHO observado
  ];
}

/** Fuente REAL (READ ONLY): entrega filas ya construidas desde el snapshot. No cruza red ni consulta proveedores. */
export class FuenteMetricasRealSOEC implements MetricsSource {
  readonly nombre = 'metricas-real-soec';
  readonly modo = 'real' as const;
  constructor(private readonly filas: readonly FilaProveedor[]) {}

  async obtener(): Promise<LoteMetricas> {
    // conversiones = [] : ninguna conversión atribuible a Ads sin evidencia de procedencia verificable.
    return { filas: this.filas, cursor: null, conversiones: [] };
  }
  async obtenerDe(_t: string, _c: string, externalRef: string): Promise<readonly FilaProveedor[]> {
    return this.filas.filter((f) => f.externalId === externalRef);
  }
}
