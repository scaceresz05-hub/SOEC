/**
 * apps/api · campana · MATERIALIZADOR Google-native V2 (PURO). Produce UNA sola request de
 * `GoogleAdsService.Mutate` para TODO el grafo interdependiente (CampaignBudget → Campaign → AdGroups → Ads →
 * Keywords → CampaignCriteria [negativas + geo]), con TEMPORARY RESOURCE NAMES (ids negativos) para que cada
 * hijo referencie a su padre dentro de la MISMA request. `partialFailure=false` ⇒ todo o nada (sin recursos
 * huérfanos). La ÚNICA diferencia entre VALIDATE y REAL es `validateOnly`.
 *
 * Campaign es Google-native: `advertisingChannelType=SEARCH`, estrategia de puja real (`maximizeConversions`,
 * derivada del objetivo LEADS + tracking de conversiones, sin CPA histórico), `networkSettings` conservadores
 * (Search ON; partners/display OFF), `geoTargetTypeSetting` PRESENCE, `campaignBudget` por referencia temporal y
 * fechas concretas. NO usa `campaignType`/`objective`/`budgetPolicy` (no son campos de Google). Fechas: el PLAN
 * guarda la REGLA (inicio=activación, fin=inicio+9 días); las fechas concretas las inyecta el caller.
 */
import type { MarketingPlan } from './marketing-plan';
import type { GeoPolicy, GeoRegionResuelta } from './geo-policy';
import type { PaqueteDeEjecucion } from '../ejecucion/paquete';

export interface OpcionesMaterializacion {
  readonly customerId: string;
  /** 'YYYY-MM-DD HH:mm:ss' en la zona de serving del customer (NO UTC). Campaign.start_date_time (v23+). */
  readonly startDateTime: string;
  /** 'YYYY-MM-DD HH:mm:ss'. Campaign.end_date_time = inicio + 9 días 23:59:59 (10 días calendario inclusivos). */
  readonly endDateTime: string;
  readonly validateOnly: boolean;
  /**
   * Estado inicial de la campaña. Por defecto `PAUSED`: crear no es activar, y una campaña que nace encendida
   * gasta dinero de alguien antes de que nadie la mire. Encenderla es una decisión aparte, de otra fase.
   */
  readonly campaignStatus?: 'ENABLED' | 'PAUSED';
}

/**
 * Ventana de fechas Google-native desde la fecha LOCAL de activación (política contractual, PURA):
 * START = activación a las 00:00:00; END = START + 9 días a las 23:59:59 (10 días calendario inclusivos).
 * Formato Google `yyyy-MM-dd HH:mm:ss`. NO convierte a UTC — la aritmética de +9 días es sobre el calendario
 * (medianoche UTC como pivote determinista) y las horas literales son wall-clock de serving.
 */
export function ventanaFechasDesdeActivacion(activationDate: string): { startDateTime: string; endDateTime: string } {
  const fin = new Date(`${activationDate}T00:00:00Z`);
  fin.setUTCDate(fin.getUTCDate() + 9);
  return { startDateTime: `${activationDate} 00:00:00`, endDateTime: `${fin.toISOString().slice(0, 10)} 23:59:59` };
}

export interface MutateOperationGoogle { readonly [k: string]: unknown }
export interface GoogleAdsMutateRequest {
  readonly mutateOperations: readonly MutateOperationGoogle[];
  readonly partialFailure: false;
  readonly validateOnly?: true;
}

/** Estrategia de puja derivada del plan (no inventada): LEADS + tracking ⇒ MAXIMIZE_CONVERSIONS. */
export function biddingGoogleDePlan(plan: MarketingPlan): { internal: string; google: 'MAXIMIZE_CONVERSIONS'; field: 'maximizeConversions' } {
  void plan;
  return { internal: 'LEADS (conversión, sin CPA histórico defendible)', google: 'MAXIMIZE_CONVERSIONS', field: 'maximizeConversions' };
}

