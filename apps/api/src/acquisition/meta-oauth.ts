/**
 * apps/api · DISEÑO del OAuth READ-ONLY de Meta — allowlist de scopes, estado anti-CSRF y flujo de
 * callback. Puro y determinista (instante/nonce inyectados; sin reloj/aleatoriedad ambiente). NO
 * ejecuta OAuth real ni intercambia tokens.
 *
 * Seguridad: el `state` va ligado a (organizationId, actor), es de un solo uso, expirable e
 * impredecible (nonce inyectado en prod desde crypto). La organización AUTORITATIVA es la del state
 * almacenado, NUNCA la que llegue por el callback (previene org swapping / cross-tenant). Un scope
 * inesperado o de escritura NO eleva capacidades: SOEC gobierna por su propia allowlist.
 */

import type { EstadoConexionMeta } from './meta-onboarding';

export type ScopeMeta = string;

/** READ-ONLY. Requeridos para la conexión productiva de lectura. */
export const SCOPES_REQUERIDOS: readonly ScopeMeta[] = [
  'pages_show_list',
  'business_management',
  'instagram_basic',
  'pages_read_engagement',
  'instagram_manage_insights',
  'ads_read',
];
/** Meta puede incorporarlos automáticamente. */
export const SCOPES_AUTOMATICOS: readonly ScopeMeta[] = ['public_profile'];
export const SCOPES_OPCIONALES: readonly ScopeMeta[] = [];
/** PROHIBIDOS en esta fase (escritura / retrieval / publishing / messaging). */
export const SCOPES_PROHIBIDOS: readonly ScopeMeta[] = [
  'ads_management',
  'leads_retrieval',
  'instagram_content_publish',
  'instagram_manage_comments',
  'instagram_manage_messages',
  'pages_manage_posts',
  'pages_manage_engagement',
];

export type ClasificacionScope = 'REQUIRED' | 'OPTIONAL' | 'AUTOMATIC' | 'FORBIDDEN' | 'UNEXPECTED';

export function clasificarScope(s: ScopeMeta): ClasificacionScope {
  if (SCOPES_REQUERIDOS.includes(s)) return 'REQUIRED';
  if (SCOPES_OPCIONALES.includes(s)) return 'OPTIONAL';
  if (SCOPES_AUTOMATICOS.includes(s)) return 'AUTOMATIC';
  if (SCOPES_PROHIBIDOS.includes(s)) return 'FORBIDDEN';
  return 'UNEXPECTED';
}

export interface ResultadoValidacionScopes {
  readonly ok: boolean;
  readonly faltantes: readonly ScopeMeta[];
  readonly prohibidos: readonly ScopeMeta[];
  readonly inesperados: readonly ScopeMeta[];
}

/** Valida scopes efectivos contra la allowlist. Un scope prohibido/inesperado NUNCA habilita nada. */
export function validarScopes(efectivos: readonly ScopeMeta[]): ResultadoValidacionScopes {
  const set = new Set(efectivos);
  const faltantes = SCOPES_REQUERIDOS.filter((s) => !set.has(s));
  const prohibidos = efectivos.filter((s) => SCOPES_PROHIBIDOS.includes(s));
  const inesperados = efectivos.filter((s) => clasificarScope(s) === 'UNEXPECTED');
  return { ok: faltantes.length === 0 && prohibidos.length === 0, faltantes, prohibidos, inesperados };
}

// ---------------------------------------------------------------------------
// Candidato de activo (asset discovery, FASE 7) — nombre display-only, identidad por ID
// ---------------------------------------------------------------------------

export interface CandidatoActivo {
  readonly provider: 'meta';
  readonly assetType: 'business' | 'page' | 'instagram' | 'adAccount';
  readonly externalId: string; // ID canónico de Graph
  readonly displayName: string | null; // sólo display; NUNCA identidad
  readonly provenance: 'GRAPH_OBSERVED' | 'UI_OBSERVED' | 'INFERRED';
}

// ---------------------------------------------------------------------------
// Estado OAuth (CSRF / replay / cross-tenant, FASE 5)
// ---------------------------------------------------------------------------

export interface EstadoOAuth {
  readonly valor: string; // nonce impredecible (inyectado)
  readonly organizationId: string; // org AUTORITATIVA (no la del callback)
  readonly actorId: string;
  readonly creadoEn: string;
  readonly expiraEn: string;
  readonly consumido: boolean;
}

export interface DepsEstadoOAuth {
  readonly nonce: string; // en prod: crypto.randomBytes → hex; aquí inyectado
  readonly ahora: string;
  readonly ttlMs: number;
}

export function crearEstadoOAuth(deps: DepsEstadoOAuth, organizationId: string, actorId: string): EstadoOAuth {
  if (!deps.nonce || deps.nonce.length < 16) throw new Error('el state OAuth exige un nonce impredecible');
  return {
    valor: deps.nonce,
    organizationId,
    actorId,
    creadoEn: deps.ahora,
    expiraEn: new Date(Date.parse(deps.ahora) + deps.ttlMs).toISOString(),
    consumido: false,
  };
}

export type ResultadoValidacionOAuth = 'OK' | 'STATE_DESCONOCIDO' | 'STATE_EXPIRADO' | 'STATE_CONSUMIDO' | 'CROSS_TENANT';

/**
 * Valida el state del callback. La organización autoritativa es la del state ALMACENADO; si el callback
 * trae una org distinta ⇒ CROSS_TENANT (org swapping). One-time-use: consumido ⇒ rechazo (replay).
 */
export function validarEstadoOAuth(
  almacenado: EstadoOAuth | null,
  entrante: { readonly valor: string; readonly organizationIdCallback?: string; readonly ahora: string },
): ResultadoValidacionOAuth {
  if (almacenado === null || almacenado.valor !== entrante.valor) return 'STATE_DESCONOCIDO';
  if (almacenado.consumido) return 'STATE_CONSUMIDO';
  if (Date.parse(entrante.ahora) > Date.parse(almacenado.expiraEn)) return 'STATE_EXPIRADO';
  if (entrante.organizationIdCallback !== undefined && entrante.organizationIdCallback !== almacenado.organizationId) {
    return 'CROSS_TENANT';
  }
  return 'OK';
}

// ---------------------------------------------------------------------------
// Flujo de callback (FASE 6) — nunca marca CONNECTED
// ---------------------------------------------------------------------------

export interface ResultadoCallback {
  readonly estadoConexion: EstadoConexionMeta;
  readonly scopes: ResultadoValidacionScopes;
  /** La org autoritativa proviene del state, no del callback. */
  readonly organizationId: string | null;
}

/**
 * Deriva el siguiente estado de conexión desde la validación del state + los scopes efectivos. NUNCA
 * devuelve CONNECTED_READ_ONLY (eso exige binding humano). Fail-closed: state inválido ⇒ NOT_CONNECTED.
 */
export function procesarCallback(
  validacion: ResultadoValidacionOAuth,
  almacenado: EstadoOAuth | null,
  scopesEfectivos: readonly ScopeMeta[],
): ResultadoCallback {
  const scopes = validarScopes(scopesEfectivos);
  if (validacion !== 'OK' || almacenado === null) {
    return { estadoConexion: 'NOT_CONNECTED', scopes, organizationId: null };
  }
  if (!scopes.ok) {
    return { estadoConexion: 'SCOPES_INCOMPLETE', scopes, organizationId: almacenado.organizationId };
  }
  // Scopes OK ⇒ se descubren activos; binding humano pendiente. JAMÁS CONNECTED aquí.
  return { estadoConexion: 'ASSETS_DISCOVERED', scopes, organizationId: almacenado.organizationId };
}
