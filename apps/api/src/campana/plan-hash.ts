/**
 * apps/api · campana · CANONICAL MATERIAL PLAN + HASH DETERMINISTA (PURO).
 *
 * `canonicalizeMaterialPlan` produce EXCLUSIVAMENTE el contenido MATERIAL que un humano autoriza (gasto,
 * targeting, mensaje, destino, riesgo, acciones permitidas). NO incluye campos EFÍMEROS (planId/envelopeId/
 * timestamps/startsAt-expiresAt absolutos/orden accidental): un plan materialmente idéntico ⇒ mismo canonical
 * ⇒ mismo hash, aunque se simule 102 s después. La duración entra como `periodDays` (no como fecha absoluta).
 */
import type { MarketingPlan } from './marketing-plan';
import { politicaAccionesDe } from './acciones';

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

/** Hash de un payload canónico ya construido (2×FNV-1a sobre serialización estable → 16 hex). */
export function hashCanonical(material: unknown): string {
  const s = stableStringify(material);
  return fnv1a(s) + fnv1a(s.split('').reverse().join(''));
}

/**
 * Contenido MATERIAL canónico del plan. Sets (canales/keywords/negativas/ads/destinos/stop rules/acciones)
 * se ORDENAN para que el orden accidental no afecte el hash. Las stop rules excluyen la FECHA ABSOLUTA
 * (efímera): la duración material vive en `periodDays`.
 */
export function canonicalizeMaterialPlan(plan: MarketingPlan): Record<string, unknown> {
  const c0 = plan.campaigns[0];
  return {
    objective: plan.objective.trim(),
    currency: plan.currency,
    humanTotalCap: plan.totalAuthorizedBudget,
    experimentBudget: plan.totalSpendRecommended,
    maxSpendWithoutContact: plan.maxSpendWithoutContact.value,
    periodDays: plan.period.dias,
    // Política de presupuesto MATERIAL: tipo (CAMPAIGN_TOTAL vs daily) + monto total + moneda + duración.
    // Cambiar de daily→total, el monto o la duración cambia el hash ⇒ exige nueva aprobación humana.
    budgetPolicy: c0?.budgetPolicy
      ? `${c0.budgetPolicy.type}|${c0.budgetPolicy.totalAmount}|${c0.budgetPolicy.currency}|${c0.budgetPolicy.durationDays}`
      : null,
    plannedChannels: plan.recommendedChannelMix.filter((m) => m.presupuesto > 0).map((m) => m.canal).sort(),
    authorizedActionPolicy: [...politicaAccionesDe()].sort(),
    selectedHypothesis: plan.selectedHypothesis?.id ?? null,
    activeKeywords: plan.activeKeywords.map((k) => `${k.text}|${k.matchType}|${k.action}`).sort(),
    negatives: (c0?.negativeKeywords ?? []).map((n) => `${n.text}|${n.matchType}`).sort(),
    ads: (c0?.adGroups ?? []).flatMap((g) => g.ads.flatMap((a) => [...a.headlines, ...a.descriptions])).sort(),
    destinations: (c0?.adGroups ?? []).map((g) => g.finalDestination).sort(),
    trackingRequirements: [...plan.requiredTracking].sort(),
    // Stop rules SIN fecha absoluta (efímera): id + enabled + umbral. La duración va en periodDays.
    stopRules: plan.stopCriteria.map((s) => `${s.id}|${s.enabled}|${s.threshold ?? ''}|${s.condition ?? ''}|${s.reason ?? ''}`).sort(),
  };
}

/** Hash CANÓNICO del plan material. Determinista; estable ante timestamps/IDs; sensible a cambios materiales. */
export function hashPlan(plan: MarketingPlan): string {
  return hashCanonical(canonicalizeMaterialPlan(plan));
}
