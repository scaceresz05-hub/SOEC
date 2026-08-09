/**
 * apps/api · CAPA DE COMPOSICIÓN · Mapeo PURO respuesta Google Ads (searchStream) → EntradaObservacionReal.
 *
 * Funciones deterministas, sin efectos, sin PII: los datos de Google Ads no transportan datos personales
 * (métricas agregadas por campaña/día y términos de búsqueda anónimos). No se agrega nada personal.
 *
 * IDEMPOTENCIA / SNAPSHOT: el `externalEventId` de cada observación se deriva de (entidad, día, métrica). Como
 * `registrarReal` es first-wins (idempotente por observacionId), para el día EN CURSO el valor persistido es el
 * PRIMER snapshot observado ese día; los días ya finalizados son exactos. No se inventa actividad: si una
 * métrica no viene en la fila, no se genera observación para ella.
 *
 * READ ONLY: este módulo sólo LEE y clasifica; nunca produce negativas ni mutaciones.
 */
import { createHash } from 'node:crypto';
import type { EntradaObservacionReal } from '@soec/motor-medicion';
import type { NivelCalidad } from '@soec/medicion';

/** Calidad de la evidencia de ingesta real (valor válido de NivelCalidad). */
const CALIDAD_INGESTA: NivelCalidad = 'alta';
const PROVIDER = 'google-ads';

// ─────────────────────────────────────────────────────────────────────────────
// Consultas GAQL (sólo lectura)
// ─────────────────────────────────────────────────────────────────────────────
export const GAQL_CAMPANIAS =
  'SELECT campaign.id, campaign.name, campaign.status, segments.date, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.average_cpc, metrics.ctr FROM campaign WHERE segments.date DURING LAST_7_DAYS';

export const GAQL_TERMINOS =
  'SELECT search_term_view.search_term, campaign.id, segments.date, metrics.impressions, metrics.clicks, metrics.cost_micros FROM search_term_view WHERE segments.date DURING LAST_7_DAYS';

/**
 * Snapshot ACUMULADO de campaña (sin filtro de fecha): devuelve la campaña y sus métricas totales aunque no
 * haya actividad diaria. Permite observar el hecho real "la campaña existe, está ENABLED y aún no sirve
 * (0 impresiones)" cuando la consulta diaria no devuelve filas. NO fabrica actividad: si el valor es 0, es 0.
 */
export const GAQL_CAMPANIA_SNAPSHOT =
  'SELECT campaign.id, campaign.name, campaign.status, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.average_cpc, metrics.ctr FROM campaign';

// ─────────────────────────────────────────────────────────────────────────────
// Parseo del searchStream (array de batches → results)
// ─────────────────────────────────────────────────────────────────────────────
type FilaGoogleAds = Record<string, unknown>;
interface BatchSearchStream {
  readonly results?: readonly FilaGoogleAds[];
}

/** Aplana la respuesta searchStream (array de batches) a la lista de filas de resultado. Tolera vacío. */
export function parsearSearchStream(body: string): FilaGoogleAds[] {
  const trimmed = (body ?? '').trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed) as unknown;
  const batches: readonly BatchSearchStream[] = Array.isArray(parsed) ? (parsed as BatchSearchStream[]) : [parsed as BatchSearchStream];
  const filas: FilaGoogleAds[] = [];
  for (const batch of batches) {
    for (const r of batch?.results ?? []) filas.push(r);
  }
  return filas;
}

// ─────────────────────────────────────────────────────────────────────────────
// Accesores tolerantes (Google Ads REST devuelve enteros int64 como strings)
// ─────────────────────────────────────────────────────────────────────────────
function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}
function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Métricas de campaña: nombre lógico → (unidad, valor derivado desde la fila). */
interface MetricaSpec {
  readonly metric: string;
  readonly unidad: EntradaObservacionReal['unidad'];
  readonly valor: (m: Record<string, unknown>) => number | null;
}

const METRICAS_CAMPANIA: readonly MetricaSpec[] = [
  { metric: 'impressions', unidad: 'conteo', valor: (m) => num(m.impressions) },
  { metric: 'clicks', unidad: 'conteo', valor: (m) => num(m.clicks) },
  { metric: 'cost', unidad: 'monetario', valor: (m) => { const c = num(m.costMicros); return c === null ? null : c / 1e6; } },
  { metric: 'cpc', unidad: 'monetario', valor: (m) => { const c = num(m.averageCpc); return c === null ? null : c / 1e6; } },
  { metric: 'ctr', unidad: 'ratio', valor: (m) => num(m.ctr) },
];

/**
 * Mapea filas de la consulta de CAMPAÑA a observaciones REAL, una por (campaña, día, métrica).
 * externalEventId = `google-ads:campaign:<campaignId>:<date>:<metric>` (idempotente).
 */
export function mapearCampania(rows: readonly FilaGoogleAds[]): EntradaObservacionReal[] {
  const salida: EntradaObservacionReal[] = [];
  for (const row of rows) {
    const campaign = obj(row.campaign);
    const segments = obj(row.segments);
    const metrics = obj(row.metrics);
    const campaignId = str(campaign.id);
    const date = str(segments.date);
    if (!campaignId || !date) continue;
    const campaignName = str(campaign.name);
    for (const spec of METRICAS_CAMPANIA) {
      const valor = spec.valor(metrics);
      if (valor === null) continue; // ausencia ⇒ no se inventa actividad
      const externalEventId = `${PROVIDER}:campaign:${campaignId}:${date}:${spec.metric}`;
      salida.push({
        provider: PROVIDER,
        externalEventId,
        eventName: `ads_metric:${spec.metric}`,
        occurredAt: `${date}T00:00:00Z`,
        kpiId: spec.metric,
        metrica: spec.metric,
        valor,
        unidad: spec.unidad,
        calidad: CALIDAD_INGESTA,
        cobertura: 1,
        source: PROVIDER,
        utmCampaign: campaignName,
        diagnostico: false,
      });
    }
  }
  return salida;
}

