/**
 * apps/api · campana · EXECUTION ACTION INTENT (PURO). Traduce un PLAN APROBADO + ENVELOPE en acciones
 * concretas de Google Ads, cada una ligada a un fingerprint material y con idempotency key determinista.
 * Construir el plan NO ejecuta nada.
 */
import { fingerprintsDelPlan, type EntityType } from './material-fingerprint';
import { traducir, type GoogleMutationPayload } from './google-translator';
import { hashCanonical } from './plan-hash';
import type { MarketingPlan } from './marketing-plan';
import type { AuthorizedExecutionEnvelope } from './authorized-execution-envelope';
import type { AccionAutorizable } from './acciones';

export type ExecutionActionStatus = 'PLANNED' | 'VALIDATED' | 'BLOCKED' | 'READY_FOR_PROVIDER' | 'EXECUTED' | 'FAILED' | 'SKIPPED_IDEMPOTENT';
export interface FinancialImpact { readonly commitment: number; readonly scope: 'EXPERIMENT' | 'ENVELOPE' | 'NONE' }

export interface ExecutionActionIntent {
  readonly id: string;
  readonly organizationId: string;
  readonly envelopeId: string;
  readonly planHash: string;
  readonly channel: 'google';
  readonly actionType: AccionAutorizable;
  readonly entityType: EntityType;
  readonly materialEntityFingerprint: string;
  readonly providerPayload: GoogleMutationPayload | null;
  readonly financialImpact: FinancialImpact;
  readonly idempotencyKey: string;
  readonly validation: { decision: 'ALLOW' | 'DENY'; reasonCode: string | null };
  readonly status: ExecutionActionStatus;
  readonly createdAt: string;
}

/** Clave de idempotencia determinista: envelopeId + planHash + actionType + fingerprint + revision. */
export function idempotencyKey(envelopeId: string, planHash: string, actionType: string, fingerprint: string, revision = 0): string {
  return hashCanonical([envelopeId, planHash, actionType, fingerprint, revision]);
}

/**
 * Construye el ACTION PLAN completo (todas en PLANNED). No valida ni ejecuta: sólo materializa intents con su
 * fingerprint, payload Google traducido, e impacto financiero. La reserva del EXPERIMENTO va en ADJUST_DAILY_BUDGET.
 */
export function construirActionPlan(plan: MarketingPlan, env: AuthorizedExecutionEnvelope, customerId: string, ahora: string): ExecutionActionIntent[] {
  const fps = fingerprintsDelPlan(plan);
  const c0 = plan.campaigns[0];
  const out: ExecutionActionIntent[] = [];
  const push = (actionType: AccionAutorizable, entityType: EntityType, fp: string, material: Record<string, unknown>, financialImpact: FinancialImpact): void => {
    out.push({
      id: idempotencyKey(env.id, env.planHash, actionType, fp), organizationId: env.organizationId, envelopeId: env.id, planHash: env.planHash,
      channel: 'google', actionType, entityType, materialEntityFingerprint: fp,
      providerPayload: traducir({ actionType, customerId, currency: env.currency, material }), financialImpact,
      idempotencyKey: idempotencyKey(env.id, env.planHash, actionType, fp), validation: { decision: 'DENY', reasonCode: null }, status: 'PLANNED', createdAt: ahora,
    });
  };

  if (c0) {
    // La creación de la campaña incluye su budget ⇒ reserva el presupuesto del EXPERIMENTO (doble cap).
    push('CREATE_CAMPAIGN', 'campaign', fps.campaign, { name: c0.campaignName, campaignType: c0.campaignType, objective: c0.objective, budget: c0.budget }, { commitment: env.experimentBudget, scope: 'EXPERIMENT' });
    let adIdx = 0;
    c0.adGroups.forEach((g, i) => {
      push('CREATE_AD_GROUP', 'adGroup', fps.adGroups[i]!, { name: g.name, intent: g.intent }, { commitment: 0, scope: 'NONE' });
      g.ads.forEach((a) => { push('CREATE_AD', 'ad', fps.ads[adIdx]!, { headlines: a.headlines, descriptions: a.descriptions, finalUrl: g.finalDestination }, { commitment: 0, scope: 'NONE' }); adIdx += 1; });
    });
    plan.activeKeywords.forEach((k, i) => push('ADD_KEYWORD', 'keyword', fps.keywords[i]!, { text: k.text, matchType: k.matchType }, { commitment: 0, scope: 'NONE' }));
    (c0.negativeKeywords ?? []).forEach((n, i) => push('ADD_NEGATIVE_KEYWORD', 'negative', fps.negatives[i]!, { text: n.text, matchType: n.matchType }, { commitment: 0, scope: 'NONE' }));
  }
  return out;
}
