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

/**
 * Los ÚNICOS `campaign_criterion` DEVICE que Google agrega por defecto a una campaña SEARCH (targets de plataforma
 * presentes de fábrica, usados para bid modifiers): Desktop=30000, Mobile/HighEndMobile=30001, Tablet=30002.
 * NO incluye 30004 (Connected TV) ni ningún otro id. Contrato Google demostrado + evidencia real del recovery.
 */
const DEVICE_DEFAULTS_SEARCH: ReadonlySet<string> = new Set(['30000', '30001', '30002']);

/** PREDICADO EXACTO (no `type===DEVICE` a secas): true SÓLO para los 3 device defaults de una campaña SEARCH. */
export function esDefaultPlataformaSearchGoogle(c: { channelType: string | null | undefined; type: string | null; criterionId: string | null; negative: boolean; keywordText: string | null; locationGeoTargetConstant: string | null }): boolean {
  return c.channelType === 'SEARCH'
    && c.type === 'DEVICE'
    && !!c.criterionId && DEVICE_DEFAULTS_SEARCH.has(c.criterionId)
    && c.negative === false
    && c.keywordText === null
    && c.locationGeoTargetConstant === null;
}

/** Consultas GAQL READ-ONLY ancladas a la campaña. Los campos verifican/correlacionan; ningún write. */
export function consultasRecuperacion(campaignId: string): Record<string, string> {
  const wc = `WHERE campaign.id = ${campaignId}`;
  // campaign_budget es un RECURSO ATRIBUIDO de campaign: se selecciona DESDE campaign (no `FROM campaign_budget
  // WHERE campaign.id`, que es INVALID_ARGUMENT porque campaign_budget no atribuye a campaign — puede ser compartido).
  return {
    campaign: `SELECT campaign.resource_name, campaign.name, campaign.advertising_channel_type, campaign.status, campaign_budget.resource_name, campaign_budget.total_amount_micros FROM campaign ${wc}`,
    adGroup: `SELECT ad_group.resource_name, ad_group.name FROM ad_group ${wc}`,
    adGroupAd: `SELECT ad_group_ad.resource_name, ad_group_ad.ad.responsive_search_ad.headlines, ad_group.resource_name FROM ad_group_ad ${wc}`,
    adGroupCriterion: `SELECT ad_group_criterion.resource_name, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group.resource_name FROM ad_group_criterion ${wc} AND ad_group_criterion.type = KEYWORD`,
    campaignCriterion: `SELECT campaign_criterion.resource_name, campaign_criterion.criterion_id, campaign_criterion.type, campaign_criterion.negative, campaign_criterion.keyword.text, campaign_criterion.keyword.match_type, campaign_criterion.location.geo_target_constant FROM campaign_criterion ${wc}`,
  };
}

// Filas leídas (subset tipado de la respuesta GAQL, camelCase).
export interface RecursosLeidos {
  readonly campaign: ReadonlyArray<{ campaign?: { resourceName?: string; name?: string; advertisingChannelType?: string; campaignBudget?: string } }>;
  readonly campaignBudget: ReadonlyArray<{ campaignBudget?: { resourceName?: string; totalAmountMicros?: string | number } }>;
  readonly adGroup: ReadonlyArray<{ adGroup?: { resourceName?: string; name?: string } }>;
  readonly adGroupAd: ReadonlyArray<{ adGroupAd?: { resourceName?: string; ad?: { responsiveSearchAd?: { headlines?: Array<{ text?: string }> } } }; adGroup?: { resourceName?: string } }>;
  readonly adGroupCriterion: ReadonlyArray<{ adGroupCriterion?: { resourceName?: string; keyword?: { text?: string; matchType?: string } }; adGroup?: { resourceName?: string } }>;
  readonly campaignCriterion: ReadonlyArray<{ campaignCriterion?: { resourceName?: string; criterionId?: string | number; type?: string; negative?: boolean; keyword?: { text?: string; matchType?: string }; location?: { geoTargetConstant?: string } } }>;
}

/** Un campaign_criterion recuperado que NO pertenece al grafo del plan (a clasificar). Sin secretos. */
export interface ExtraCriterion {
  readonly resourceName: string | null;
  readonly criterionId: string | null;
  readonly type: string | null;
  readonly negative: boolean;
  readonly keywordText: string | null;
  readonly locationGeoTargetConstant: string | null;
  readonly classification: 'PROVIDER_GENERATED_DEFAULT' | 'PLAN_OWNED' | 'USER_CREATED_UNKNOWN' | 'AMBIGUOUS';
}

