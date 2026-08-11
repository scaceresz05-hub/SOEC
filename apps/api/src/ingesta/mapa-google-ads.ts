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
// Ventana temporal de ingesta (DEBE incluir HOY)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Zona horaria de la CUENTA de Google Ads (cliente en Chile). `segments.date` en GAQL se evalúa en la zona de
 * la cuenta; por eso "hoy" se calcula en esta zona y no en UTC. Los presets `LAST_7_DAYS`/`YESTERDAY` EXCLUYEN
 * el día en curso, por lo que NO se usan: SOEC sincroniza cada 15 min y debe reflejar la actividad de hoy.
 */
export const TZ_CUENTA_ADS = 'America/Santiago';

/** Fecha (YYYY-MM-DD) del instante ISO `ahora` en la zona `timeZone`. Determinista (Intl, sin locale ambiguo). */
export function fechaLocal(ahoraISO: string, timeZone: string = TZ_CUENTA_ADS): string {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  return fmt.format(new Date(ahoraISO)); // en-CA ⇒ 'YYYY-MM-DD'
}

/** Resta `dias` a una fecha 'YYYY-MM-DD' de forma determinista (aritmética en UTC puro sobre la fecha civil). */
function restarDias(fecha: string, dias: number): string {
  const [y, m, d] = fecha.split('-').map(Number) as [number, number, number];
  const ms = Date.UTC(y, m - 1, d) - dias * 86_400_000;
  const dt = new Date(ms);
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${mm}-${dd}`;
}

/**
 * Ventana [desde, hasta] de `dias` días que INCLUYE hoy (hasta = hoy en la zona de la cuenta). Reemplaza al
 * preset `LAST_7_DAYS` (que excluye hoy). Determinista a partir del instante de sync inyectado.
 */
export function ventanaIngesta(ahoraISO: string, dias = 7, timeZone: string = TZ_CUENTA_ADS): { desde: string; hasta: string } {
  const hasta = fechaLocal(ahoraISO, timeZone);
  return { desde: restarDias(hasta, dias - 1), hasta };
}

// ─────────────────────────────────────────────────────────────────────────────
// Consultas GAQL (sólo lectura). Ventana explícita [desde, hasta] que incluye hoy.
// ─────────────────────────────────────────────────────────────────────────────
export function gaqlCampanias(desde: string, hasta: string): string {
  return `SELECT campaign.id, campaign.name, campaign.status, segments.date, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.average_cpc, metrics.ctr FROM campaign WHERE segments.date BETWEEN '${desde}' AND '${hasta}'`;
}

export function gaqlTerminos(desde: string, hasta: string): string {
  return `SELECT search_term_view.search_term, campaign.id, segments.date, metrics.impressions, metrics.clicks, metrics.cost_micros FROM search_term_view WHERE segments.date BETWEEN '${desde}' AND '${hasta}'`;
}

/**
 * Snapshot ACUMULADO de campaña (sin filtro de fecha): devuelve la campaña y sus métricas totales (all-time)
 * aunque no haya actividad diaria. Permite observar el hecho real "la campaña existe, está ENABLED y aún no
 * sirve (0 impresiones)" y, ya sirviendo, el acumulado vigente. NO fabrica actividad: si el valor es 0, es 0.
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
 * Snapshot ACUMULADO ACTUAL de la campaña (all-time), extraído de la fila del snapshot. A diferencia de las
 * observaciones (first-wins, inmutables), el snapshot vigente se persiste en un stream dedicado LAST-WINS para
 * que el panel refleje el acumulado más reciente en cada sync (cada 15 min), sin congelar el valor del día.
 * `ctr`/`cpc` NO se transportan: se derivan aguas abajo respetando la semántica NO_CALCULABLE (denominador 0).
 */
export interface SnapshotAdsActual {
  readonly campaignId: string;
  readonly campaignName: string | null;
  readonly status: string | null;
  readonly impressions: number | null;
  readonly clicks: number | null;
  readonly cost: number | null;
  readonly at: string; // instante de sync (ISO) — orden last-wins
}

/** Extrae el snapshot acumulado de la 1ª fila (la consulta snapshot devuelve la campaña). null si no hay id. */
export function extraerSnapshotActual(rows: readonly FilaGoogleAds[], at: string): SnapshotAdsActual | null {
  const row = rows[0];
  if (!row) return null;
  const campaign = obj(row.campaign);
  const metrics = obj(row.metrics);
  const campaignId = str(campaign.id);
  if (!campaignId) return null;
  const costMicros = num(metrics.costMicros);
  return {
    campaignId,
    campaignName: str(campaign.name),
    status: str(campaign.status),
    impressions: num(metrics.impressions),
    clicks: num(metrics.clicks),
    cost: costMicros === null ? null : costMicros / 1e6,
    at,
  };
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
