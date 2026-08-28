/**
 * apps/api · campana · RECUPERACIÓN READ-ONLY de PROVIDER BINDINGS (PURO en la correlación). Tras un mutate real
 * exitoso cuya evidencia durable NO retuvo los resource names, se recuperan LEYENDO Google Ads (GAQL searchStream,
 * READ ONLY) los recursos REALES creados bajo una campaña, se VERIFICA su huella contra el plan y se CORRELACIONAN
 * biyectivamente con las 61 operaciones. Reglas FAIL-CLOSED: huella incorrecta, faltantes, sobrantes o ambigüedad ⇒
 * NO se persiste NADA (nunca parcial, nunca IDs fabricados). NUNCA escribe en Google.
 */
import type { MarketingPlan } from './marketing-plan';
import type { GeoRegionResuelta } from './geo-policy';
import { fingerprint, type EntityType } from './material-fingerprint';
import type { ProviderResourceBinding } from './resource-binding';
import type { AuthorizedExecutionEnvelope } from './authorized-execution-envelope';

/** Consultas GAQL READ-ONLY ancladas a la campaña. Los campos verifican/correlacionan; ningún write. */
export function consultasRecuperacion(campaignId: string): Record<string, string> {
  const wc = `WHERE campaign.id = ${campaignId}`;
  return {
    campaign: `SELECT campaign.resource_name, campaign.name, campaign.advertising_channel_type, campaign.campaign_budget, campaign.status FROM campaign ${wc}`,
    campaignBudget: `SELECT campaign_budget.resource_name, campaign_budget.total_amount_micros, campaign_budget.period FROM campaign_budget ${wc}`,
    adGroup: `SELECT ad_group.resource_name, ad_group.name FROM ad_group ${wc}`,
    adGroupAd: `SELECT ad_group_ad.resource_name, ad_group_ad.ad.responsive_search_ad.headlines, ad_group.resource_name FROM ad_group_ad ${wc}`,
    adGroupCriterion: `SELECT ad_group_criterion.resource_name, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group.resource_name FROM ad_group_criterion ${wc} AND ad_group_criterion.type = KEYWORD`,
    campaignCriterion: `SELECT campaign_criterion.resource_name, campaign_criterion.negative, campaign_criterion.keyword.text, campaign_criterion.keyword.match_type, campaign_criterion.location.geo_target_constant FROM campaign_criterion ${wc}`,
  };
}

// Filas leídas (subset tipado de la respuesta GAQL, camelCase).
export interface RecursosLeidos {
  readonly campaign: ReadonlyArray<{ campaign?: { resourceName?: string; name?: string; advertisingChannelType?: string; campaignBudget?: string } }>;
  readonly campaignBudget: ReadonlyArray<{ campaignBudget?: { resourceName?: string; totalAmountMicros?: string | number } }>;
  readonly adGroup: ReadonlyArray<{ adGroup?: { resourceName?: string; name?: string } }>;
  readonly adGroupAd: ReadonlyArray<{ adGroupAd?: { resourceName?: string; ad?: { responsiveSearchAd?: { headlines?: Array<{ text?: string }> } } }; adGroup?: { resourceName?: string } }>;
  readonly adGroupCriterion: ReadonlyArray<{ adGroupCriterion?: { resourceName?: string; keyword?: { text?: string; matchType?: string } }; adGroup?: { resourceName?: string } }>;
  readonly campaignCriterion: ReadonlyArray<{ campaignCriterion?: { resourceName?: string; negative?: boolean; keyword?: { text?: string; matchType?: string }; location?: { geoTargetConstant?: string } } }>;
}

export interface ResultadoCorrelacion {
  readonly ok: boolean;
  readonly reason: string | null;
  readonly fingerprintOk: boolean;
  readonly expectedOperations: number;
  readonly recoveredResourceCount: number;
  readonly matchedOperationCount: number;
  readonly unmatchedOperationCount: number;
  readonly ambiguousOperationCount: number;
  readonly campaignResourceName: string | null;
  readonly bindings: readonly ProviderResourceBinding[]; // sólo si ok; jamás parcial
}

/** Emparejamiento BIYECTIVO por clave. Detecta faltantes, sobrantes, ambigüedad y claves duplicadas en expected. */
function emparejar<E, R>(expected: readonly E[], recovered: readonly R[], ke: (e: E) => string, kr: (r: R) => string): { pares: Array<{ e: E; r: R }>; faltantes: number; ambiguos: number; sobrantes: number } {
  const porClave = new Map<string, R[]>();
  for (const r of recovered) { const k = kr(r); const a = porClave.get(k) ?? []; a.push(r); porClave.set(k, a); }
  const pares: Array<{ e: E; r: R }> = [];
  const usados = new Set<R>();
  const vistas = new Set<string>();
  let faltantes = 0; let ambiguos = 0;
  for (const e of expected) {
    const k = ke(e);
    if (vistas.has(k)) { ambiguos += 1; continue; } // clave duplicada en expected ⇒ no biyectivo
    vistas.add(k);
    const cands = (porClave.get(k) ?? []).filter((r) => !usados.has(r));
    if (cands.length === 0) { faltantes += 1; continue; }
    if (cands.length > 1) { ambiguos += 1; continue; }
    usados.add(cands[0]!); pares.push({ e, r: cands[0]! });
  }
  return { pares, faltantes, ambiguos, sobrantes: recovered.filter((r) => !usados.has(r)).length };
}

