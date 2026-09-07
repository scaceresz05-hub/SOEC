/**
 * apps/api · autonomia-ads · LECTOR de EVIDENCIA GOOGLE (READ-ONLY, fail-soft por consulta) para el Director.
 *
 * Consulta por campaña+ventana las dimensiones que el diagnóstico necesita y que hoy no se ingerían:
 *   KEYWORD (ad_group_criterion vía keyword_view), DEVICE, GEO (geographic_view), NETWORK (segments.ad_network_type).
 * SEPARA keyword de search term. Cada consulta es independiente y fail-soft: si Google la rechaza (p.ej. 400 por
 * campo no soportado en la versión), esa dimensión queda vacía ⇒ el motor la trata como UNKNOWN (no se inventa).
 * NINGÚN write: sólo GAQL searchStream filtrado por campaign.id.
 */
import type { KeywordSpend, DimRow, TermSpend } from './director-postmortem';

const n = (v: unknown): number => Number(v ?? 0);
const clp = (m: unknown): number => n(m) / 1_000_000;

export interface EvidenciaGoogle {
  readonly keywords: readonly KeywordSpend[];
  readonly searchTerms: readonly TermSpend[];   // search_term_view CON gasto real (privacidad respetada)
  readonly devices: readonly DimRow[];
  readonly geos: readonly DimRow[];
  readonly networks: readonly DimRow[];
}

/** Cambio de estrategia de puja detectado en el historial de cambios de Google (durable, read-only). */
export interface CambioBidding { readonly at: string; readonly biddingStrategy: string | null }

type Buscar = (customerId: string, query: string) => Promise<Array<Record<string, unknown>>>;

/**
 * Punto(s) de cambio de estrategia de puja desde `change_event` (change history, READ-ONLY, fail-soft). Sólo cambios
 * a nivel CAMPAIGN cuyo changed_fields toca la estrategia de puja. Devuelve datetimes reales (no hardcodeados);
 * si Google no expone el cambio ⇒ [] (el caller marca la fase como UNKNOWN, sin mezclar toda la campaña).
 */
export function construirLectorCambiosBidding(buscar: Buscar): (customerId: string, campaignId: string, ventanaDias: number) => Promise<CambioBidding[]> {
  return async (customerId, campaignId, ventanaDias) => {
    // change_event sólo retiene ~30 días; el enum DURING LAST_30_DAYS toca ese borde y Google lo rechaza (400).
    // Usamos bounds de datetime EXPLÍCITOS (probado en prod: devuelve el historial) capando la ventana a 29 días.
    const dias = Math.min(Math.max(Math.floor(ventanaDias), 1), 29);
    const desde = new Date(Date.now() - dias * 86_400_000).toISOString().slice(0, 10);
    const hasta = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    try {
      const rows = await buscar(customerId, `SELECT change_event.change_date_time, change_event.changed_fields, change_event.change_resource_type, change_event.new_resource FROM change_event WHERE change_event.change_date_time >= '${desde} 00:00:00' AND change_event.change_date_time <= '${hasta} 00:00:00' AND change_event.campaign = 'customers/${customerId}/campaigns/${campaignId}' ORDER BY change_event.change_date_time DESC LIMIT 200`);
      const out: CambioBidding[] = [];
      for (const r of rows) {
        const ce = (r as { changeEvent?: { changeDateTime?: string; changedFields?: string; newResource?: { campaign?: { biddingStrategyType?: string; targetSpend?: unknown; maximizeConversions?: unknown } } } }).changeEvent;
        if (!ce?.changeDateTime) continue;
        const campos = String(ce.changedFields ?? '');
        // SÓLO cambios de estrategia de puja (no status/pausa): el changed_fields debe mencionar la puja.
        // Google devuelve el field mask en camelCase por REST (p.ej. "targetSpend.cpcBidCeilingMicros"); normalizamos
        // (sin guiones bajos, minúsculas) para reconocerlo tanto en camelCase como en snake_case.
        const norm = campos.replace(/_/g, '').toLowerCase();
        const tocaPuja = /biddingstrategy|targetspend|maximizeconversions|maximizeclicks|targetcpa|targetroas|targetcpm|manualcpc|cpcbidceiling|targetimpressionshare|percentcpc|commission/.test(norm);
        if (!tocaPuja) continue;
        out.push({ at: ce.changeDateTime, biddingStrategy: ce.newResource?.campaign?.biddingStrategyType ?? null });
      }
      return out.slice(0, 20);
    } catch { return []; }
  };
}

