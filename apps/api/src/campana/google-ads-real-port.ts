/**
 * apps/api · campana · PUERTO GOOGLE ADS REAL (Fase 2B). Implementa `GoogleAdsMutatePort` consumiendo EXACTAMENTE
 * el `GoogleMutationPayload` certificado en SHADOW — NO hay un segundo traductor divergente. La ÚNICA diferencia
 * con SHADOW es que este puerto SÍ envía (a través de un `GoogleAdsApiClient` de bajo nivel). El cliente real NO
 * se cablea en esta fase: sin cliente el puerto no existe ⇒ la carretera está construida y la barrera cerrada.
 *
 * CREATE_CAMPAIGN se materializa en DOS operaciones Google encadenadas y en orden: primero `campaign_budget.create`
 * (CAMPAIGN TOTAL BUDGET: CUSTOM_PERIOD + total_amount_micros + explicitly_shared=false; NUNCA amount_micros/daily)
 * y luego `campaign.create` referenciando el budget creado. El resto son una sola operación. Para ads/keywords el
 * ejecutor debe haber resuelto el `providerResourceId` real del AD GROUP padre (creado por ESTE envelope).
 */
import type { GoogleAdsMutatePort, GoogleMutationPayload, CampaignTotalBudgetPayload } from './google-translator';

/** Operación Google de bajo nivel (una sola). El cliente real la envía; el fake de tests la registra. */
export interface GoogleAdsOperation {
  readonly customerId: string;
  readonly operation: string;
  readonly resourceType: string;
  readonly fields: Readonly<Record<string, unknown>>;
}

/** Cliente Google Ads de bajo nivel. En producción NO se provee (sin credenciales de escritura ⇒ puerto inerte). */
export interface GoogleAdsApiClient {
  aplicar(op: GoogleAdsOperation): Promise<{ resourceName: string }>;
}

const CLAVES_DAILY = ['amountMicros', 'amount_micros', 'dailyAmountMicros', 'dailyBudget', 'averageDailyBudget'];

/** Verifica que un budget sea SÓLO total (CUSTOM_PERIOD + total_amount_micros); jamás daily. Fail-closed. */
function verificarBudgetTotal(budget: CampaignTotalBudgetPayload): void {
  if (budget.period !== 'CUSTOM_PERIOD') throw new Error('BUDGET_MODE_CONFLICT: period no es CUSTOM_PERIOD');
  if (!(typeof budget.totalAmountMicros === 'number' && budget.totalAmountMicros > 0)) throw new Error('BUDGET_MODE_CONFLICT: total_amount_micros inválido');
  if (budget.explicitlyShared !== false) throw new Error('BUDGET_MODE_CONFLICT: explicitly_shared debe ser false');
  const claves = Object.keys(budget as object);
  for (const k of CLAVES_DAILY) if (claves.includes(k)) throw new Error('BUDGET_MODE_CONFLICT: modo daily presente');
}

export class GoogleAdsRealMutatePort implements GoogleAdsMutatePort {
  public calls = 0;
  constructor(private readonly client: GoogleAdsApiClient) {}

  async mutate(payload: GoogleMutationPayload): Promise<{ resourceName: string }> {
    this.calls += 1;

    // CREATE_CAMPAIGN ⇒ campaign_budget.create ANTES que campaign.create (orden estricto).
    if (payload.operation === 'campaign.create') {
      const budget = (payload.fields as { budget?: CampaignTotalBudgetPayload }).budget;
      if (!budget) throw new Error('CREATE_CAMPAIGN_SIN_BUDGET');
      verificarBudgetTotal(budget);
      const bRes = await this.client.aplicar({ customerId: payload.customerId, operation: budget.operation, resourceType: budget.resourceType, fields: { period: budget.period, totalAmountMicros: budget.totalAmountMicros, explicitlyShared: budget.explicitlyShared } });
      const camposCampaign: Record<string, unknown> = { ...(payload.fields as Record<string, unknown>) };
      delete camposCampaign.budget; // el budget se materializó como recurso propio; la campaña lo referencia por resourceName
      const cRes = await this.client.aplicar({ customerId: payload.customerId, operation: payload.operation, resourceType: payload.resourceType, fields: { ...camposCampaign, campaignBudget: bRes.resourceName } });
      return { resourceName: cRes.resourceName };
    }

    // Ads/keywords: exigen el AD GROUP padre REAL ya resuelto por el ejecutor (fail-closed si falta).
    const requierePadre = payload.operation === 'ad_group_ad.create' || payload.operation === 'ad_group_criterion.create';
    const parentRid = payload.parentAdGroup?.providerResourceId;
    if (requierePadre && !parentRid) throw new Error('PARENT_PROVIDER_RESOURCE_NOT_BOUND');
    const fields = requierePadre ? { ...payload.fields, adGroup: parentRid } : payload.fields;
    return this.client.aplicar({ customerId: payload.customerId, operation: payload.operation, resourceType: payload.resourceType, fields });
  }
}