const norm = (s: string | undefined): string => (s ?? '').trim().toLowerCase();
const headlinesKey = (hs: Array<{ text?: string }> | undefined): string => (hs ?? []).map((h) => norm(h.text)).sort().join('|');

function binding(org: string, env: AuthorizedExecutionEnvelope, entityType: EntityType, resourceName: string, ahora: string): ProviderResourceBinding {
  return { organizationId: org, envelopeId: env.id, planHash: env.planHash, channel: 'google', entityType, materialFingerprint: fingerprint(entityType, [resourceName]), providerResourceId: resourceName, createdAt: ahora, lastVerifiedAt: ahora };
}

/**
 * Correlaciona los recursos leídos con el plan. FAIL-CLOSED total: cualquier huella incorrecta, faltante, sobrante
 * o ambigüedad ⇒ ok=false y bindings=[]. Nunca persiste parcial; nunca fabrica IDs (sólo usa resourceName de Google).
 */
export function correlacionarGrafo(org: string, env: AuthorizedExecutionEnvelope, plan: MarketingPlan, geoResueltas: readonly GeoRegionResuelta[], leidos: RecursosLeidos, ahora: string): ResultadoCorrelacion {
  const recoveredResourceCount = leidos.campaign.length + leidos.campaignBudget.length + leidos.adGroup.length + leidos.adGroupAd.length + leidos.adGroupCriterion.length + leidos.campaignCriterion.length;
  const c0 = plan.campaigns[0];
  // EXPECTED se DERIVA del plan (no se hardcodea 61): 1 campaign + 1 budget + adGroups + ads + keywords + negativas + geo.
  const expected = c0 ? 2 + c0.adGroups.length + c0.adGroups.reduce((n, g) => n + g.ads.length, 0) + plan.activeKeywords.length + (c0.negativeKeywords ?? []).length + geoResueltas.length : 0;
  const base = { fingerprintOk: false, expectedOperations: expected, recoveredResourceCount, matchedOperationCount: 0, unmatchedOperationCount: 0, ambiguousOperationCount: 0, campaignResourceName: null as string | null, bindings: [] as ProviderResourceBinding[] };
  const fail = (reason: string, extra?: Partial<ResultadoCorrelacion>): ResultadoCorrelacion => ({ ...base, ok: false, reason, ...extra });
  if (!c0) return fail('NO_PLAN');

  // 1) CAMPAÑA: exactamente 1, con huella correcta (nombre + canal SEARCH + budget total 15.000).
  if (leidos.campaign.length !== 1) return fail('CAMPAIGN_NOT_UNIQUE');
  const camp = leidos.campaign[0]!.campaign ?? {};
  const budget = leidos.campaignBudget[0]?.campaignBudget ?? {};
  const budgetMicrosEsperado = c0.budgetPolicy.totalAmount * 1_000_000;
  const fingerprintOk = norm(camp.name) === norm(c0.campaignName)
    && camp.advertisingChannelType === 'SEARCH'
    && leidos.campaignBudget.length === 1
    && Number(budget.totalAmountMicros) === budgetMicrosEsperado;
  if (!fingerprintOk) return fail('CAMPAIGN_FINGERPRINT_MISMATCH', { fingerprintOk: false });
  if (!camp.resourceName || !budget.resourceName) return fail('MISSING_CAMPAIGN_RESOURCE_NAME', { fingerprintOk: true });

  // 2) AD GROUPS: biyección por nombre. Construye el mapa nombre→resourceName real para correlacionar hijos.
  const adGroupsPlan = c0.adGroups;
  const agMatch = emparejar(adGroupsPlan, leidos.adGroup, (g) => norm(g.name), (r) => norm(r.adGroup?.name));
  if (agMatch.faltantes || agMatch.ambiguos || agMatch.sobrantes) return fail('AD_GROUP_MISMATCH', { fingerprintOk: true });
  const rnPorGrupo = new Map<string, string>(); // action → real adGroup resourceName
  for (const { e, r } of agMatch.pares) { const rn = r.adGroup?.resourceName; if (!rn) return fail('MISSING_AD_GROUP_RESOURCE_NAME', { fingerprintOk: true }); rnPorGrupo.set(e.action, rn); }

  // 3) ADS (RSA): biyección por (adGroup real + set de headlines).
  const adsPlan = adGroupsPlan.flatMap((g) => g.ads.map((a) => ({ agRN: rnPorGrupo.get(g.action)!, headlines: a.headlines })));
  const adMatch = emparejar(adsPlan, leidos.adGroupAd, (a) => `${a.agRN}::${a.headlines.map((h) => norm(h)).sort().join('|')}`, (r) => `${r.adGroup?.resourceName ?? ''}::${headlinesKey(r.adGroupAd?.ad?.responsiveSearchAd?.headlines)}`);
  if (adMatch.faltantes || adMatch.ambiguos || adMatch.sobrantes) return fail('AD_MISMATCH', { fingerprintOk: true });

  // 4) KEYWORDS (positivas): biyección por (adGroup real + texto + matchType).
  const kwPlan = plan.activeKeywords.map((k) => ({ agRN: rnPorGrupo.get(k.action), text: k.text, matchType: k.matchType })).filter((k) => k.agRN);
  const kwMatch = emparejar(kwPlan, leidos.adGroupCriterion, (k) => `${k.agRN}::${norm(k.text)}::${k.matchType}`, (r) => `${r.adGroup?.resourceName ?? ''}::${norm(r.adGroupCriterion?.keyword?.text)}::${r.adGroupCriterion?.keyword?.matchType ?? ''}`);
  if (kwMatch.faltantes || kwMatch.ambiguos) return fail('KEYWORD_MISMATCH', { fingerprintOk: true });

  // 5) CAMPAIGN CRITERIA: separar negativas (keyword) de geo (location) en lo LEÍDO.
  const negLeidas = leidos.campaignCriterion.filter((c) => c.campaignCriterion?.keyword?.text);
  const geoLeidas = leidos.campaignCriterion.filter((c) => c.campaignCriterion?.location?.geoTargetConstant);
  // Negativas: biyección por texto + matchType.
  const negPlan = c0.negativeKeywords ?? [];
  const negMatch = emparejar(negPlan, negLeidas, (n) => `${norm(n.text)}::${n.matchType}`, (r) => `${norm(r.campaignCriterion?.keyword?.text)}::${r.campaignCriterion?.keyword?.matchType ?? ''}`);
  if (negMatch.faltantes || negMatch.ambiguos) return fail('NEGATIVE_MISMATCH', { fingerprintOk: true });
  // Geo: biyección por geoTargetConstant + negative.
  const geoMatch = emparejar(geoResueltas, geoLeidas, (g) => `geoTargetConstants/${g.criterionId}::${g.negativa ? 'neg' : 'pos'}`, (r) => `${r.campaignCriterion?.location?.geoTargetConstant ?? ''}::${r.campaignCriterion?.negative ? 'neg' : 'pos'}`);
  if (geoMatch.faltantes || geoMatch.ambiguos) return fail('GEO_MISMATCH', { fingerprintOk: true });
  // Sobrantes en campaign_criterion (negativas+geo) juntos:
  if ((negMatch.sobrantes + geoMatch.sobrantes) !== 0 || (negLeidas.length + geoLeidas.length) !== leidos.campaignCriterion.length) return fail('CAMPAIGN_CRITERION_MISMATCH', { fingerprintOk: true });

  // 6) CONTEO: todo debe cuadrar a 61 (1 campaign + 1 budget + 2 adGroups + 2 ads + N keywords + M negativas + G geo).
  const matched = 1 + 1 + agMatch.pares.length + adMatch.pares.length + kwMatch.pares.length + negMatch.pares.length + geoMatch.pares.length;
  const counts = { fingerprintOk: true, matchedOperationCount: matched, unmatchedOperationCount: (kwMatch.faltantes + negMatch.faltantes + geoMatch.faltantes), ambiguousOperationCount: (kwMatch.ambiguos + negMatch.ambiguos + geoMatch.ambiguos) };
  if (matched !== expected) return fail('OPERATION_COUNT_MISMATCH', counts);

  // 7) BINDINGS (sólo entidades accionables; geo/budget se correlacionan pero no se bindean). Sólo resourceNames REALES.
  const bindings: ProviderResourceBinding[] = [binding(org, env, 'campaign', camp.resourceName, ahora)];
  for (const { r } of agMatch.pares) bindings.push(binding(org, env, 'adGroup', r.adGroup!.resourceName!, ahora));
  for (const { r } of adMatch.pares) { const rn = r.adGroupAd?.resourceName; if (!rn) return fail('MISSING_AD_RESOURCE_NAME', counts); bindings.push(binding(org, env, 'ad', rn, ahora)); }
  for (const { r } of kwMatch.pares) { const rn = r.adGroupCriterion?.resourceName; if (!rn) return fail('MISSING_KEYWORD_RESOURCE_NAME', counts); bindings.push(binding(org, env, 'keyword', rn, ahora)); }
  for (const { r } of negMatch.pares) { const rn = r.campaignCriterion?.resourceName; if (!rn) return fail('MISSING_NEGATIVE_RESOURCE_NAME', counts); bindings.push(binding(org, env, 'negative', rn, ahora)); }

  return { ...base, ...counts, ok: true, reason: null, campaignResourceName: camp.resourceName, bindings };
}
