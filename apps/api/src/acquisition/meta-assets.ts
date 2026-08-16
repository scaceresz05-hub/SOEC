/**
 * apps/api · Modelo de ACTIVOS Meta (read-only) — SIN conexión, SIN red, SIN tokens.
 *
 * Endurecido tras el discovery real (Claude Chrome). Reglas:
 *   · activos Meta DISTINTOS y separados (nunca un único `metaAccountId`); Instagram Profile ID ╪ IGSID
 *     (Business Account ID de Graph): se modelan por SEPARADO y el IGSID permanece UNKNOWN hasta Graph;
 *   · CAPACIDADES independientes por eje (organic FB, organic IG, ads, lead ads, api read/write): que
 *     `META_ADS = RESTRICTED` NO implica `ORGANIC_INSTAGRAM = RESTRICTED` ni `API_READ = RESTRICTED`;
 *   · "activo existe" (externalStatus) ╪ "SOEC conectado" (estado): descubrir no es vincular;
 *   · binding SIEMPRE explícito, tenant-scoped, por ID (nunca por nombre ni por admin humano compartido);
 *   · credenciales por referencia opaca; sin valores; el mapeo de `action_type` nunca suma-todo.
 * La implementación real de las llamadas Graph NO vive aquí (requiere App + App Review + Business
 * Verification + OAuth humano). Ver META-READ-ONLY-ONBOARDING.md.
 */

export type TipoActivoMeta =
  | 'META_BUSINESS' // Business Portfolio / Business Manager
  | 'FACEBOOK_PAGE'
  | 'INSTAGRAM_PROFILE' // id del perfil visible (NO sirve para Graph)
  | 'INSTAGRAM_BUSINESS_ACCOUNT' // IGSID de Graph — se descubre por API
  | 'META_AD_ACCOUNT'
  | 'META_PIXEL'
  | 'DATASET'
  | 'META_APP'
  | 'WHATSAPP_BUSINESS_ACCOUNT'
  | 'LEAD_FORM';

export const TIPOS_ACTIVO_META: readonly TipoActivoMeta[] = [
  'META_BUSINESS',
  'FACEBOOK_PAGE',
  'INSTAGRAM_PROFILE',
  'INSTAGRAM_BUSINESS_ACCOUNT',
  'META_AD_ACCOUNT',
  'META_PIXEL',
  'DATASET',
  'META_APP',
  'WHATSAPP_BUSINESS_ACCOUNT',
  'LEAD_FORM',
];

/** Estado de VINCULACIÓN de SOEC (no de la realidad externa). */
export type EstadoActivoMeta = 'NOT_CONFIGURED' | 'PENDING_BINDING' | 'BOUND_READ_ONLY';

/** Realidad EXTERNA del activo en Meta (independiente de si SOEC lo conectó). */
export type EstadoExternoMeta = 'EXISTS' | 'RESTRICTED' | 'REJECTED' | 'ABSENT' | 'UNKNOWN';

/** Cómo se conoció el dato: observado, inferido, desconocido o pendiente de verificación. */
export type Procedencia = 'OBSERVED' | 'INFERRED' | 'UNKNOWN' | 'REQUIRES_VERIFICATION';

export interface ActivoMeta {
  readonly organizationId: string;
  readonly businessKey: string;
  readonly tipo: TipoActivoMeta;
  readonly externalId: string | null;
  /** Business Portfolio dueño (para binding por ID, no por nombre). */
  readonly ownerBusinessId: string | null;
  readonly displayName: string | null;
  readonly procedencia: Procedencia;
  /** Realidad en Meta. `EXISTS` no implica que SOEC esté conectado. */
  readonly externalStatus: EstadoExternoMeta;
  /** Estado de vinculación de SOEC. Un activo que EXISTS puede seguir NOT_CONFIGURED en SOEC. */
  readonly estado: EstadoActivoMeta;
  /** Binding requiere confirmación humana explícita antes de conectar. */
  readonly requiresConfirmation: boolean;
  readonly credentialRefs: readonly string[];
}

// ---- Capacidades independientes (no cascadean) ----

export type CapacidadMeta =
  | 'ORGANIC_FACEBOOK'
  | 'ORGANIC_INSTAGRAM'
  | 'META_ADS'
  | 'LEAD_ADS'
  | 'API_READ'
  | 'API_WRITE';

export type EstadoCapacidad =
  | 'AVAILABLE'
  | 'NOT_CONFIGURED'
  | 'RESTRICTED'
  | 'NOT_VERIFIED'
  | 'NOT_CONNECTED'
  | 'UNKNOWN';

export type CapacidadesMeta = Readonly<Record<CapacidadMeta, EstadoCapacidad>>;