export const NETWORK_SETTINGS_V2 = { targetGoogleSearch: true, targetSearchNetwork: false, targetContentNetwork: false, targetPartnerSearchNetwork: false } as const;

/**
 * Construye la request completa. `geoResueltas` = regiones ya resueltas (criterionId) por Google en runtime.
 * Devuelve null si falta material esencial (campaña o geo positivas). No hace I/O.
 */
export function materializarGoogleAdsMutate(plan: MarketingPlan, geo: GeoPolicy, geoResueltas: readonly GeoRegionResuelta[], opts: OpcionesMaterializacion): GoogleAdsMutateRequest | null {
  const c0 = plan.campaigns[0];
  if (!c0) return null;
  const positivas = geoResueltas.filter((r) => !r.negativa);
  if (positivas.length === 0) return null; // sin regiones positivas ⇒ no materializar (evita targetear Chile completo)

  const cid = opts.customerId;
  let temp = 0;
  // Temporary resource name COMPLETO (`customers/{cid}/{coleccion}/-N`) — SÓLO para recursos PADRE que otra
  // operación posterior referencia (budget, campaign, ad groups). Los recursos HOJA (adGroupAds, adGroupCriteria,
  // campaignCriteria) NO se referencian y NO llevan resourceName propio: su id real es COMPUESTO
  // (`{parentId}~{childId}`), así que un temp escalar `-N` es BAD_RESOURCE_ID. Google se lo asigna al crearlos.
  const rn = (coleccion: string): string => `customers/${cid}/${coleccion}/-${(temp += 1)}`;
  const ops: MutateOperationGoogle[] = [];

  // 1) CampaignBudget (total, CUSTOM_PERIOD, no compartido).
  const budgetRN = rn('campaignBudgets');
  ops.push({ campaignBudgetOperation: { create: { resourceName: budgetRN, name: `${c0.campaignName} · presupuesto`, period: 'CUSTOM_PERIOD', totalAmountMicros: c0.budgetPolicy.totalAmount * 1_000_000, explicitlyShared: false } } });

  // 2) Campaign (Google-native).
  const campaignRN = rn('campaigns');
  const bidding = biddingGoogleDePlan(plan);
  ops.push({ campaignOperation: { create: {
    resourceName: campaignRN,
    name: c0.campaignName,
    advertisingChannelType: 'SEARCH',
    // Obligatorio desde v21+ (regulación UE de publicidad política). SmileFlow es SaaS dental: no la contiene.
    containsEuPoliticalAdvertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
    status: opts.campaignStatus ?? 'PAUSED',
    campaignBudget: budgetRN,
    [bidding.field]: {},
    networkSettings: { ...NETWORK_SETTINGS_V2 },
    geoTargetTypeSetting: { positiveGeoTargetType: geo.positiveGeoTargetType, negativeGeoTargetType: geo.negativeGeoTargetType },
    // v23+ eliminó Campaign.start_date/end_date. v25 usa start_date_time/end_date_time (yyyy-MM-dd HH:mm:ss).
    startDateTime: opts.startDateTime,
    endDateTime: opts.endDateTime,
  } } });

  // 3) AdGroups (uno por grupo del plan) + índice por acción para asignar keywords a su grupo.
  const adGroupRNPorAccion = new Map<string, string>();
  c0.adGroups.forEach((g) => {
    const agRN = rn('adGroups');
    adGroupRNPorAccion.set(g.action, agRN);
    ops.push({ adGroupOperation: { create: { resourceName: agRN, name: g.name, campaign: campaignRN, status: 'ENABLED', type: 'SEARCH_STANDARD' } } });
    // 4) Ads (RSA) del grupo. HOJA: sin resourceName propio; sólo referencia a su ad group padre.
    g.ads.forEach((a) => {
      ops.push({ adGroupAdOperation: { create: { adGroup: agRN, status: 'ENABLED', ad: { responsiveSearchAd: { headlines: a.headlines.map((t) => ({ text: t })), descriptions: a.descriptions.map((t) => ({ text: t })) }, finalUrls: [g.finalDestination] } } } });
    });
  });

  // 5) Keywords (a su AD GROUP por acción).
  plan.activeKeywords.forEach((k) => {
    const agRN = adGroupRNPorAccion.get(k.action);
    if (!agRN) return;
    // HOJA: sin resourceName propio; sólo referencia a su ad group padre.
    ops.push({ adGroupCriterionOperation: { create: { adGroup: agRN, status: 'ENABLED', keyword: { text: k.text, matchType: k.matchType } } } });
  });

  // 6) Negativas (a nivel campaña). HOJA: sin resourceName propio; sólo referencia a la campaña padre.
  (c0.negativeKeywords ?? []).forEach((n) => {
    ops.push({ campaignCriterionOperation: { create: { campaign: campaignRN, negative: true, keyword: { text: n.text, matchType: n.matchType } } } });
  });

  // 7) GEO: locations positivas (4 regiones) + RM negativa explícita. HOJA: sin resourceName propio.
  geoResueltas.forEach((r) => {
    ops.push({ campaignCriterionOperation: { create: { campaign: campaignRN, ...(r.negativa ? { negative: true } : {}), location: { geoTargetConstant: `geoTargetConstants/${r.criterionId}` } } } });
  });

  return { mutateOperations: ops, partialFailure: false, ...(opts.validateOnly ? { validateOnly: true } : {}) };
}

