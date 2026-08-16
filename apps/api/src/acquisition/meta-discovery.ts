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

export type EstadoColisionAppDataset =
  | 'VERIFIED_SAME_NUMBER'
  | 'PREVIOUS_READING_ERROR'
  | 'REQUIRES_VERIFICATION'
  | 'APP_CONFIRMED_DATASET_UNVERIFIED'
  | 'UNKNOWN';

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
  // --- Evidencia Graph verificada (bloque de discriminación de Pages) ---
  /** El nodo del Business responde 200 por Graph pese a la restricción de Ads/UI. */
  readonly businessGraphReadable: boolean;
  /** ¿La restricción del portfolio se propaga a la lectura Graph? Evidencia: NO para el nodo del negocio. */
  readonly restrictionPropagatesToGraphRead: 'NO' | 'YES' | 'NOT_DEMONSTRABLE';
  /** `/{business-id}/owned_pages` exige `business_management` (Meta nombró el permiso; no es restricción). */
  readonly businessOwnedPageReadGate: 'REQUIRES_business_management' | 'GRANTED' | 'UNKNOWN';
  /** Estado del permiso `business_management` en el token de prueba. */
  readonly businessManagementStatus: 'PERMISSION_MISSING' | 'GRANTED' | 'NOT_OFFERED_BY_OAUTH' | 'UNKNOWN';
  /** Page ID canónico de Graph — UNKNOWN hasta que `owned_pages` (con business_management) lo devuelva. */
  readonly smileflowGraphPageId: string | null;
  /** ID visto en la UI (`profile.php?id=`), NO confirmado como Graph Page ID. */
  readonly smileflowLegacyPageUiId: string | null;
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
    // La Page EXISTE, pero su Page ID de Graph es UNKNOWN: 61570785690749 es un id de UI (profile.php),
    // no confirmado por Graph. El id canónico llega con owned_pages (requiere business_management).
    { tipo: 'FACEBOOK_PAGE', externalId: null, ownerBusinessId: SMILEFLOW_BUSINESS_ID, displayName: 'Smileflow.clinic', externalStatus: 'EXISTS', procedencia: 'REQUIRES_VERIFICATION' },
    { tipo: 'INSTAGRAM_PROFILE', externalId: '33006160107', ownerBusinessId: SMILEFLOW_BUSINESS_ID, displayName: 'smileflow.clinic', externalStatus: 'EXISTS', procedencia: 'OBSERVED' },
    // IGSID (Graph): UNKNOWN — el candidato NO se persiste; se descubre por API con conexión autorizada.
    { tipo: 'INSTAGRAM_BUSINESS_ACCOUNT', externalId: null, externalStatus: 'UNKNOWN', procedencia: 'REQUIRES_VERIFICATION' },
    // Ad Account observada FUERA del portfolio (ownerBusinessId no demostrado).
    { tipo: 'META_AD_ACCOUNT', externalId: '1037025024374407', ownerBusinessId: null, externalStatus: 'EXISTS', procedencia: 'OBSERVED' },
    // Dataset: relación con la App aún sin distinguir ⇒ REQUIRES_VERIFICATION.
    { tipo: 'DATASET', externalId: '972064645294895', externalStatus: 'UNKNOWN', procedencia: 'REQUIRES_VERIFICATION' },
    // App CONFIRMADA por Graph/consola: 972064645294895 ("SmileFlow", Development).
    { tipo: 'META_APP', externalId: '972064645294895', externalStatus: 'EXISTS', procedencia: 'OBSERVED' },
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
    appDatasetColision: 'APP_CONFIRMED_DATASET_UNVERIFIED',
    leadCampaignsExist: true,
    leadFormsExist: true,
    soecGraphConnection: 'NOT_CONNECTED',
    businessGraphReadable: true, // GET /934186066270538 → 200 OK
    restrictionPropagatesToGraphRead: 'NO', // el nodo del negocio se lee pese a la restricción de Ads/UI
    businessOwnedPageReadGate: 'REQUIRES_business_management',
    businessManagementStatus: 'PERMISSION_MISSING', // no llegó al token de prueba; grantabilidad PENDING
    smileflowGraphPageId: null, // UNKNOWN hasta owned_pages con business_management
    smileflowLegacyPageUiId: '61570785690749', // id de UI, NO confirmado como Graph Page ID
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
    businessGraphReadable: false,
    restrictionPropagatesToGraphRead: 'NOT_DEMONSTRABLE',
    businessOwnedPageReadGate: 'UNKNOWN',
    businessManagementStatus: 'UNKNOWN',
    smileflowGraphPageId: null,
    smileflowLegacyPageUiId: null,
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
