/**
 * apps/api · campana · EXECUTION ACTION INTENT (PURO). Traduce un PLAN APROBADO + ENVELOPE en acciones de
 * Google Ads con jerarquía CAMPAIGN → AD_GROUP → AD/KEYWORD: ads y keywords referencian su AD GROUP padre por
 * fingerprint material + `dependsOn`. Construir el plan NO ejecuta nada; en SHADOW no se resuelve ningún
 * providerResourceId real.
 */
import { fingerprint, fingerprintsDelPlan, adGroupFingerprint, adFingerprint, keywordFingerprint, adGroupPadreDeKeyword, type EntityType } from './material-fingerprint';
import { traducir, type GoogleMutationPayload } from './google-translator';
import { hashCanonical } from './plan-hash';
import type { MarketingPlan } from './marketing-plan';
import type { AuthorizedExecutionEnvelope } from './authorized-execution-envelope';
import type { AccionAutorizable } from './acciones';

export type ExecutionActionStatus = 'PLANNED' | 'VALIDATED' | 'BLOCKED' | 'READY_FOR_PROVIDER' | 'EXECUTED' | 'FAILED' | 'SKIPPED_IDEMPOTENT';
export interface FinancialImpact { readonly commitment: number; readonly scope: 'EXPERIMENT' | 'ENVELOPE' | 'NONE' }
export interface ParentRef { readonly entityType: 'AD_GROUP'; readonly materialFingerprint: string; readonly logicalName?: string }
export interface Dependency { readonly actionType: AccionAutorizable; readonly materialFingerprint: string }

export interface ExecutionActionIntent {
  readonly id: string;
  readonly organizationId: string;
  readonly envelopeId: string;
  readonly planHash: string;
  readonly channel: 'google';
  readonly actionType: AccionAutorizable;
  readonly entityType: EntityType;
  readonly materialEntityFingerprint: string;
  readonly parent: ParentRef | null;
  readonly dependsOn: readonly Dependency[];
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
 * Construye el ACTION PLAN (todas en PLANNED). Ads y keywords quedan ligadas a su AD GROUP padre por
 * fingerprint (identidad lógica; sin providerResourceId en SHADOW). El budget del experimento va en CREATE_CAMPAIGN.
 */
export function construirActionPlan(plan: MarketingPlan, env: AuthorizedExecutionEnvelope, customerId: string, ahora: string): ExecutionActionIntent[] {
  const c0 = plan.campaigns[0];
  const out: ExecutionActionIntent[] = [];
  const push = (
    actionType: AccionAutorizable, entityType: EntityType, fp: string, material: Record<string, unknown>,
    financialImpact: FinancialImpact, parent: ParentRef | null, dependsOn: Dependency[],
  ): void => {
    const key = idempotencyKey(env.id, env.planHash, actionType, fp);
    out.push({
      id: key, organizationId: env.organizationId, envelopeId: env.id, planHash: env.planHash,
      channel: 'google', actionType, entityType, materialEntityFingerprint: fp, parent, dependsOn,
      providerPayload: traducir({ actionType, customerId, currency: env.currency, material, ...(parent ? { parentAdGroup: { materialFingerprint: parent.materialFingerprint, ...(parent.logicalName ? { logicalName: parent.logicalName } : {}) } } : {}) }),
      financialImpact, idempotencyKey: key, validation: { decision: 'DENY', reasonCode: null }, status: 'PLANNED', createdAt: ahora,
    });
  };

  if (c0) {
    // Campaña: CAMPAIGN TOTAL BUDGET (CUSTOM_PERIOD) ⇒ reserva el experimento completo. Las fechas de ejecución
    // se resuelven al ACTIVAR el sobre (env.startsAt/expiresAt); en SHADOW pre-activación son null.
    const campaignFingerprint = fingerprintsDelPlan(plan).campaign;
    push('CREATE_CAMPAIGN', 'campaign', campaignFingerprint, { name: c0.campaignName, campaignType: c0.campaignType, objective: c0.objective, budgetPolicy: c0.budgetPolicy, startDate: env.startsAt, endDate: env.expiresAt }, { commitment: env.experimentBudget, scope: 'EXPERIMENT' }, null, []);

    c0.adGroups.forEach((g) => {
      const parentFp = adGroupFingerprint(g);
      const parentRef: ParentRef = { entityType: 'AD_GROUP', materialFingerprint: parentFp, logicalName: g.name };
      const dep: Dependency[] = [{ actionType: 'CREATE_AD_GROUP', materialFingerprint: parentFp }];
      push('CREATE_AD_GROUP', 'adGroup', parentFp, { name: g.name, intent: g.intent }, { commitment: 0, scope: 'NONE' }, null, []);
      g.ads.forEach((a) => push('CREATE_AD', 'ad', adFingerprint(parentFp, a, g.finalDestination), { headlines: a.headlines, descriptions: a.descriptions, finalUrl: g.finalDestination }, { commitment: 0, scope: 'NONE' }, parentRef, dep));
    });

    plan.activeKeywords.forEach((k) => {
      const g = adGroupPadreDeKeyword(plan, k);
      const parentFp = g ? adGroupFingerprint(g) : '';
      const parentRef: ParentRef | null = g ? { entityType: 'AD_GROUP', materialFingerprint: parentFp, logicalName: g.name } : null;
      const dep: Dependency[] = g ? [{ actionType: 'CREATE_AD_GROUP', materialFingerprint: parentFp }] : [];
      push('ADD_KEYWORD', 'keyword', keywordFingerprint(parentFp, k), { text: k.text, matchType: k.matchType }, { commitment: 0, scope: 'NONE' }, parentRef, dep);
    });

    (c0.negativeKeywords ?? []).forEach((n) => push('ADD_NEGATIVE_KEYWORD', 'negative', fingerprint('negative', [n.text, n.matchType]), { text: n.text, matchType: n.matchType }, { commitment: 0, scope: 'NONE' }, null, []));
  }
  return out;
}
