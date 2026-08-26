/**
 * apps/api · campana · TRADUCTOR Google Ads (PURO). Convierte una ExecutionActionIntent en un modelo de
 * mutation request de Google Ads. SEPARA la TRADUCCIÓN de la MUTACIÓN DE RED: el payload puede inspeccionarse
 * sin enviarse. En Fase 2A NINGÚN camino llama a la red.
 *
 * SEMÁNTICA DE PRESUPUESTO (P0): el experimento de búsqueda usa CAMPAIGN TOTAL BUDGET, no daily budget.
 * `CREATE_CAMPAIGN` es UNA acción autorizada que se materializa en DOS operaciones Google encadenadas:
 * `campaign_budget.create` (CUSTOM_PERIOD + total_amount_micros + explicitly_shared=false) y `campaign.create`
 * (referencia al budget + start/end date + SEARCH). Es IMPOSIBLE emitir a la vez `amount_micros` (daily) y
 * `total_amount_micros` (total): un budget con ambos modos falla cerrado con BUDGET_MODE_CONFLICT.
 *
 * SEMÁNTICA DE DETENCIÓN: `STOP_CAMPAIGN`/`PAUSE_*` traducen a `*.mutate` con `status = PAUSED` explícito —
 * NUNCA `REMOVED`/`DELETE`. No existe ninguna operación de borrado en este traductor. `STOP_CAMPAIGN` marca
 * además `experimentStatus = STOPPED` (fin del experimento; sin auto-resume; RESUME no está autorizada).
 */
import type { AccionAutorizable } from './acciones';
import type { BudgetPolicy } from './marketing-plan';

export interface GoogleMutationPayload {
  readonly customerId: string;
  readonly operation: string; // p.ej. 'campaign.create'
  readonly resourceType: string; // campaign | ad_group | ad_group_ad | ad_group_criterion | campaign_criterion | campaign_budget
  /**
   * Target lógico del padre (AD GROUP) por fingerprint material. En SHADOW NO hay providerResourceId. En REAL
   * (Fase 2B) el ejecutor RESUELVE `providerResourceId` desde el binding del padre creado por ESTE envelope antes
   * de mutar; nunca se inventa antes de la respuesta de Google.
   */
  readonly parentAdGroup?: { readonly materialFingerprint: string; readonly logicalName?: string; readonly providerResourceId?: string };
  readonly fields: Readonly<Record<string, unknown>>;
}

export interface EntradaTraduccion {
  readonly actionType: AccionAutorizable;
  readonly customerId: string;
  readonly currency: string;
  readonly material: Readonly<Record<string, unknown>>;
  readonly parentAdGroup?: { readonly materialFingerprint: string; readonly logicalName?: string };
}

/** Sub-payload de presupuesto de Google (CAMPAIGN TOTAL). Nunca coexiste con un daily amount. */
export interface CampaignTotalBudgetPayload {
  readonly operation: 'campaign_budget.create';
  readonly resourceType: 'campaign_budget';
  readonly period: 'CUSTOM_PERIOD';
  readonly totalAmountMicros: number;
  readonly explicitlyShared: false;
}

/**
 * Convierte un monto de moneda ENTERA (CLP: sin decimales) a micros de Google (× 1.000.000). Fail-closed ante
 * moneda distinta a la esperada, monto no entero (decimal inesperado), monto ≤ 0, o desbordamiento de enteros.
 * Ej.: CLP 15000 → 15_000_000_000 micros.
 */
export function montoAMicros(amount: number, currency: string, expectedCurrency: string): number {
  if (currency !== expectedCurrency) throw new Error(`CURRENCY_MISMATCH: ${currency} ≠ ${expectedCurrency}`);
  if (typeof amount !== 'number' || !Number.isFinite(amount)) throw new Error('BUDGET_AMOUNT_INVALID: no numérico');
  if (!Number.isInteger(amount)) throw new Error('BUDGET_AMOUNT_INVALID: decimal inesperado');
  if (amount <= 0) throw new Error('BUDGET_AMOUNT_INVALID: total ≤ 0');
  const micros = amount * 1_000_000;
  if (!Number.isSafeInteger(micros)) throw new Error('BUDGET_AMOUNT_OVERFLOW');
  return micros;
}