/**
 * Mapea el snapshot ACUMULADO de campaña a observaciones REAL, una por métrica, fechadas con `fechaSync`
 * (YYYY-MM-DD del momento de ingesta). externalEventId = `google-ads:campaign:<id>:snapshot:<fechaSync>:<metric>`
 * ⇒ idempotente por día (un snapshot por día). Registra el estado real aunque sea 0 (no inventa actividad).
 */
export function mapearCampaniaSnapshot(rows: readonly FilaGoogleAds[], fechaSync: string): EntradaObservacionReal[] {
  const salida: EntradaObservacionReal[] = [];
  for (const row of rows) {
    const campaign = obj(row.campaign);
    const metrics = obj(row.metrics);
    const campaignId = str(campaign.id);
    if (!campaignId) continue;
    const campaignName = str(campaign.name);
    const status = str(campaign.status);
    for (const spec of METRICAS_CAMPANIA) {
      const valor = spec.valor(metrics);
      if (valor === null) continue; // métrica ausente en la fila ⇒ no se genera (no se inventa)
      salida.push({
        provider: PROVIDER,
        externalEventId: `${PROVIDER}:campaign:${campaignId}:snapshot:${fechaSync}:${spec.metric}`,
        eventName: `ads_campaign_snapshot:${spec.metric}`,
        occurredAt: `${fechaSync}T00:00:00Z`,
        kpiId: spec.metric,
        metrica: spec.metric,
        valor,
        unidad: spec.unidad,
        calidad: CALIDAD_INGESTA,
        cobertura: 1,
        source: PROVIDER,
        utmCampaign: campaignName,
        diagnostico: false,
        limitaciones: status ? [`campaign_status=${status}`] : [],
      });
    }
  }
  return salida;
}

/** sha1 corto (12 hex) de un texto — determinista, sin PII (un término de búsqueda no es dato personal). */
export function sha1corto(texto: string): string {
  return createHash('sha1').update(texto).digest('hex').slice(0, 12);
}

/** Métricas de término de búsqueda: (nombre lógico, extractor). */
const METRICAS_TERMINO: readonly { metric: string; valor: (m: Record<string, unknown>) => number | null }[] = [
  { metric: 'search_term_clicks', valor: (m) => num(m.clicks) },
  { metric: 'search_term_impressions', valor: (m) => num(m.impressions) },
];

/**
 * Mapea filas de la consulta de TÉRMINOS DE BÚSQUEDA a observaciones REAL, una por (término, campaña, día, métrica).
 * El término real (no PII) se guarda en `utmContent`. externalEventId usa el sha1 corto del término.
 */
export function mapearTerminos(rows: readonly FilaGoogleAds[]): EntradaObservacionReal[] {
  const salida: EntradaObservacionReal[] = [];
  for (const row of rows) {
    const stv = obj(row.searchTermView);
    const campaign = obj(row.campaign);
    const segments = obj(row.segments);
    const metrics = obj(row.metrics);
    const term = str(stv.searchTerm);
    const campaignId = str(campaign.id);
    const date = str(segments.date);
    if (!term || !campaignId || !date) continue;
    const hash = sha1corto(term);
    for (const spec of METRICAS_TERMINO) {
      const valor = spec.valor(metrics);
      if (valor === null) continue;
      const externalEventId = `${PROVIDER}:searchterm:${hash}:${campaignId}:${date}:${spec.metric}`;
      salida.push({
        provider: PROVIDER,
        externalEventId,
        eventName: 'ads_search_term',
        occurredAt: `${date}T00:00:00Z`,
        kpiId: spec.metric,
        metrica: spec.metric,
        valor,
        unidad: 'conteo',
        calidad: CALIDAD_INGESTA,
        cobertura: 1,
        source: PROVIDER,
        utmCampaign: str(campaign.name),
        utmContent: term, // término de búsqueda (no PII)
        diagnostico: false,
      });
    }
  }
  return salida;
}

// ─────────────────────────────────────────────────────────────────────────────
// Clasificación de términos (pura, sin generar negativas)
// ─────────────────────────────────────────────────────────────────────────────
export type ClasificacionTermino = 'RELEVANTE' | 'POSIBLEMENTE_RELEVANTE' | 'IRRELEVANTE' | 'NO_EVALUABLE';

/** Muestra mínima de impresiones bajo la cual no hay evidencia suficiente para clasificar. */
const MUESTRA_MINIMA_IMPRESIONES = 5;

/**
 * Heurística simple de pertinencia de un término. Con muestra insuficiente ⇒ NO_EVALUABLE (la ausencia de
 * información nunca es una conclusión). NO produce negativas: sólo etiqueta para lectura humana.
 */
export function clasificarTermino(_term: string, clicks: number, impressions: number): ClasificacionTermino {
  if (!Number.isFinite(impressions) || impressions < MUESTRA_MINIMA_IMPRESIONES) return 'NO_EVALUABLE';
  const ctr = impressions > 0 ? clicks / impressions : 0;
  if (ctr >= 0.05) return 'RELEVANTE';
  if (clicks > 0) return 'POSIBLEMENTE_RELEVANTE';
  return 'IRRELEVANTE';
}

/** Fecha (YYYY-MM-DD) máxima presente en un conjunto de filas parseadas; null si no hay ninguna. */
export function fechaMaxima(rows: readonly FilaGoogleAds[]): string | null {
  let max: string | null = null;
  for (const row of rows) {
    const date = str(obj(row.segments).date);
    if (date && (max === null || date > max)) max = date;
  }
  return max;
}
