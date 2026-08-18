/**
 * SOEC · ingesta · PANEL DE RESULTADOS (presentación pura de datos REALES ya persistidos).
 *
 * `construirPanel` es una función PURA (sin I/O) que agrega el SNAPSHOT acumulado vigente (stream dedicado
 * last-wins ⇒ refleja el acumulado de hoy en cada sync), las observaciones REALES ya ingeridas por M8
 * (términos + embudo Growth) y el estado de sincronización, produciendo una vista legible. NO calcula
 * atribución (Ads↔Growth), NO infiere de dónde vienen las demos, NO fabrica recomendaciones ni inventa
 * números. La ausencia de dato es `null` (jamás 0): ctr/cpc con denominador 0 son `null`, no 0. OBSERVE_ONLY.
 */
import type { SnapshotAdsActual } from './mapa-google-ads';

/** Observación REAL aplanada para el panel (subconjunto legible de `DatosObservacion` + `ProvenanciaReal`). */
export interface ObsPanel {
  readonly provider: string;
  readonly eventName: string;
  readonly metrica: string | null;
  readonly valor: number | null;
  readonly occurredAt: string;
  readonly diagnostico: boolean;
  readonly utmCampaign: string | null;
  readonly utmContent: string | null;
  readonly limitaciones: readonly string[];
  readonly externalEventId: string;
}

/** Estado de la última sincronización autónoma por proveedor. */
export interface Sync {
  readonly provider: string;
  readonly ok: boolean | null;
  readonly at: string | null;
  readonly estado?: 'OK' | 'PARCIAL' | 'FALLO' | null; // observabilidad fina (opcional; compat hacia atrás)
}

export interface PanelCampaign {
  readonly name: string | null;
  readonly status: string | null;
  readonly id: string | null;
}

/** Período REAL del acumulado de anuncios. El snapshot Google Ads es all-time (sin filtro de fecha): el `from`
 *  es el inicio de la campaña y el `to` es el instante de captura (as-of). Nunca se infiere desde capturedAt. */
export interface PeriodoAds {
  readonly kind: 'ALL_TIME';
  readonly from: string | null; // campaign.start_date (si el snapshot lo persistió); null en snapshots viejos
  readonly to: string | null; // as-of = capturedAt
}
export interface PanelAds {
  readonly source: 'GOOGLE_ADS';
  readonly impressions: number | null;
  readonly clicks: number | null;
  readonly cost: number | null;
  readonly ctr: number | null; // clicks/impressions — null si impressions no > 0 (nunca 0 por defecto)
  readonly cpc: number | null; // cost/clicks — null si clicks no > 0 (nunca 0 por defecto)
  readonly sinDatos: boolean;
  readonly capturedAt: string | null; // occurred_at del ads.snapshot (as-of real). null si no hay snapshot
  readonly period: PeriodoAds | null; // null si no hay snapshot
  readonly stale: boolean; // capturedAt más viejo que el umbral (dato antiguo, no actual)
}

export interface PanelFunnelCounts {
  readonly demo_cta_clicked: number;
  readonly demo_form_started: number;
  readonly demo_requested: number;
  readonly lead_created: number;
}

export interface PanelGrowthFunnel {
  readonly comercial: PanelFunnelCounts; // eventos que SÍ aprenden (diagnostico=false)
  readonly diagnostico: PanelFunnelCounts; // eventos TEST/DIAG: NO entran en los totales comerciales
}

export interface PanelSearchTerm {
  readonly termino: string;
  readonly impresiones: number;
  readonly clics: number;
}

export interface PanelAtribucion {
  readonly demosAtribuiblesAds: null;
  readonly costePorDemo: null;
  readonly estado: 'PENDIENTE';
}

export interface PanelResultados {
  readonly campaign: PanelCampaign;
  readonly ads: PanelAds;
  readonly growthFunnel: PanelGrowthFunnel;
  readonly searchTerms: readonly PanelSearchTerm[];
  readonly atribucion: PanelAtribucion;
  readonly sincronizaciones: readonly Sync[];
  readonly lecturaSoec: string;
  readonly modo: 'OBSERVE_ONLY';
}

const GOOGLE_ADS = 'google-ads';
const GROWTH = 'smileflow-growth';
const EVENTOS_FUNNEL = ['demo_cta_clicked', 'demo_form_started', 'demo_requested', 'lead_created'] as const;
const MUESTRA_MINIMA = 100; // impresiones mínimas para siquiera hablar de tendencia (umbral conservador)

function contarFunnel(obs: readonly ObsPanel[]): PanelFunnelCounts {
  const c: Record<(typeof EVENTOS_FUNNEL)[number], number> = {
    demo_cta_clicked: 0, demo_form_started: 0, demo_requested: 0, lead_created: 0,
  };
  for (const o of obs) {
    if ((EVENTOS_FUNNEL as readonly string[]).includes(o.eventName)) {
      c[o.eventName as (typeof EVENTOS_FUNNEL)[number]] += 1;
    }
  }
  return c;
}