/** Construye el sub-payload de CAMPAIGN TOTAL BUDGET. Fail-closed: nunca emite un modo diario junto al total. */
export function budgetCampaignTotal(policy: BudgetPolicy, expectedCurrency: string): CampaignTotalBudgetPayload {
  if (policy.type !== 'CAMPAIGN_TOTAL') throw new Error(`BUDGET_MODE_UNSUPPORTED: ${policy.type}`);
  const totalAmountMicros = montoAMicros(policy.totalAmount, policy.currency, expectedCurrency);
  const budget: CampaignTotalBudgetPayload = { operation: 'campaign_budget.create', resourceType: 'campaign_budget', period: 'CUSTOM_PERIOD', totalAmountMicros, explicitlyShared: false };
  // GUARD (§13): imposible serializar simultáneamente daily (amount_micros) y total (total_amount_micros).
  const claves = Object.keys(budget);
  if (claves.includes('amountMicros') || claves.includes('amount_micros') || claves.includes('dailyAmountMicros')) throw new Error('BUDGET_MODE_CONFLICT');
  return budget;
}

const OP: Partial<Record<AccionAutorizable, { operation: string; resourceType: string }>> = {
  CREATE_CAMPAIGN: { operation: 'campaign.create', resourceType: 'campaign' },
  CREATE_AD_GROUP: { operation: 'ad_group.create', resourceType: 'ad_group' },
  CREATE_AD: { operation: 'ad_group_ad.create', resourceType: 'ad_group_ad' },
  ADD_KEYWORD: { operation: 'ad_group_criterion.create', resourceType: 'ad_group_criterion' },
  ADD_NEGATIVE_KEYWORD: { operation: 'campaign_criterion.create', resourceType: 'campaign_criterion' },
  // ADJUST_DAILY_BUDGET NO se traduce: el experimento usa total budget (no hay daily). Sin entrada ⇒ null.
  PAUSE_CAMPAIGN: { operation: 'campaign.mutate', resourceType: 'campaign' },
  PAUSE_AD_GROUP: { operation: 'ad_group.mutate', resourceType: 'ad_group' },
  PAUSE_KEYWORD: { operation: 'ad_group_criterion.mutate', resourceType: 'ad_group_criterion' },
  STOP_CAMPAIGN: { operation: 'campaign.mutate', resourceType: 'campaign' },
};

/** Acciones de pausa/detención: mutan `status = PAUSED` (jamás borran). STOP marca además fin de experimento. */
const STATUS_PAUSADO: Partial<Record<AccionAutorizable, Record<string, unknown>>> = {
  PAUSE_CAMPAIGN: { status: 'PAUSED' },
  PAUSE_AD_GROUP: { status: 'PAUSED' },
  PAUSE_KEYWORD: { status: 'PAUSED' },
  STOP_CAMPAIGN: { status: 'PAUSED', experimentStatus: 'STOPPED' },
};

/**
 * Traduce (sin enviar). Devuelve null si la acción no es traducible (p.ej. ADJUST_DAILY_BUDGET, que no aplica a
 * un experimento con total budget). CREATE_CAMPAIGN compone budget (total) + campaign en un solo payload.
 */
export function traducir(e: EntradaTraduccion): GoogleMutationPayload | null {
  const op = OP[e.actionType];
  if (!op) return null;

  if (e.actionType === 'CREATE_CAMPAIGN') {
    const policy = e.material.budgetPolicy as BudgetPolicy | undefined;
    if (!policy) throw new Error('CREATE_CAMPAIGN_SIN_BUDGET_POLICY');
    const budget = budgetCampaignTotal(policy, e.currency);
    const fields = {
      name: e.material.name,
      campaignType: e.material.campaignType ?? 'SEARCH',
      objective: e.material.objective,
      status: 'ENABLED',
      // Fechas de ejecución: se RESUELVEN en la activación del sobre (null en SHADOW pre-activación).
      startDate: e.material.startDate ?? null,
      endDate: e.material.endDate ?? null,
      budgetPolicy: policy.type,
      budget, // sub-operation campaign_budget.create (CUSTOM_PERIOD, total_amount_micros, explicitly_shared=false)
    };
    return { customerId: e.customerId, operation: op.operation, resourceType: op.resourceType, fields };
  }

  const statusFields = STATUS_PAUSADO[e.actionType] ?? {};
  return {
    customerId: e.customerId, operation: op.operation, resourceType: op.resourceType,
    ...(e.parentAdGroup ? { parentAdGroup: e.parentAdGroup } : {}),
    fields: { ...e.material, ...statusFields },
  };
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