/** Salud de conexión — por activo/capacidad. Un error NUNCA es "0"; restricted NUNCA es "sin datos". */
export type SaludConexionMeta =
  | 'NOT_CONFIGURED'
  | 'NOT_CONNECTED'
  | 'CONNECTED'
  | 'CONNECTED_WITH_DATA'
  | 'CONNECTED_NO_DATA'
  | 'RESTRICTED'
  | 'TOKEN_EXPIRING'
  | 'TOKEN_EXPIRED'
  | 'PERMISSION_MISSING'
  | 'RATE_LIMITED'
  | 'ERROR'
  | 'UNKNOWN';

/** Clasificación de la fundación Meta de un negocio. `CLEAN_REBUILD` NO se deriva de una restricción de Ads. */
export type ClaseFundacionMeta =
  | 'RECOVERABLE_FOUNDATION'
  | 'FRAGMENTED_BUT_RECOVERABLE'
  | 'FRAGMENTED_RESTRICTED_RECOVERABLE'
  | 'RESTRICTED_REQUIRES_HUMAN_REVIEW'
  | 'CLEAN_REBUILD'
  | 'FOUNDATION_ABSENT';

export type RelacionActivo = 'FIRST_PARTY' | 'THIRD_PARTY' | 'UNKNOWN';
export type RequisitoAcceso = 'STANDARD' | 'ADVANCED' | 'TO_BE_DETERMINED_PER_PERMISSION';

export type WhatsappPresencia = 'VERIFIED_CONNECTED' | 'NOT_OBSERVED' | 'UNKNOWN';
export type WhatsappApi = 'NOT_VERIFIED' | 'NOT_CONNECTED' | 'CONNECTED';

/**
 * Clasifica la fundación a partir de las capacidades. Regla dura: si hay orgánico disponible (FB o IG),
 * una restricción de Ads NO justifica `CLEAN_REBUILD` — a lo sumo `FRAGMENTED_RESTRICTED_RECOVERABLE`.
 * `CLEAN_REBUILD` sólo si NO hay ningún orgánico usable (todos absent/unknown) — nunca por Ads restringido.
 */
export function clasificarFundacion(caps: CapacidadesMeta): ClaseFundacionMeta {
  const organicoDisponible = caps.ORGANIC_FACEBOOK === 'AVAILABLE' || caps.ORGANIC_INSTAGRAM === 'AVAILABLE';
  const adsRestringido = caps.META_ADS === 'RESTRICTED' || caps.LEAD_ADS === 'RESTRICTED';
  const nadaUsable =
    caps.ORGANIC_FACEBOOK !== 'AVAILABLE' &&
    caps.ORGANIC_INSTAGRAM !== 'AVAILABLE' &&
    caps.META_ADS !== 'AVAILABLE';

  if (nadaUsable && (caps.ORGANIC_FACEBOOK === 'NOT_CONFIGURED' || caps.ORGANIC_FACEBOOK === 'UNKNOWN') && (caps.ORGANIC_INSTAGRAM === 'NOT_CONFIGURED' || caps.ORGANIC_INSTAGRAM === 'UNKNOWN')) {
    // Sin ningún activo (todos ausentes) ⇒ no hay fundación que recuperar.
    if (caps.ORGANIC_FACEBOOK === 'NOT_CONFIGURED' && caps.ORGANIC_INSTAGRAM === 'NOT_CONFIGURED' && caps.META_ADS === 'NOT_CONFIGURED') return 'FOUNDATION_ABSENT';
    return 'RESTRICTED_REQUIRES_HUMAN_REVIEW';
  }
  if (organicoDisponible && adsRestringido) return 'FRAGMENTED_RESTRICTED_RECOVERABLE';
  if (organicoDisponible && caps.META_ADS === 'AVAILABLE') return 'RECOVERABLE_FOUNDATION';
  if (organicoDisponible) return 'FRAGMENTED_BUT_RECOVERABLE';
  return 'RESTRICTED_REQUIRES_HUMAN_REVIEW';
}

// ---- Referencias de secreto por activo (tenant-scoped, opacas) ----

const NOMBRE_SECRETO: Record<TipoActivoMeta, string> = {
  META_BUSINESS: 'meta-business',
  FACEBOOK_PAGE: 'meta-page-token',
  INSTAGRAM_PROFILE: 'meta-ig-profile',
  INSTAGRAM_BUSINESS_ACCOUNT: 'meta-ig-token',
  META_AD_ACCOUNT: 'meta-ad-account',
  META_PIXEL: 'meta-pixel',
  DATASET: 'meta-dataset',
  META_APP: 'meta-app-secret',
  WHATSAPP_BUSINESS_ACCOUNT: 'meta-wa-token',
  LEAD_FORM: 'meta-leadform',
};

export function refSecretoActivo(organizationId: string, tipo: TipoActivoMeta): string {
  return `file:${organizationId}/${NOMBRE_SECRETO[tipo]}`;
}

// ---- Token model (SIN valor) ----

export interface ModeloTokenMeta {
  readonly tipo: 'PAGE' | 'USER_LONG_LIVED' | 'SYSTEM_USER' | 'NONE';
  readonly issuedAt: string | null;
  readonly expiresAt: string | null;
  readonly estado: 'NONE' | 'ACTIVE' | 'EXPIRING' | 'EXPIRED';
}