export interface ResultadoCorrelacion {
  readonly ok: boolean;
  readonly reason: string | null;
  readonly fingerprintOk: boolean;
  readonly expectedOperations: number;
  readonly recoveredResourceCount: number;         // = rawRecoveredResourceCount
  readonly rawRecoveredResourceCount: number;
  readonly matchedOperationCount: number;          // = planOwnedMatchedOperationCount
  readonly planOwnedMatchedOperationCount: number;
  readonly unmatchedOperationCount: number;
  readonly ambiguousOperationCount: number;
  readonly recoveredCampaignCriteriaByType: Record<string, number>;
  readonly providerGeneratedExtraCount: number;
  readonly providerGeneratedExtrasByType: Record<string, number>;
  readonly extras: readonly ExtraCriterion[];      // criterios no plan-owned (para clasificar/provenance)
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
 * Correlaciona los recursos leídos con el plan. FAIL-CLOSED total: huella incorrecta, faltante, ambigüedad, o un
 * campaign_criterion EXTRA no clasificable como provider-generated ⇒ ok=false y bindings=[]. Nunca parcial; nunca
 * fabrica IDs. Distingue RAW (lo que devuelve Google) de PLAN-OWNED (lo que SOEC autorizó): Google puede tener
 * criterios propios (defaults) que NO pertenecen al grafo, pero eso NO debe impedir recuperar los del plan — SIEMPRE
 * que cada extra quede DEMOSTRADO como provider-generated (por `tiposProviderGenerated`); si no, fail-closed.
 */
export function correlacionarGrafo(org: string, env: AuthorizedExecutionEnvelope, plan: MarketingPlan, geoResueltas: readonly GeoRegionResuelta[], leidos: RecursosLeidos, ahora: string): ResultadoCorrelacion {
  const recoveredResourceCount = leidos.campaign.length + leidos.campaignBudget.length + leidos.adGroup.length + leidos.adGroupAd.length + leidos.adGroupCriterion.length + leidos.campaignCriterion.length;
  const recoveredCampaignCriteriaByType: Record<string, number> = {};
  for (const c of leidos.campaignCriterion) { const t = c.campaignCriterion?.type ?? 'UNKNOWN'; recoveredCampaignCriteriaByType[t] = (recoveredCampaignCriteriaByType[t] ?? 0) + 1; }
  const c0 = plan.campaigns[0];
  // EXPECTED se DERIVA del plan (no se hardcodea 61): 1 campaign + 1 budget + adGroups + ads + keywords + negativas + geo.
  const expected = c0 ? 2 + c0.adGroups.length + c0.adGroups.reduce((n, g) => n + g.ads.length, 0) + plan.activeKeywords.length + (c0.negativeKeywords ?? []).length + geoResueltas.length : 0;
  const base = { fingerprintOk: false, expectedOperations: expected, recoveredResourceCount, rawRecoveredResourceCount: recoveredResourceCount, matchedOperationCount: 0, planOwnedMatchedOperationCount: 0, unmatchedOperationCount: 0, ambiguousOperationCount: 0, recoveredCampaignCriteriaByType, providerGeneratedExtraCount: 0, providerGeneratedExtrasByType: {} as Record<string, number>, extras: [] as ExtraCriterion[], campaignResourceName: null as string | null, bindings: [] as ProviderResourceBinding[] };
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

  // 5) CAMPAIGN CRITERIA: emparejar las PLAN-OWNED (negativas por keyword, geo por location). Los recovered que NO
  //    correspondan al plan son EXTRAS a clasificar (provider-generated demostrado vs desconocido/ambiguo).
  const keywordCriteria = leidos.campaignCriterion.filter((c) => c.campaignCriterion?.keyword?.text);
  const locationCriteria = leidos.campaignCriterion.filter((c) => c.campaignCriterion?.location?.geoTargetConstant);
  const negPlan = c0.negativeKeywords ?? [];
  const negMatch = emparejar(negPlan, keywordCriteria, (n) => `${norm(n.text)}::${n.matchType}`, (r) => `${norm(r.campaignCriterion?.keyword?.text)}::${r.campaignCriterion?.keyword?.matchType ?? ''}`);
  if (negMatch.faltantes || negMatch.ambiguos) return fail('NEGATIVE_MISMATCH', { fingerprintOk: true });
  const geoMatch = emparejar(geoResueltas, locationCriteria, (g) => `geoTargetConstants/${g.criterionId}::${g.negativa ? 'neg' : 'pos'}`, (r) => `${r.campaignCriterion?.location?.geoTargetConstant ?? ''}::${r.campaignCriterion?.negative ? 'neg' : 'pos'}`);
  if (geoMatch.faltantes || geoMatch.ambiguos) return fail('GEO_MISMATCH', { fingerprintOk: true });

  // EXTRAS = todo campaign_criterion NO emparejado como negativa/geo del plan. Se clasifica cada uno.
  const matchedRecovered = new Set([...negMatch.pares.map((p) => p.r), ...geoMatch.pares.map((p) => p.r)]);
  const extras: ExtraCriterion[] = leidos.campaignCriterion.filter((c) => !matchedRecovered.has(c)).map((row) => {
    const cc = row.campaignCriterion ?? {};
    const keywordText = cc.keyword?.text ?? null;
    const location = cc.location?.geoTargetConstant ?? null;
    const type = cc.type ?? null;
    const criterionId = cc.criterionId != null ? String(cc.criterionId) : null;
    const negative = cc.negative === true;
    // Un extra con SEMÁNTICA de plan (keyword/location) que sobró ⇒ AMBIGUOUS (indistinguible de una op del plan) ⇒
    // fail-closed (§6). Uno SIN esa semántica sólo es seguro si cumple el PREDICADO EXACTO de device-default SEARCH.
    const classification: ExtraCriterion['classification'] = (keywordText || location) ? 'AMBIGUOUS'
      : esDefaultPlataformaSearchGoogle({ channelType: camp.advertisingChannelType, type, criterionId, negative, keywordText, locationGeoTargetConstant: location }) ? 'PROVIDER_GENERATED_DEFAULT'
        : 'USER_CREATED_UNKNOWN';
    return { resourceName: cc.resourceName ?? null, criterionId, type, negative, keywordText, locationGeoTargetConstant: location, classification };
  });
  const providerGeneratedExtras = extras.filter((e) => e.classification === 'PROVIDER_GENERATED_DEFAULT');
  const providerGeneratedExtrasByType: Record<string, number> = {};
  for (const e of providerGeneratedExtras) { const t = e.type ?? 'UNKNOWN'; providerGeneratedExtrasByType[t] = (providerGeneratedExtrasByType[t] ?? 0) + 1; }

  const planOwnedMatched = 1 + 1 + agMatch.pares.length + adMatch.pares.length + kwMatch.pares.length + negMatch.pares.length + geoMatch.pares.length;
  const resumen = { fingerprintOk: true, matchedOperationCount: planOwnedMatched, planOwnedMatchedOperationCount: planOwnedMatched, unmatchedOperationCount: (kwMatch.faltantes + negMatch.faltantes + geoMatch.faltantes), ambiguousOperationCount: (kwMatch.ambiguos + negMatch.ambiguos + geoMatch.ambiguos), recoveredCampaignCriteriaByType, providerGeneratedExtraCount: providerGeneratedExtras.length, providerGeneratedExtrasByType, extras };

  // FAIL-CLOSED: cualquier extra NO demostrado como provider-generated ⇒ 0 persistencia (con el detalle para clasificar).
  const inseguros = extras.filter((e) => e.classification !== 'PROVIDER_GENERATED_DEFAULT');
  if (inseguros.length > 0) return fail('CAMPAIGN_CRITERION_MISMATCH', resumen);
  // El plan-owned debe cuadrar exactamente (61). Los extras provider-generated NO cuentan como operaciones del plan.
  if (planOwnedMatched !== expected) return fail('OPERATION_COUNT_MISMATCH', resumen);

  // 6) BINDINGS (sólo entidades accionables plan-owned; geo/budget/extras NO se bindean). Sólo resourceNames REALES.
  const bindings: ProviderResourceBinding[] = [binding(org, env, 'campaign', camp.resourceName, ahora)];
  for (const { r } of agMatch.pares) bindings.push(binding(org, env, 'adGroup', r.adGroup!.resourceName!, ahora));
  for (const { r } of adMatch.pares) { const rn = r.adGroupAd?.resourceName; if (!rn) return fail('MISSING_AD_RESOURCE_NAME', resumen); bindings.push(binding(org, env, 'ad', rn, ahora)); }
  for (const { r } of kwMatch.pares) { const rn = r.adGroupCriterion?.resourceName; if (!rn) return fail('MISSING_KEYWORD_RESOURCE_NAME', resumen); bindings.push(binding(org, env, 'keyword', rn, ahora)); }
  for (const { r } of negMatch.pares) { const rn = r.campaignCriterion?.resourceName; if (!rn) return fail('MISSING_NEGATIVE_RESOURCE_NAME', resumen); bindings.push(binding(org, env, 'negative', rn, ahora)); }

  return { ...base, ...resumen, ok: true, reason: null, campaignResourceName: camp.resourceName, bindings };
}
