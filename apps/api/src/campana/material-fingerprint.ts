/**
 * apps/api · campana · FINGERPRINTS MATERIALES (PURO). Cada entidad ejecutable (campaign/adGroup/ad/keyword/
 * negative/destination) tiene un fingerprint DETERMINISTA derivado del material APROBADO. Permite demostrar que
 * una acción de proveedor corresponde EXACTAMENTE a un objeto del plan autorizado (nada fuera del material).
 */
import { hashCanonical } from './plan-hash';
import type { MarketingPlan } from './marketing-plan';

export type EntityType = 'campaign' | 'adGroup' | 'ad' | 'keyword' | 'negative' | 'destination';

/** Fingerprint determinista de una entidad: hash canónico de [tipo, ...material]. */
export function fingerprint(entityType: EntityType, material: readonly unknown[]): string {
  return hashCanonical([entityType, ...material]);
}

export interface PlanFingerprints {
  readonly campaign: string;
  readonly adGroups: readonly string[];
  readonly ads: readonly string[];
  readonly keywords: readonly string[];
  readonly negatives: readonly string[];
  readonly destinations: readonly string[];
  /** Conjunto de TODOS los fingerprints materiales del plan (membresía O(1)). */
  readonly all: ReadonlySet<string>;
}

export function fingerprintsDelPlan(plan: MarketingPlan): PlanFingerprints {
  const c0 = plan.campaigns[0];
  const campaign = fingerprint('campaign', [c0?.campaignName ?? '', c0?.campaignType ?? '', plan.objective, plan.totalSpendRecommended]);
  const adGroups = (c0?.adGroups ?? []).map((g) => fingerprint('adGroup', [g.name, g.intent, g.action]));
  const ads = (c0?.adGroups ?? []).flatMap((g) => g.ads.map((a) => fingerprint('ad', [...a.headlines, ...a.descriptions, g.finalDestination])));
  const keywords = plan.activeKeywords.map((k) => fingerprint('keyword', [k.text, k.matchType]));
  const negatives = (c0?.negativeKeywords ?? []).map((n) => fingerprint('negative', [n.text, n.matchType]));
  const destinations = [...new Set((c0?.adGroups ?? []).map((g) => g.finalDestination))].map((d) => fingerprint('destination', [d]));
  const all = new Set<string>([campaign, ...adGroups, ...ads, ...keywords, ...negatives, ...destinations]);
  return { campaign, adGroups, ads, keywords, negatives, destinations, all };
}
