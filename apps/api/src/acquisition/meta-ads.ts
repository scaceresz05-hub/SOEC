/**
 * apps/api · Contratos de LECTURA de Meta Ads (cuenta, campañas, insights) — repo-only, sin red.
 *
 * Representa lo YA PROBADO por Graph (ads_read Standard). Reglas duras:
 *   · el DINERO SIEMPRE lleva moneda (la cuenta es CLP, no USD) — imposible mezclar CLP con USD;
 *   · `campaign.status`/`effective_status` = ACTIVE **no** demuestra ENTREGA de anuncios: `deliveryState`
 *     es NOT_OBSERVED salvo evidencia a nivel de ad; nunca se infiere DELIVERING de un status ACTIVE;
 *   · `objective = OUTCOME_LEADS` **no** implica capacidad de retrieval de leads ni disponibilidad de PII;
 *   · `date_preset = maximum` **no** es "últimos 90 días" ni el lifetime exacto — se guarda provenance;
 *   · reutiliza la semántica de valor y el sanitizador de tokens de `meta-organic.ts` (no se duplican);
 *   · capability ╪ authorization: que ads_read funcione NO conecta ni autoriza a SOEC (writes LOCKED).
 */

import { type ClaseValorMetrica, type ValorMetrica, clasificarValorMetrica } from './meta-organic';

// --- Dinero (FASE 9): monto + moneda, siempre juntos ---
export interface Dinero {
  readonly amount: number;
  readonly currency: string;
}
export function dinero(amount: number, currency: string): Dinero {
  if (!currency || currency.length !== 3) throw new Error('Dinero exige una moneda ISO de 3 letras');
  return { amount, currency };
}
/** Guard para operar dos importes: distinta moneda ⇒ error (imposible mezclar CLP con USD). */
export function assertMismaMoneda(a: Dinero, b: Dinero): void {
  if (a.currency !== b.currency) throw new Error(`Monedas incompatibles: ${a.currency} vs ${b.currency}`);
}

/** Métrica monetaria con semántica de valor + moneda. `dinero` sólo no-null cuando clase es VALUE/ZERO. */
export interface ValorDinero {
  readonly clase: ClaseValorMetrica;
  readonly dinero: Dinero | null;
}

// --- Cuenta publicitaria (FASE 3) ---
export type RelacionNegocio = 'VERIFIED_BUSINESS' | 'VERIFIED_PERSONAL' | 'NO_BUSINESS_FIELD' | 'UNKNOWN';

export interface CuentaAdsMeta {
  readonly organizationId: string;
  readonly provider: 'meta';
  readonly externalAdAccountId: string;
  readonly name: string;
  readonly accountStatus: number;
  readonly currency: string;
  readonly timezoneName: string;
  readonly timezoneOffset: string;
  /** `NO_BUSINESS_FIELD` NO se convierte automáticamente en VERIFIED_PERSONAL. */
  readonly businessRelationship: RelacionNegocio;
}

// --- Campaña + semántica de estados (FASE 4-5) ---
export type CampaignConfiguredStatus = 'ACTIVE' | 'PAUSED' | 'DELETED' | 'ARCHIVED' | 'UNKNOWN';
export type CampaignEffectiveStatus =
  | 'ACTIVE'
  | 'PAUSED'
  | 'CAMPAIGN_PAUSED'
  | 'DISAPPROVED'
  | 'WITH_ISSUES'
  | 'IN_PROCESS'
  | 'COMPLETED'
  | 'UNKNOWN';

/** Estado de ENTREGA — distinto del status configurado/efectivo de la campaña. */
export type DeliveryState = 'DELIVERING' | 'NOT_DELIVERING' | 'COMPLETED' | 'ERROR' | 'PAUSED' | 'UNKNOWN' | 'NOT_OBSERVED';

export interface CampanaAdsMeta {
  readonly organizationId: string;
  readonly provider: 'meta';
  readonly externalAdAccountId: string;
  readonly externalCampaignId: string;
  readonly name: string | null;
  readonly objective: string;
  readonly configuredStatus: CampaignConfiguredStatus;
  readonly effectiveStatus: CampaignEffectiveStatus;
  /** Entrega: NOT_OBSERVED con sólo evidencia a nivel de campaña. NUNCA se deriva de un status ACTIVE. */
  readonly deliveryState: DeliveryState;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
  readonly hasLeadObjective: boolean;
}

/** Clave tenant-safe de una campaña. Misma campaignId en otra org NO colisiona. */
export function claveCampana(
  c: Pick<CampanaAdsMeta, 'organizationId' | 'provider' | 'externalAdAccountId' | 'externalCampaignId'>,
): string {
  return `${c.organizationId}:${c.provider}:${c.externalAdAccountId}:${c.externalCampaignId}`;
}

/**
 * Con SÓLO evidencia a nivel de campaña, el estado de entrega es NOT_OBSERVED. Esta función NUNCA
 * devuelve DELIVERING a partir de `status`/`effective_status` — la entrega se demuestra a nivel de ad.
 */
export function deliveryStateDesdeCampaign(_configured: CampaignConfiguredStatus, _effective: CampaignEffectiveStatus): DeliveryState {
  return 'NOT_OBSERVED';
}

