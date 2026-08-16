/**
 * apps/api · Registro del DISCOVERY real de activos Meta (Claude Chrome) — solo lectura, sin conexión.
 *
 * Inventario OBSERVED con IDs verificados (sin PII: sin email/teléfono/tokens/billing/leads). Reglas:
 *   · Instagram Profile ID ╪ IGSID: el IGSID de Graph permanece UNKNOWN (no se persiste el candidato);
 *   · App vs Dataset: no se consolida `APP_ID == DATASET_ID` — se marca REQUIRES_VERIFICATION;
 *   · descubrir ╪ conectar: `soecGraphConnection = NOT_CONNECTED`, todos los activos `estado NOT_CONFIGURED`;
 *   · el binding a una organización SOEC es EXPLÍCITO y humano (requiresConfirmation) — nunca por nombre;
 *   · C Y P: FOUNDATION_ABSENT bajo el perfil inspeccionado (no "no existe en Meta" universal);
 *   · SC Topografía: activo externo descubierto que NO se auto-vincula (prueba adversarial de aislamiento).
 */

import {
  activosMetaDe,
  clasificarFundacion,
  type ActivoMeta,
  type CapacidadesMeta,
  type ClaseFundacionMeta,
  type RelacionActivo,
  type RequisitoAcceso,
  type WhatsappApi,
  type WhatsappPresencia,
} from './meta-assets';

export type EstadoColisionAppDataset = 'VERIFIED_SAME_NUMBER' | 'PREVIOUS_READING_ERROR' | 'REQUIRES_VERIFICATION' | 'UNKNOWN';

export interface DescubrimientoMeta {
  readonly organizationId: string;
  /** Perfil admin único observado — nombre OMITIDO por privacidad (no se persiste PII). */
  readonly metaProfile: 'SINGLE_ADMIN_PROFILE';
  readonly activos: readonly ActivoMeta[];
  readonly capacidades: CapacidadesMeta;
  readonly claseFundacion: ClaseFundacionMeta;
  readonly relacion: RelacionActivo;
  readonly requisitoAcceso: RequisitoAcceso;
  readonly whatsappPresencia: WhatsappPresencia;
  readonly whatsappApi: WhatsappApi;
  readonly appDatasetColision: EstadoColisionAppDataset;
  readonly leadCampaignsExist: boolean;
  readonly leadFormsExist: boolean;
  /** SOEC NO está conectado a Graph. Descubrir no es conectar. */
  readonly soecGraphConnection: 'NOT_CONNECTED';
}

const SMILEFLOW_BUSINESS_ID = '934186066270538';

/** Capacidades reales de SmileFlow: orgánico sano; Ads restringido; API no conectada. NO cascadean. */
const CAPACIDADES_SMILEFLOW: CapacidadesMeta = {
  ORGANIC_FACEBOOK: 'AVAILABLE',
  ORGANIC_INSTAGRAM: 'AVAILABLE',
  META_ADS: 'RESTRICTED',
  LEAD_ADS: 'RESTRICTED',
  API_READ: 'NOT_CONNECTED',
  API_WRITE: 'NOT_CONNECTED',
};

const CAPACIDADES_ABSENT: CapacidadesMeta = {
  ORGANIC_FACEBOOK: 'NOT_CONFIGURED',
  ORGANIC_INSTAGRAM: 'NOT_CONFIGURED',
  META_ADS: 'NOT_CONFIGURED',
  LEAD_ADS: 'NOT_CONFIGURED',
  API_READ: 'NOT_CONFIGURED',
  API_WRITE: 'NOT_CONFIGURED',
};