export const TOKEN_NO_CONECTADO: ModeloTokenMeta = { tipo: 'NONE', issuedAt: null, expiresAt: null, estado: 'NONE' };

// ---- Allowlist de operaciones de LECTURA (default-deny) ----

export type OperacionMetaLectura =
  | 'READ_BUSINESS_ASSETS'
  | 'READ_PAGES'
  | 'READ_INSTAGRAM_ACCOUNT'
  | 'READ_ORGANIC_MEDIA'
  | 'READ_ORGANIC_INSIGHTS'
  | 'READ_AD_ACCOUNT'
  | 'READ_CAMPAIGNS'
  | 'READ_ADSETS'
  | 'READ_ADS'
  | 'READ_AD_INSIGHTS'
  | 'READ_LEAD_FORMS_METADATA'
  | 'READ_LEADS';

export const OPERACIONES_LECTURA_META: readonly OperacionMetaLectura[] = [
  'READ_BUSINESS_ASSETS',
  'READ_PAGES',
  'READ_INSTAGRAM_ACCOUNT',
  'READ_ORGANIC_MEDIA',
  'READ_ORGANIC_INSIGHTS',
  'READ_AD_ACCOUNT',
  'READ_CAMPAIGNS',
  'READ_ADSETS',
  'READ_ADS',
  'READ_AD_INSIGHTS',
  'READ_LEAD_FORMS_METADATA',
  'READ_LEADS',
];

/** Sólo las operaciones de la allowlist de LECTURA se permiten. Cualquier otra (incl. escritura) ⇒ false. */
export function esOperacionLecturaPermitida(op: string): boolean {
  return (OPERACIONES_LECTURA_META as readonly string[]).includes(op);
}

// ---- Normalización de `action_type` de Meta ----

export type ResultadoAccionMeta = 'ENGAGEMENT' | 'LINK_CLICK' | 'LEAD' | 'PURCHASE' | 'MESSAGE' | 'UNKNOWN';

const MAPA_ACCION: Record<string, ResultadoAccionMeta> = {
  post_engagement: 'ENGAGEMENT',
  page_engagement: 'ENGAGEMENT',
  like: 'ENGAGEMENT',
  comment: 'ENGAGEMENT',
  post_reaction: 'ENGAGEMENT',
  link_click: 'LINK_CLICK',
  outbound_click: 'LINK_CLICK',
  landing_page_view: 'LINK_CLICK',
  lead: 'LEAD',
  leadgen_grouped: 'LEAD',
  'onsite_conversion.lead_grouped': 'LEAD',
  purchase: 'PURCHASE',
  'offsite_conversion.fb_pixel_purchase': 'PURCHASE',
  'onsite_conversion.messaging_conversation_started_7d': 'MESSAGE',
  onsite_conversion_messaging_first_reply: 'MESSAGE',
};

export function normalizarAccionMeta(actionType: string): ResultadoAccionMeta {
  return MAPA_ACCION[actionType] ?? 'UNKNOWN';
}

export function esResultadoComercialMeta(r: ResultadoAccionMeta): boolean {
  return r === 'LEAD' || r === 'PURCHASE';
}

/**
 * Construye los activos Meta de una organización. Sin binding humano/config, TODOS son NOT_CONFIGURED /
 * externalStatus UNKNOWN — jamás se inventa una Page/IG/Ad Account, ni se auto-selecciona por nombre.
 */
export function activosMetaDe(
  organizationId: string,
  businessKey: string,
  bindings: readonly Partial<Pick<ActivoMeta, 'tipo' | 'externalId' | 'displayName' | 'ownerBusinessId' | 'externalStatus' | 'procedencia'>>[] = [],
): readonly ActivoMeta[] {
  return TIPOS_ACTIVO_META.map((tipo) => {
    const b = bindings.find((x) => x.tipo === tipo);
    const externalId = b?.externalId ?? null;
    return {
      organizationId,
      businessKey,
      tipo,
      externalId,
      ownerBusinessId: b?.ownerBusinessId ?? null,
      displayName: b?.displayName ?? null,
      procedencia: b?.procedencia ?? (externalId === null ? 'UNKNOWN' : 'OBSERVED'),
      externalStatus: b?.externalStatus ?? (externalId === null ? 'UNKNOWN' : 'EXISTS'),
      estado: 'NOT_CONFIGURED', // SOEC nunca se auto-vincula: descubrir ╪ conectar
      requiresConfirmation: externalId !== null,
      credentialRefs: [],
    };
  });
}

/** Salud global de Meta para SOEC: sin activos VINCULADOS ⇒ NOT_CONNECTED (nunca "0 resultados"). */
export function saludMetaDe(activos: readonly ActivoMeta[]): SaludConexionMeta {
  return activos.some((a) => a.estado === 'BOUND_READ_ONLY') ? 'CONNECTED' : 'NOT_CONNECTED';
}
