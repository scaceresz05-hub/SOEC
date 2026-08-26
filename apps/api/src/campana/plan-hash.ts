/**
 * apps/api · campana · HASH DETERMINISTA del PLAN (PURO). Liga la aprobación humana al contenido material del
 * plan: si cambia objetivo/budget/keywords/negativas/anuncios/destinos/stop rules/duración/canales, el hash
 * cambia y la aprobación anterior deja de ser válida. Determinista (sin Date/Math.random): mismo plan ⇒ mismo hash.
 */
import type { MarketingPlan } from './marketing-plan';

function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Extrae los campos MATERIALES del plan (los que, al cambiar, invalidan una aprobación humana). */
export function materialDePlan(plan: MarketingPlan): Record<string, unknown> {
  const c0 = plan.campaigns[0];
  return {
    objective: plan.objective,
    currency: plan.currency,
    totalCap: plan.totalAuthorizedBudget,
    experimentBudget: plan.totalSpendRecommended,
    maxSpendWithoutContact: plan.maxSpendWithoutContact.value,
    dias: plan.period.dias,
    channels: plan.recommendedChannelMix.filter((m) => m.presupuesto > 0).map((m) => m.canal).sort(),
    activeKeywords: plan.activeKeywords.map((k) => `${k.text}|${k.matchType}|${k.action}`).sort(),
    negatives: (c0?.negativeKeywords ?? []).map((n) => `${n.text}|${n.matchType}`).sort(),
    ads: (c0?.adGroups ?? []).flatMap((g) => g.ads.flatMap((a) => [...a.headlines, ...a.descriptions])).sort(),
    destinations: (c0?.adGroups ?? []).map((g) => g.finalDestination).sort(),
    stopRules: plan.stopCriteria.map((s) => `${s.id}|${s.enabled}|${s.threshold ?? ''}|${s.date ?? ''}`).sort(),
  };
}

/** Hash material del plan (2×FNV-1a sobre serialización estable → 16 hex). Determinista y sensible al contenido. */
export function hashPlan(plan: MarketingPlan): string {
  const s = stableStringify(materialDePlan(plan));
  return fnv1a(s) + fnv1a(s.split('').reverse().join(''));
}
