/**
 * apps/api · autonomia-ads · LECTOR de EVIDENCIA GOOGLE (READ-ONLY, fail-soft por consulta) para el Director.
 *
 * Consulta por campaña+ventana las dimensiones que el diagnóstico necesita y que hoy no se ingerían:
 *   KEYWORD (ad_group_criterion vía keyword_view), DEVICE, GEO (geographic_view), NETWORK (segments.ad_network_type).
 * SEPARA keyword de search term. Cada consulta es independiente y fail-soft: si Google la rechaza (p.ej. 400 por
 * campo no soportado en la versión), esa dimensión queda vacía ⇒ el motor la trata como UNKNOWN (no se inventa).
 * NINGÚN write: sólo GAQL searchStream filtrado por campaign.id.
 */
import type { KeywordSpend, DimRow } from './director-postmortem';

const n = (v: unknown): number => Number(v ?? 0);
const clp = (m: unknown): number => n(m) / 1_000_000;

export interface EvidenciaGoogle {
  readonly keywords: readonly KeywordSpend[];
  readonly devices: readonly DimRow[];
  readonly geos: readonly DimRow[];
  readonly networks: readonly DimRow[];
}

type Buscar = (customerId: string, query: string) => Promise<Array<Record<string, unknown>>>;

export function construirLectorEvidenciaGoogle(buscar: Buscar): (customerId: string, campaignId: string, ventana: { readonly desde: string; readonly hasta: string }) => Promise<EvidenciaGoogle> {
  return async (customerId, campaignId, ventana) => {
    const wc = `campaign.id = ${campaignId} AND segments.date BETWEEN '${ventana.desde}' AND '${ventana.hasta}'`;
    let keywords: KeywordSpend[] = []; let devices: DimRow[] = []; let geos: DimRow[] = []; let networks: DimRow[] = [];

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

    return { keywords, devices, geos, networks };
  };
}