// --- Lead semantics (FASE 7) ---
export interface CapacidadLeadAds {
  readonly hasLeadObjectiveCampaign: boolean;
  readonly leadRetrievalCapability: 'NOT_TESTED' | 'AVAILABLE' | 'FORBIDDEN' | 'UNKNOWN';
  readonly piiAvailable: 'UNKNOWN' | 'NOT_READ' | 'AVAILABLE';
}

// --- Insights agregados (FASE 8) + provenance de rango (FASE 11) ---
export type RequestedRangeType = 'MAXIMUM' | 'LAST_7_DAYS' | 'LAST_90_DAYS' | 'CUSTOM' | 'UNKNOWN';
export interface ProvenanciaRango {
  readonly requestedRangeType: RequestedRangeType;
  readonly returnedDateStart: string | null;
  readonly returnedDateStop: string | null;
}

export interface AdsInsights {
  readonly externalAdAccountId: string;
  readonly provenance: ProvenanciaRango;
  readonly impressions: ValorMetrica;
  readonly reach: ValorMetrica;
  readonly frequency: ValorMetrica;
  readonly clicks: ValorMetrica;
  readonly ctr: ValorMetrica;
  readonly spend: ValorDinero;
  readonly cpc: ValorDinero;
  readonly cpm: ValorDinero;
  /** Actions (leads/messages/conversions) NO probadas — no se fabrican. */
  readonly actions: 'NOT_TESTED';
}

// ---------------------------------------------------------------------------
// EVIDENCIA VERIFICADA (fixture — contenido público de negocio, NO secreto, sin PII)
// ---------------------------------------------------------------------------

const ORG = 'org-smileflow';
const AD_ACCOUNT = '1037025024374407';

export const CUENTA_ADS_SMILEFLOW: CuentaAdsMeta = {
  organizationId: ORG,
  provider: 'meta',
  externalAdAccountId: AD_ACCOUNT,
  name: 'Caceres SC',
  accountStatus: 1,
  currency: 'CLP',
  timezoneName: 'America/Santiago',
  timezoneOffset: 'UTC-4',
  businessRelationship: 'NO_BUSINESS_FIELD', // campo business ausente ⇒ NO se asume personal
};

function campana(id: string, objective: string, cfg: CampaignConfiguredStatus, eff: CampaignEffectiveStatus): CampanaAdsMeta {
  return {
    organizationId: ORG,
    provider: 'meta',
    externalAdAccountId: AD_ACCOUNT,
    externalCampaignId: id,
    name: null, // nombres promocionales no necesarios como evidencia
    objective,
    configuredStatus: cfg,
    effectiveStatus: eff,
    deliveryState: deliveryStateDesdeCampaign(cfg, eff), // NOT_OBSERVED
    createdAt: null,
    updatedAt: null,
    hasLeadObjective: objective === 'OUTCOME_LEADS',
  };
}

export const CAMPANAS_ADS_SMILEFLOW: readonly CampanaAdsMeta[] = [
  campana('120246877650170097', 'OUTCOME_LEADS', 'PAUSED', 'PAUSED'),
  campana('120246449950670097', 'OUTCOME_LEADS', 'ACTIVE', 'ACTIVE'),
  campana('120242921559350097', 'MESSAGES', 'ACTIVE', 'ACTIVE'),
];

export const INSIGHTS_ADS_SMILEFLOW: AdsInsights = {
  externalAdAccountId: AD_ACCOUNT,
  provenance: { requestedRangeType: 'MAXIMUM', returnedDateStart: '2023-07-31', returnedDateStop: '2026-08-16' },
  impressions: clasificarValorMetrica({ present: true, value: 1697 }),
  reach: clasificarValorMetrica({ present: true, value: 1216 }),
  frequency: clasificarValorMetrica({ present: true, value: 1.395559 }),
  clicks: clasificarValorMetrica({ present: true, value: 58 }),
  ctr: clasificarValorMetrica({ present: true, value: 3.417796 }),
  spend: { clase: 'VALUE', dinero: dinero(9741, 'CLP') },
  cpc: { clase: 'VALUE', dinero: dinero(167.948276, 'CLP') },
  cpm: { clase: 'VALUE', dinero: dinero(5740.129641, 'CLP') },
  actions: 'NOT_TESTED',
};

export const CAPACIDAD_LEAD_ADS_SMILEFLOW: CapacidadLeadAds = {
  hasLeadObjectiveCampaign: CAMPANAS_ADS_SMILEFLOW.some((c) => c.hasLeadObjective), // true
  leadRetrievalCapability: 'NOT_TESTED', // OUTCOME_LEADS ╪ retrieval
  piiAvailable: 'NOT_READ',
};

// --- Frontera read/write (FASE 15-16): capability ╪ authorization; escritura BLOQUEADA ---
export const ADS_READ_CAPABILITY = 'AVAILABLE' as const;
export const ADS_WRITE_ADAPTER = 'LOCKED' as const;
export const ADS_MANAGEMENT_PERMISSION = 'NOT_GRANTED' as const;
export const LEADS_RETRIEVAL_PERMISSION = 'NOT_GRANTED' as const;
export const ORGANIZATION_CONNECTION_STATUS = 'NOT_CONNECTED' as const;
export const PRODUCTION_AUTHORIZATION = 'NOT_GRANTED' as const;
