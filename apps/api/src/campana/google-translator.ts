/**
 * apps/api · campana · TRADUCTOR Google Ads (PURO). Convierte una ExecutionActionIntent en un modelo de
 * mutation request de Google Ads. SEPARA la TRADUCCIÓN de la MUTACIÓN DE RED: el payload puede inspeccionarse
 * sin enviarse. En Fase 2A NINGÚN camino llama a la red.
 */
import type { AccionAutorizable } from './acciones';

export interface GoogleMutationPayload {
  readonly customerId: string;
  readonly operation: string; // p.ej. 'campaign.create'
  readonly resourceType: string; // campaign | ad_group | ad_group_ad | ad_group_criterion | campaign_criterion | campaign_budget
  /** Target lógico del padre (AD GROUP) por fingerprint material. En SHADOW NO hay providerResourceId (Fase 2B). */
  readonly parentAdGroup?: { readonly materialFingerprint: string; readonly logicalName?: string };
  readonly fields: Readonly<Record<string, unknown>>;
}

export interface EntradaTraduccion {
  readonly actionType: AccionAutorizable;
  readonly customerId: string;
  readonly currency: string;
  readonly material: Readonly<Record<string, unknown>>;
  readonly parentAdGroup?: { readonly materialFingerprint: string; readonly logicalName?: string };
}

const OP: Partial<Record<AccionAutorizable, { operation: string; resourceType: string }>> = {
  CREATE_CAMPAIGN: { operation: 'campaign.create', resourceType: 'campaign' },
  CREATE_AD_GROUP: { operation: 'ad_group.create', resourceType: 'ad_group' },
  CREATE_AD: { operation: 'ad_group_ad.create', resourceType: 'ad_group_ad' },
  ADD_KEYWORD: { operation: 'ad_group_criterion.create', resourceType: 'ad_group_criterion' },
  ADD_NEGATIVE_KEYWORD: { operation: 'campaign_criterion.create', resourceType: 'campaign_criterion' },
  ADJUST_DAILY_BUDGET: { operation: 'campaign_budget.mutate', resourceType: 'campaign_budget' },
  PAUSE_CAMPAIGN: { operation: 'campaign.mutate', resourceType: 'campaign' },
  PAUSE_AD_GROUP: { operation: 'ad_group.mutate', resourceType: 'ad_group' },
  PAUSE_KEYWORD: { operation: 'ad_group_criterion.mutate', resourceType: 'ad_group_criterion' },
  STOP_CAMPAIGN: { operation: 'campaign.mutate', resourceType: 'campaign' },
};

/** Traduce (sin enviar). Devuelve null si la acción no es traducible (no debería ocurrir con acciones autorizadas). */
export function traducir(e: EntradaTraduccion): GoogleMutationPayload | null {
  const op = OP[e.actionType];
  if (!op) return null;
  return { customerId: e.customerId, operation: op.operation, resourceType: op.resourceType, ...(e.parentAdGroup ? { parentAdGroup: e.parentAdGroup } : {}), fields: e.material };
}

/** Puerto de mutación real (Google Ads). En Fase 2A NO se invoca por ningún camino productivo. */
export interface GoogleAdsMutatePort {
  mutate(payload: GoogleMutationPayload): Promise<{ resourceName: string }>;
}

/** Implementación SHADOW: registra que fue llamada pero NUNCA muta en red. Si el motor la invocara (no debe), falla cerrado. */
export class ShadowMutatePort implements GoogleAdsMutatePort {
  public calls = 0;
  async mutate(): Promise<{ resourceName: string }> {
    this.calls += 1;
    throw new Error('SHADOW: mutate de proveedor deshabilitado (no se realizan escrituras reales en Fase 2A)');
  }
}