function descubrimientoSmileflow(): DescubrimientoMeta {
  const activos = activosMetaDe('org-smileflow', 'smileflow-clinic', [
    { tipo: 'META_BUSINESS', externalId: SMILEFLOW_BUSINESS_ID, ownerBusinessId: SMILEFLOW_BUSINESS_ID, displayName: 'SmileFlow Clinic', externalStatus: 'RESTRICTED', procedencia: 'OBSERVED' },
    { tipo: 'FACEBOOK_PAGE', externalId: '61570785690749', ownerBusinessId: SMILEFLOW_BUSINESS_ID, displayName: 'Smileflow.clinic', externalStatus: 'EXISTS', procedencia: 'OBSERVED' },
    { tipo: 'INSTAGRAM_PROFILE', externalId: '33006160107', ownerBusinessId: SMILEFLOW_BUSINESS_ID, displayName: 'smileflow.clinic', externalStatus: 'EXISTS', procedencia: 'OBSERVED' },
    // IGSID (Graph): UNKNOWN — el candidato NO se persiste; se descubre por API con conexión autorizada.
    { tipo: 'INSTAGRAM_BUSINESS_ACCOUNT', externalId: null, externalStatus: 'UNKNOWN', procedencia: 'REQUIRES_VERIFICATION' },
    // Ad Account observada FUERA del portfolio (ownerBusinessId no demostrado).
    { tipo: 'META_AD_ACCOUNT', externalId: '1037025024374407', ownerBusinessId: null, externalStatus: 'EXISTS', procedencia: 'OBSERVED' },
    // Dataset: número observado pero NO distinguido de la App ⇒ REQUIRES_VERIFICATION.
    { tipo: 'DATASET', externalId: '972064645294895', externalStatus: 'UNKNOWN', procedencia: 'REQUIRES_VERIFICATION' },
    { tipo: 'META_APP', externalId: null, externalStatus: 'UNKNOWN', procedencia: 'REQUIRES_VERIFICATION' },
    { tipo: 'WHATSAPP_BUSINESS_ACCOUNT', externalId: null, externalStatus: 'EXISTS', procedencia: 'OBSERVED' },
    { tipo: 'LEAD_FORM', externalId: null, externalStatus: 'EXISTS', procedencia: 'OBSERVED' },
  ]);
  return {
    organizationId: 'org-smileflow',
    metaProfile: 'SINGLE_ADMIN_PROFILE',
    activos,
    capacidades: CAPACIDADES_SMILEFLOW,
    claseFundacion: clasificarFundacion(CAPACIDADES_SMILEFLOW),
    relacion: 'FIRST_PARTY',
    requisitoAcceso: 'TO_BE_DETERMINED_PER_PERMISSION',
    whatsappPresencia: 'VERIFIED_CONNECTED',
    whatsappApi: 'NOT_VERIFIED',
    appDatasetColision: 'REQUIRES_VERIFICATION',
    leadCampaignsExist: true,
    leadFormsExist: true,
    soecGraphConnection: 'NOT_CONNECTED',
  };
}

function descubrimientoAbsent(organizationId: string, businessKey: string): DescubrimientoMeta {
  return {
    organizationId,
    metaProfile: 'SINGLE_ADMIN_PROFILE',
    activos: activosMetaDe(organizationId, businessKey), // todos NOT_CONFIGURED / UNKNOWN
    capacidades: CAPACIDADES_ABSENT,
    claseFundacion: 'FOUNDATION_ABSENT',
    relacion: 'UNKNOWN',
    requisitoAcceso: 'TO_BE_DETERMINED_PER_PERMISSION',
    whatsappPresencia: 'NOT_OBSERVED',
    whatsappApi: 'NOT_CONNECTED',
    appDatasetColision: 'UNKNOWN',
    leadCampaignsExist: false,
    leadFormsExist: false,
    soecGraphConnection: 'NOT_CONNECTED',
  };
}

/**
 * Descubrimiento Meta por organización. SmileFlow tiene fundación descubierta (fragmentada/restringida
 * pero recuperable); C Y P: fundación ausente bajo el perfil inspeccionado; otras orgs: `null`.
 */
export function descubrimientoMetaDe(organizationId: string): DescubrimientoMeta | null {
  if (organizationId === 'org-smileflow') return descubrimientoSmileflow();
  if (organizationId === 'org-cyp') return descubrimientoAbsent('org-cyp', 'distribuidora-cyp');
  return null;
}

/**
 * Activo externo descubierto que NO pertenece a ningún tenant SOEC (SC Topografía). Prueba que el mismo
 * admin humano NO auto-vincula: `DO_NOT_BIND`. Sólo se registra el hecho, sin importar el activo.
 */
export interface ActivoExternoNoVinculado {
  readonly displayName: string;
  readonly pageId: string;
  readonly binding: 'DO_NOT_BIND';
  readonly boundToSoecOrg: null;
}

export const ACTIVOS_EXTERNOS_NO_VINCULADOS: readonly ActivoExternoNoVinculado[] = [
  { displayName: 'SC Topografía e Ingeniería', pageId: '100095553750707', binding: 'DO_NOT_BIND', boundToSoecOrg: null },
];