/**
 * Construye el panel. `snapshotActual` = último snapshot acumulado (stream dedicado last-wins); provee la
 * cabecera de campaña y las cifras Ads vigentes (frescas cada sync). `obs` aporta términos y embudo Growth.
 */
/** Umbral de obsolescencia del acumulado Google Ads: más viejo que esto ⇒ STALE (dato antiguo, no actual). */
export const ADS_STALE_MS = 24 * 3600_000;

export function construirPanel(
  obs: readonly ObsPanel[],
  syncs: readonly Sync[],
  snapshotActual: SnapshotAdsActual | null,
  ahoraISO: string = new Date().toISOString(),
): PanelResultados {
  const ads = obs.filter((o) => o.provider === GOOGLE_ADS);
  const growth = obs.filter((o) => o.provider === GROWTH);

  // Cabecera de campaña: del snapshot acumulado vigente. null si aún no hay snapshot.
  const campaign: PanelCampaign = snapshotActual
    ? { name: snapshotActual.campaignName, status: snapshotActual.status, id: snapshotActual.campaignId }
    : { name: null, status: null, id: null };

  // Métricas Ads: acumulado vigente del snapshot. ctr/cpc se DERIVAN (null si denominador 0 ⇒ NO_CALCULABLE).
  const impressions = snapshotActual?.impressions ?? null;
  const clicks = snapshotActual?.clicks ?? null;
  const cost = snapshotActual?.cost ?? null;
  const ctr = impressions !== null && impressions > 0 && clicks !== null ? clicks / impressions : null;
  const cpc = clicks !== null && clicks > 0 && cost !== null ? cost / clicks : null;
  const sinDatos = (impressions ?? 0) === 0 && (clicks ?? 0) === 0 && (cost ?? 0) === 0;
  // Trazabilidad real: capturedAt = as-of del snapshot; período ALL_TIME (from=inicio campaña, to=capturedAt).
  // NO se inventa rango ni capturedAt si no hay snapshot. STALE si el acumulado es más viejo que el umbral.
  const capturedAt = snapshotActual?.at ?? null;
  const period: PeriodoAds | null = snapshotActual ? { kind: 'ALL_TIME', from: snapshotActual.startDate ?? null, to: snapshotActual.at } : null;
  const stale = capturedAt !== null && Date.parse(ahoraISO) - Date.parse(capturedAt) > ADS_STALE_MS;
  const adsPanel: PanelAds = { source: 'GOOGLE_ADS', impressions, clicks, cost, ctr, cpc, sinDatos, capturedAt, period, stale };

  // Embudo Growth: conteos por eventName, separando comercial (aprende) de diagnóstico (no aprende).
  const growthFunnel: PanelGrowthFunnel = {
    comercial: contarFunnel(growth.filter((o) => !o.diagnostico)),
    diagnostico: contarFunnel(growth.filter((o) => o.diagnostico)),
  };

  // Términos de búsqueda REALES: agregación por utmContent (sin términos ⇒ []).
  const terminosMap = new Map<string, { impresiones: number; clics: number }>();
  for (const o of ads) {
    if (o.eventName !== 'ads_search_term') continue;
    const termino = o.utmContent;
    if (!termino) continue;
    const acc = terminosMap.get(termino) ?? { impresiones: 0, clics: 0 };
    if (o.metrica === 'search_term_impressions') acc.impresiones += o.valor ?? 0;
    else if (o.metrica === 'search_term_clicks') acc.clics += o.valor ?? 0;
    terminosMap.set(termino, acc);
  }
  const searchTerms: PanelSearchTerm[] = [...terminosMap.entries()]
    .map(([termino, v]) => ({ termino, impresiones: v.impresiones, clics: v.clics }))
    .sort((a, b) => b.impresiones - a.impresiones || a.termino.localeCompare(b.termino));

  // Atribución pagada: NO se calcula (no unimos Ads↔Growth ni inferimos origen de las demos).
  const atribucion: PanelAtribucion = { demosAtribuiblesAds: null, costePorDemo: null, estado: 'PENDIENTE' };

  // Lectura de SOEC: SÓLO sobre evidencia. Sin datos ⇒ afirma el hecho, no recomienda.
  let lecturaSoec: string;
  if (impressions === null || impressions === 0) {
    lecturaSoec = 'Todavía no hay suficientes datos reales para evaluar el rendimiento. La campaña registra 0 impresiones.';
  } else if (impressions < MUESTRA_MINIMA) {
    const plural = impressions === 1 ? 'impresión' : 'impresiones';
    lecturaSoec = `La campaña registra ${impressions} ${plural} reales: muestra insuficiente para evaluar el rendimiento con confianza. SOEC afirma el hecho observado y no emite recomendación.`;
  } else {
    lecturaSoec = `La campaña registra ${impressions} impresiones reales. SOEC reporta los datos observados sin fabricar una recomendación; la evaluación de rendimiento requiere análisis explícito.`;
  }

  return { campaign, ads: adsPanel, growthFunnel, searchTerms, atribucion, sincronizaciones: syncs, lecturaSoec, modo: 'OBSERVE_ONLY' };
}
