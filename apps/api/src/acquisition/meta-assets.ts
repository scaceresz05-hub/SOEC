/**
 * apps/api · Modelo de ACTIVOS Meta (preparación read-only) — SIN conexión, SIN red, SIN tokens.
 *
 * Prepara el onboarding read-only sin conectar nada. Reglas:
 *   · los activos Meta son DISTINTOS y separados (nunca un único `metaAccountId`): Business, Page,
 *     Instagram, Ad Account, Pixel, App — cada uno con identidad y permisos propios;
 *   · todo activo es tenant-scoped (organizationId + businessKey); nunca se auto-selecciona por nombre;
 *   · las credenciales son referencias OPACAS por activo (nunca el valor); distintas por organización;
 *   · sin binding humano explícito ⇒ NOT_CONFIGURED (jamás se inventa una Page/IG/Ad Account);
 *   · el mapeo de `action_type` de Meta NUNCA suma todo a "conversiones": click ╪ lead, engagement ╪ venta.
 * La implementación real de las llamadas Graph (fetch) NO vive aquí: requiere App aprobada + App Review
 * + Business Verification + autorización humana (ver META-READ-ONLY-ONBOARDING.md).
 */

export type TipoActivoMeta =
  | 'META_BUSINESS'
  | 'FACEBOOK_PAGE'
  | 'INSTAGRAM_ACCOUNT'
  | 'META_AD_ACCOUNT'
  | 'META_PIXEL'
  | 'META_APP';

export const TIPOS_ACTIVO_META: readonly TipoActivoMeta[] = [
  'META_BUSINESS',
  'FACEBOOK_PAGE',
  'INSTAGRAM_ACCOUNT',
  'META_AD_ACCOUNT',
  'META_PIXEL',
  'META_APP',
];

export type EstadoActivoMeta = 'NOT_CONFIGURED' | 'PENDING_BINDING' | 'BOUND_READ_ONLY';

export interface ActivoMeta {
  readonly organizationId: string;
  readonly businessKey: string;
  readonly tipo: TipoActivoMeta;
  readonly externalId: string | null;
  readonly displayName: string | null;
  readonly estado: EstadoActivoMeta;
  /** Capacidades de LECTURA demostradas; vacío mientras no haya conexión. */
  readonly capabilities: readonly OperacionMetaLectura[];
  /** Referencias OPACAS a secretos (nunca valores). */
  readonly credentialRefs: readonly string[];
}

/** Estado de salud de la conexión. Un error NUNCA se traduce a "0 resultados". */
export type SaludConexionMeta =
  | 'NOT_CONNECTED'
  | 'CONNECTED'
  | 'TOKEN_EXPIRING'
  | 'TOKEN_EXPIRED'
  | 'PERMISSION_MISSING'
  | 'ASSET_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'ERROR';

/** Modelo de token — SIN valor. Sólo metadatos de vigencia para manage-by-exception. */
export interface ModeloTokenMeta {
  readonly tipo: 'PAGE' | 'USER_LONG_LIVED' | 'SYSTEM_USER' | 'NONE';
  readonly issuedAt: string | null;
  readonly expiresAt: string | null;
  readonly estado: 'NONE' | 'ACTIVE' | 'EXPIRING' | 'EXPIRED';
}

export const TOKEN_NO_CONECTADO: ModeloTokenMeta = { tipo: 'NONE', issuedAt: null, expiresAt: null, estado: 'NONE' };

/** Nombre lógico de secreto por activo (kebab). */
const NOMBRE_SECRETO: Record<TipoActivoMeta, string> = {
  META_BUSINESS: 'meta-business',
  FACEBOOK_PAGE: 'meta-page-token',
  INSTAGRAM_ACCOUNT: 'meta-ig-token',
  META_AD_ACCOUNT: 'meta-ad-account',
  META_PIXEL: 'meta-pixel',
  META_APP: 'meta-app-secret',
};

/**
 * Referencia de secreto OPACA para un activo, tenant-scoped: `file:<org>/<nombre>`. Nunca un valor.
 * Dos organizaciones obtienen referencias distintas por construcción (aislamiento por tenant).
 */
export function refSecretoActivo(organizationId: string, tipo: TipoActivoMeta): string {
  return `file:${organizationId}/${NOMBRE_SECRETO[tipo]}`;
}

// ---- Allowlist de operaciones de LECTURA (default-deny para todo lo demás) ----

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
  'READ_LEADS',
];

/** Sólo las operaciones de la allowlist de LECTURA se permiten. Cualquier otra (incl. escritura) ⇒ false. */
export function esOperacionLecturaPermitida(op: string): boolean {
  return (OPERACIONES_LECTURA_META as readonly string[]).includes(op);
}

// ---- Normalización de `action_type` de Meta (FASE 17) ----

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

/**
 * Mapea un `action_type` de Meta a un resultado tipado. NUNCA suma todas las acciones como
 * "conversiones"; una acción desconocida es UNKNOWN (no se cuenta como comercial).
 */
export function normalizarAccionMeta(actionType: string): ResultadoAccionMeta {
  return MAPA_ACCION[actionType] ?? 'UNKNOWN';
}

/** Sólo LEAD y PURCHASE son resultados comerciales. Click, engagement, message, unknown NO lo son. */
export function esResultadoComercialMeta(r: ResultadoAccionMeta): boolean {
  return r === 'LEAD' || r === 'PURCHASE';
}

/**
 * Estado de descubrimiento de activos Meta para una organización. Sin binding humano/config, TODOS los
 * activos son NOT_CONFIGURED — jamás se inventa una Page/IG/Ad Account. `bindings` es la config
 * (vacía hoy); nunca se auto-selecciona por parecido de nombre.
 */
export function activosMetaDe(
  organizationId: string,
  businessKey: string,
  bindings: readonly Partial<Pick<ActivoMeta, 'tipo' | 'externalId' | 'displayName'>>[] = [],
): readonly ActivoMeta[] {
  return TIPOS_ACTIVO_META.map((tipo) => {
    const b = bindings.find((x) => x.tipo === tipo);
    const externalId = b?.externalId ?? null;
    return {
      organizationId,
      businessKey,
      tipo,
      externalId,
      displayName: b?.displayName ?? null,
      estado: externalId === null ? ('NOT_CONFIGURED' as const) : ('PENDING_BINDING' as const),
      capabilities: [],
      credentialRefs: [],
    };
  });
}

/** Salud global de Meta para una org: sin activos vinculados ⇒ NOT_CONNECTED (nunca "0 resultados"). */
export function saludMetaDe(activos: readonly ActivoMeta[]): SaludConexionMeta {
  return activos.some((a) => a.estado === 'BOUND_READ_ONLY') ? 'CONNECTED' : 'NOT_CONNECTED';
}