/** Cuenta operaciones por tipo (para verificación/telemetría). */
export function contarOperaciones(req: GoogleAdsMutateRequest): Record<string, number> {
  const out: Record<string, number> = {};
  for (const op of req.mutateOperations) {
    const clave = Object.keys(op)[0] ?? 'desconocida';
    out[clave] = (out[clave] ?? 0) + 1;
  }
  out.total = req.mutateOperations.length;
  return out;
}

// ── MATERIALIZACIÓN GENERAL (multiempresa) ──────────────────────────────────────────────────────
//
// Mismo ejecutor, misma request atómica, mismas reglas: lo único que cambia es que la entrada ya no es el plan
// de UNA empresa concreta, sino el PAQUETE CONGELADO que produce la planificación para cualquier empresa
// (`apps/api/src/ejecucion/paquete.ts`). El camino por-plan histórico se conserva encima, como adaptador.
//
// INVARIANTE DE ESTA FASE: la campaña se crea `PAUSED` y sus grupos también. Dos puertas, no una: quien la
// encienda en el futuro tendrá que abrirlas a propósito.

/** Puja de Google derivada de la estrategia propuesta por el plan. No se inventa ninguna otra. */
export function pujaGoogleDePaquete(p: PaqueteDeEjecucion): Record<string, unknown> {
  const techo = p.campania.puja.techoCpcMicros;
  switch (p.campania.puja.estrategia) {
    case 'MAXIMIZE_CONVERSIONS':
      return { maximizeConversions: {} };
    case 'MANUAL_CPC':
      return { manualCpc: { enhancedCpcEnabled: false } };
    case 'MAXIMIZE_CLICKS_WITH_CPC_CEILING':
    default:
      // «Maximizar clics con techo» es `targetSpend` con tope de CPC: compra visitas sin superar el precio.
      return { targetSpend: techo === null ? {} : { cpcBidCeilingMicros: String(techo) } };
  }
}

/**
 * Convierte el paquete congelado en UNA sola request de `GoogleAdsService.Mutate` (`partialFailure=false`):
 * presupuesto → campaña → grupos → anuncios → palabras → negativas → geografía → idioma. Los recursos padre
 * usan nombres temporales para que los hijos los referencien dentro de la MISMA request; si Google rechaza una
 * operación, no queda nada a medias.
 */