export function construirLectorEvidenciaGoogle(buscar: Buscar): (customerId: string, campaignId: string, ventana: { readonly desde: string; readonly hasta: string }) => Promise<EvidenciaGoogle> {
  return async (customerId, campaignId, ventana) => {
    const wc = `campaign.id = ${campaignId} AND segments.date BETWEEN '${ventana.desde}' AND '${ventana.hasta}'`;
    let keywords: KeywordSpend[] = []; let searchTerms: TermSpend[] = []; let devices: DimRow[] = []; let geos: DimRow[] = []; let networks: DimRow[] = [];

    // SEARCH TERMS (lo tecleado) CON gasto real, directo del proveedor para ESTA ventana. Respeta la privacidad de
    // Google: sólo devuelve términos divulgados (los ocultos no aparecen ⇒ el caller los contabiliza como no divulgados).
    try {
      const rows = await buscar(customerId, `SELECT search_term_view.search_term, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM search_term_view WHERE ${wc}`);
      const agg = new Map<string, { impresiones: number; clics: number; gasto: number }>();
      for (const r of rows) {
        const term = (r as { searchTermView?: { searchTerm?: string } }).searchTermView?.searchTerm ?? '';
        if (!term) continue;
        const mm = (r as { metrics?: Record<string, unknown> }).metrics ?? {};
        const acc = agg.get(term) ?? { impresiones: 0, clics: 0, gasto: 0 };
        acc.impresiones += n(mm.impressions); acc.clics += n(mm.clicks); acc.gasto += clp(mm.costMicros);
        agg.set(term, acc);
      }
      searchTerms = [...agg.entries()].map(([termino, v]) => ({ termino, impresiones: v.impresiones, clics: v.clics, gasto: v.gasto }));
    } catch { /* fail-soft ⇒ sin términos visibles del proveedor (el gasto queda no divulgado) */ }

    // KEYWORD (lo pujado): keyword_view expone el criterio de keyword con métricas. Fail-soft.
    try {
      const rows = await buscar(customerId, `SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM keyword_view WHERE ${wc}`);
      const agg = new Map<string, { matchType: string | null; impresiones: number; clics: number; gasto: number; conversions: number }>();
      for (const r of rows) {
        const kw = (r as { adGroupCriterion?: { keyword?: { text?: string; matchType?: string } } }).adGroupCriterion?.keyword;
        const mm = (r as { metrics?: Record<string, unknown> }).metrics ?? {};
        const key = kw?.text ?? ''; if (!key) continue;
        const acc = agg.get(key) ?? { matchType: kw?.matchType ?? null, impresiones: 0, clics: 0, gasto: 0, conversions: 0 };
        acc.impresiones += n(mm.impressions); acc.clics += n(mm.clicks); acc.gasto += clp(mm.costMicros); acc.conversions += n(mm.conversions);
        agg.set(key, acc);
      }
      keywords = [...agg.entries()].map(([keyword, v]) => ({ keyword, matchType: v.matchType, impresiones: v.impresiones, clics: v.clics, gasto: v.gasto, conversions: v.conversions }));
    } catch { /* fail-soft ⇒ keywords vacío (UNKNOWN) */ }

    const dim = async (gaql: string, clave: (r: Record<string, unknown>) => string): Promise<DimRow[]> => {
      const rows = await buscar(customerId, gaql);
      const agg = new Map<string, { impresiones: number; clics: number; gasto: number; conversions: number }>();
      for (const r of rows) {
        const mm = (r as { metrics?: Record<string, unknown> }).metrics ?? {};
        const k = clave(r) || '—';
        const acc = agg.get(k) ?? { impresiones: 0, clics: 0, gasto: 0, conversions: 0 };
        acc.impresiones += n(mm.impressions); acc.clics += n(mm.clicks); acc.gasto += clp(mm.costMicros); acc.conversions += n(mm.conversions);
        agg.set(k, acc);
      }
      return [...agg.entries()].map(([clave2, v]) => ({ clave: clave2, impresiones: v.impresiones, clics: v.clics, gasto: v.gasto, conversions: v.conversions }));
    };

    try { devices = await dim(`SELECT segments.device, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM campaign WHERE ${wc}`, (r) => String((r as { segments?: { device?: unknown } }).segments?.device ?? '')); } catch { /* fail-soft */ }
    try { networks = await dim(`SELECT segments.ad_network_type, metrics.impressions, metrics.clicks, metrics.cost_micros FROM campaign WHERE ${wc}`, (r) => String((r as { segments?: { adNetworkType?: unknown } }).segments?.adNetworkType ?? '')); } catch { /* fail-soft */ }
    try { geos = await dim(`SELECT geographic_view.country_criterion_id, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM geographic_view WHERE ${wc}`, (r) => `geo:${String((r as { geographicView?: { countryCriterionId?: unknown } }).geographicView?.countryCriterionId ?? '')}`); } catch { /* fail-soft */ }

    return { keywords, searchTerms, devices, geos, networks };
  };
}
