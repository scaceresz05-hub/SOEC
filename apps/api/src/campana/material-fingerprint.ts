/**
 * apps/api · campana · FINGERPRINTS MATERIALES (PURO). Cada entidad ejecutable tiene un fingerprint DETERMINISTA
 * derivado del material APROBADO. La jerarquía CAMPAIGN → AD_GROUP → AD/KEYWORD se codifica incluyendo el
 * fingerprint del AD GROUP PADRE en ads y keywords: mismo copy/keyword en dos grupos ⇒ fingerprints DISTINTOS.
 */
import { hashCanonical } from './plan-hash';
import type { MarketingPlan, AdGroupDraft, AdDraft, ActiveKeyword } from './marketing-plan';

export type EntityType = 'campaign' | 'adGroup' | 'ad' | 'keyword' | 'negative' | 'destination';

/** Fingerprint determinista de una entidad: hash canónico de [tipo, ...material]. */
export function fingerprint(entityType: EntityType, material: readonly unknown[]): string {
  return hashCanonical([entityType, ...material]);
}

/** Fingerprint del AD GROUP (identidad lógica del padre). */
export function adGroupFingerprint(g: AdGroupDraft): string {
  return fingerprint('adGroup', [g.name, g.intent, g.action]);
}
/** Fingerprint del AD incluyendo su AD GROUP padre + copy + destino. */
export function adFingerprint(parentAdGroupFp: string, a: AdDraft, finalDestination: string): string {
  return fingerprint('ad', [parentAdGroupFp, ...a.headlines, ...a.descriptions, finalDestination]);
}
/** Fingerprint de la KEYWORD incluyendo su AD GROUP padre + texto + matchType. */
export function keywordFingerprint(parentAdGroupFp: string, k: ActiveKeyword): string {
  return fingerprint('keyword', [parentAdGroupFp, k.text, k.matchType]);
}

/** Ad group padre de una keyword activa (por su acción TARGET/SEGMENT). null si no hay grupo correspondiente. */
export function adGroupPadreDeKeyword(plan: MarketingPlan, k: ActiveKeyword): AdGroupDraft | null {
  return (plan.campaigns[0]?.adGroups ?? []).find((g) => g.action === k.action) ?? null;
}

export interface PlanFingerprints {
  readonly campaign: string;
  readonly adGroups: readonly string[];
  readonly ads: readonly string[];
  readonly keywords: readonly string[];
  readonly negatives: readonly string[];
  readonly destinations: readonly string[];
  /** Conjunto de fingerprints de AD GROUP (para validar el padre de ads/keywords). */
  readonly adGroupSet: ReadonlySet<string>;
  /** Conjunto de TODOS los fingerprints materiales del plan (membresía O(1)). */
  readonly all: ReadonlySet<string>;
}

export function fingerprintsDelPlan(plan: MarketingPlan): PlanFingerprints {
  const c0 = plan.campaigns[0];
  const groups = c0?.adGroups ?? [];
  // El fingerprint de campaña incluye la POLÍTICA DE PRESUPUESTO material (tipo|total|moneda|duración): un retry
  // NO puede crear un segundo CampaignBudget/Campaign con términos distintos sin cambiar el fingerprint (§5).
  const bp = c0?.budgetPolicy;
  const budgetSig = bp ? `${bp.type}|${bp.totalAmount}|${bp.currency}|${bp.durationDays}` : '';
  const campaign = fingerprint('campaign', [c0?.campaignName ?? '', c0?.campaignType ?? '', plan.objective, plan.totalSpendRecommended, budgetSig]);
  const adGroups = groups.map((g) => adGroupFingerprint(g));
  const ads: string[] = [];
  groups.forEach((g, gi) => g.ads.forEach((a) => ads.push(adFingerprint(adGroups[gi]!, a, g.finalDestination))));
  const keywords = plan.activeKeywords.map((k) => {
    const g = adGroupPadreDeKeyword(plan, k);
    return keywordFingerprint(g ? adGroupFingerprint(g) : '', k);
  });
  const negatives = (c0?.negativeKeywords ?? []).map((n) => fingerprint('negative', [n.text, n.matchType]));
  const destinations = [...new Set(groups.map((g) => g.finalDestination))].map((d) => fingerprint('destination', [d]));
  const adGroupSet = new Set<string>(adGroups);
  const all = new Set<string>([campaign, ...adGroups, ...ads, ...keywords, ...negatives, ...destinations]);
  return { campaign, adGroups, ads, keywords, negatives, destinations, adGroupSet, all };
}