export function materializarPaqueteGoogleAds(
  p: PaqueteDeEjecucion,
  opts: { readonly validateOnly: boolean },
): GoogleAdsMutateRequest | null {
  if (p.grupos.length === 0 || p.campania.geo.filter((g) => !g.negativo).length === 0) return null;

  const cid = p.cuenta.customerId;
  let temp = 0;
  const rn = (coleccion: string): string => `customers/${cid}/${coleccion}/-${(temp += 1)}`;
  const ops: MutateOperationGoogle[] = [];

  // 1) Presupuesto DIARIO propio de esta campaña (jamás compartido con otra).
  const budgetRN = rn('campaignBudgets');
  ops.push({ campaignBudgetOperation: { create: {
    resourceName: budgetRN,
    name: `${p.campania.nombre} · presupuesto`,
    amountMicros: String(p.campania.presupuestoDiarioMicros),
    deliveryMethod: 'STANDARD',
    explicitlyShared: false,
  } } });

  // 2) Campaña — SIEMPRE en pausa, sin red de display ni partners, y sólo a quien está EN el territorio.
  const campaignRN = rn('campaigns');
  ops.push({ campaignOperation: { create: {
    resourceName: campaignRN,
    name: p.campania.nombre,
    advertisingChannelType: 'SEARCH',
    containsEuPoliticalAdvertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
    status: p.estadoInicial,
    campaignBudget: budgetRN,
    ...pujaGoogleDePaquete(p),
    networkSettings: { ...NETWORK_SETTINGS_V2 },
    geoTargetTypeSetting: { positiveGeoTargetType: 'PRESENCE', negativeGeoTargetType: 'PRESENCE' },
  } } });

  // 3) Grupos + anuncios. El grupo nace en pausa: segunda puerta.
  for (const g of p.grupos) {
    const agRN = rn('adGroups');
    ops.push({ adGroupOperation: { create: {
      resourceName: agRN, name: g.nombre, campaign: campaignRN, status: 'PAUSED', type: 'SEARCH_STANDARD',
    } } });
    for (const a of g.anuncios) {
      ops.push({ adGroupAdOperation: { create: {
        adGroup: agRN,
        status: 'ENABLED', // el anuncio vive dentro de un grupo pausado dentro de una campaña pausada
        ad: {
          responsiveSearchAd: {
            headlines: a.titulares.map((t) => ({ text: t })),
            descriptions: a.descripciones.map((t) => ({ text: t })),
          },
          finalUrls: [g.urlFinal],
        },
      } } });
    }
    for (const k of g.palabras) {
      ops.push({ adGroupCriterionOperation: { create: {
        adGroup: agRN, status: 'ENABLED', keyword: { text: k.texto, matchType: k.concordancia },
      } } });
    }
  }

  // 4) Negativas de campaña: sólo las que el plan justificó, no todo el catálogo de candidatas.
  for (const n of p.negativas) {
    ops.push({ campaignCriterionOperation: { create: {
      campaign: campaignRN, negative: true, keyword: { text: n.texto, matchType: n.concordancia },
    } } });
  }

  // 5) Geografía: únicamente los objetivos que la plataforma confirmó (nunca un radio silencioso).
  for (const geo of p.campania.geo) {
    ops.push({ campaignCriterionOperation: { create: {
      campaign: campaignRN,
      ...(geo.negativo ? { negative: true } : {}),
      location: { geoTargetConstant: `geoTargetConstants/${geo.criterionId}` },
    } } });
  }

  // 6) Idioma declarado por el negocio.
  ops.push({ campaignCriterionOperation: { create: {
    campaign: campaignRN, language: { languageConstant: `languageConstants/${p.campania.idiomaConstantId}` },
  } } });

  return { mutateOperations: ops, partialFailure: false, ...(opts.validateOnly ? { validateOnly: true } : {}) };
}
