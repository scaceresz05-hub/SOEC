/**
 * apps/api · DISEÑO del OAuth READ-ONLY de Google Ads — allowlist de scope, estado anti-CSRF PROVIDER-BOUND
 * y construcción de la authorization URL. Puro y determinista (instante/nonce inyectados).
 *
 * REUSO SEGURO de primitivas genéricas (sin tocar Meta): `crearEstadoOAuth`/`validarEstadoOAuth` de
 * `meta-oauth.ts` son funciones PURAS provider-agnósticas (org autoritativa del state, one-time, TTL,
 * cross-tenant). Aquí se envuelven para atar el state INEQUÍVOCAMENTE al provider `google-ads`, de modo que:
 *   - un state de Meta JAMÁS es válido en el callback de Google Ads (persistencia separada + campo provider);
 *   - un state de Google Ads JAMÁS es válido en Meta (tabla `google_ads_oauth_state` distinta).
 * Ver test `oauth_state_provider_bound`.
 *
 * READ ONLY: el único scope solicitado es `adwords`. Aunque ese scope técnicamente permita mutaciones,
 * SOEC gobierna por su propia política: NO implementa ningún write path (GOOGLE_ADS_WRITE_ACTIONS = 0).
 */

import { crearEstadoOAuth, validarEstadoOAuth, type EstadoOAuth, type DepsEstadoOAuth, type ResultadoValidacionOAuth } from './meta-oauth';

export const PROVIDER_GOOGLE_ADS = 'google-ads' as const;
export type ProviderGoogleAds = typeof PROVIDER_GOOGLE_ADS;

/** Scope de la Google Ads API. Único requerido. READ ONLY por política SOEC (no por el scope en sí). */
export const SCOPE_ADWORDS = 'https://www.googleapis.com/auth/adwords';
export const SCOPES_REQUERIDOS_GOOGLE_ADS: readonly string[] = [SCOPE_ADWORDS];

/** Endpoints OAuth de Google (constantes; el host queda sujeto a la allowlist del adaptador HTTP). */
export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

// ---------------------------------------------------------------------------
// Estado OAuth PROVIDER-BOUND
// ---------------------------------------------------------------------------

/** State atado a (organizationId, actor, provider google-ads, expiración, one-time). */
export interface EstadoOAuthGoogleAds extends EstadoOAuth {
  readonly provider: ProviderGoogleAds;
}

export function crearEstadoGoogleAds(deps: DepsEstadoOAuth, organizationId: string, actorId: string): EstadoOAuthGoogleAds {
  // Reusa la construcción genérica (nonce impredecible, org autoritativa, TTL) y añade el binding de provider.
  return { ...crearEstadoOAuth(deps, organizationId, actorId), provider: PROVIDER_GOOGLE_ADS };
}

export type ResultadoValidacionGoogleAds = ResultadoValidacionOAuth | 'PROVIDER_MISMATCH';

/**
 * Valida el state del callback de Google Ads. Rechaza (PROVIDER_MISMATCH) cualquier state cuyo provider no
 * sea `google-ads` — defensa en profundidad además del aislamiento por tabla. Delega el resto (desconocido/
 * expirado/consumido/cross-tenant) en la validación genérica reutilizada.
 */
export function validarEstadoGoogleAds(
  almacenado: EstadoOAuthGoogleAds | null,
  entrante: { readonly valor: string; readonly organizationIdCallback?: string; readonly ahora: string },
): ResultadoValidacionGoogleAds {
  if (almacenado !== null && almacenado.provider !== PROVIDER_GOOGLE_ADS) return 'PROVIDER_MISMATCH';
  return validarEstadoOAuth(almacenado, entrante);
}

// ---------------------------------------------------------------------------
// Authorization URL
// ---------------------------------------------------------------------------

export interface DepsAuthorizationUrl {
  readonly clientId: string;
  readonly redirectUri: string;
}

/**
 * Construye la URL de consentimiento de Google. `access_type=offline` + `prompt=consent` garantizan que
 * Google devuelva un refresh_token (necesario para sincronización desatendida). `state` = nonce del state
 * provider-bound. No incluye ningún secreto (client_secret jamás va en la URL de autorización).
 */
export function construirAuthorizationUrl(deps: DepsAuthorizationUrl, state: string): string {
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set('client_id', deps.clientId);
  url.searchParams.set('redirect_uri', deps.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPES_REQUERIDOS_GOOGLE_ADS.join(' '));
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('include_granted_scopes', 'false');
  url.searchParams.set('state', state);
  return url.toString();
}
