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
import { eventosDelEmbudo, type EmbudoDeConversion } from '../plataforma/tipos';

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

/**
 * Conteos del embudo, por nombre de evento. Las claves son LAS DEL EMBUDO DE LA ORGANIZACIÓN, no una
 * lista universal: `demo_requested` pertenece a SmileFlow, no a SOEC. Todos los eventos del embudo
 * aparecen siempre (con 0 si no hubo ninguno): la ausencia de evento es 0 observado, no dato faltante.
 */
export type PanelFunnelCounts = Readonly<Record<string, number>>;

export interface PanelGrowthFunnel {
  /** Provider de la fuente Growth de la organización. `null` ⇒ la organización no declara ninguna. */
  readonly provider: string | null;
  /** Definición del embudo de ESTA organización (orden declarado, primaria primero). */
  readonly eventos: readonly string[];
  readonly conversionPrimaria: string;
  readonly comercial: PanelFunnelCounts; // eventos que SÍ aprenden (diagnostico=false)
  readonly diagnostico: PanelFunnelCounts; // eventos TEST/DIAG: NO entran en los totales comerciales
}

/**
 * Configuración de la organización que el panel NECESITA y no puede suponer. Es un parámetro obligatorio
 * a propósito: un valor por defecto sería el embudo de SmileFlow aplicado a todo el mundo, que es
 * exactamente el acoplamiento que este módulo deja de tener.
 */
export interface ConfiguracionPanel {
  /** Provider de la fuente GROWTH de la organización. `null` ⇒ no hay eventos Growth que contar. */
  readonly growthProvider: string | null;
  /** Embudo declarado (o derivado del perfil) de ESTA organización. */
  readonly embudo: EmbudoDeConversion;
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
const MUESTRA_MINIMA = 100; // impresiones mínimas para siquiera hablar de tendencia (umbral conservador)

/**
 * Cuenta los eventos del embudo DE LA ORGANIZACIÓN. Los eventos fuera del embudo no se cuentan.
 *
 * Se acumula sobre un `Map`, no sobre un objeto: `eventName` llega del puente M2M externo, y un objeto
 * literal heredaría `toString`, `constructor`, `valueOf`… de `Object.prototype`, de modo que un evento
 * con ese nombre pasaría la comprobación de pertenencia y contaminaría la respuesta del panel con claves
 * y valores que no son del embudo. El `Map` sólo contiene lo que el embudo declara.
 */
function contarFunnel(obs: readonly ObsPanel[], eventos: readonly string[]): PanelFunnelCounts {
  const c = new Map<string, number>();
  for (const e of eventos) c.set(e, 0); // 0 explícito: el embudo declara sus casillas, aunque estén vacías
  for (const o of obs) {
    const actual = c.get(o.eventName);
    if (actual !== undefined) c.set(o.eventName, actual + 1);
  }
  return Object.fromEntries(c);
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
  config: ConfiguracionPanel,
  ahoraISO: string = new Date().toISOString(),
): PanelResultados {
  const ads = obs.filter((o) => o.provider === GOOGLE_ADS);
  // Sólo cuentan los eventos de LA fuente Growth de esta organización. Sin provider declarado no se
  // cuenta nada: jamás se atribuyen a una organización los eventos de otra.
  const growth =
    config.growthProvider === null ? [] : obs.filter((o) => o.provider === config.growthProvider);
  const eventosFunnel = eventosDelEmbudo(config.embudo);

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

  // Embudo Growth: conteos por eventName del embudo DE ESTA ORGANIZACIÓN, separando comercial
  // (aprende) de diagnóstico (no aprende).
  const growthFunnel: PanelGrowthFunnel = {
    provider: config.growthProvider,
    eventos: eventosFunnel,
    conversionPrimaria: config.embudo.conversionPrimaria,
    comercial: contarFunnel(growth.filter((o) => !o.diagnostico), eventosFunnel),
    diagnostico: contarFunnel(growth.filter((o) => o.diagnostico), eventosFunnel),
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
