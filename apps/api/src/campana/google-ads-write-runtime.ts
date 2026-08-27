/**
 * apps/api · campana · Wiring del PUERTO DE ESCRITURA real de Google Ads. Construye el `GoogleAdsRealMutatePort`
 * (adaptador real Phase2B) sobre el transporte HTTP de escritura.
 *
 * TOKEN (P0 fix): el access_token se resuelve por la CONEXIÓN OAuth REAL por tenant (refresh token cifrado) — la
 * misma vía que el descubrimiento de cuentas / refresh que YA funciona — NO por `env:GOOGLE_ADS_REFRESH_TOKEN`
 * (ausente en prod, causa del NO_ACCESS_TOKEN del intento anterior). El developer-token sí viene de env (presente).
 * Fail-closed: sin composición/config ⇒ null.
 *
 * `validateOnly` permite un diagnóstico SEGURO: Google valida pero no ejecuta (no crea recursos ni gasta).
 */
import type { ComponentesFlujoGoogleAds } from '../acquisition/google-ads-oauth-flow';
import { obtenerAccessTokenDeOrg } from '../acquisition/google-ads-oauth-flow';
import { getRecursoGoogleAds } from '../plataforma';
import { GoogleAdsMutateHttpClient, type GoogleAdsWriteLog } from './google-ads-mutate-http';
import { GoogleAdsRealMutatePort } from './google-ads-real-port';

export interface OpcionesEscrituraGoogleAds {
  readonly validateOnly?: boolean;
  readonly logger?: (info: GoogleAdsWriteLog) => void;
}

/** Construye el `GoogleAdsRealMutatePort` real para una org, o null si no está configurada (fail-closed). */
export function construirPuertoEscrituraGoogleAds(env: NodeJS.ProcessEnv, org: string, comp: ComponentesFlujoGoogleAds | null | undefined, opts: OpcionesEscrituraGoogleAds = {}): GoogleAdsRealMutatePort | null {
  if (!comp) return null;
  let ads: ReturnType<typeof getRecursoGoogleAds>;
  try { ads = getRecursoGoogleAds(org); } catch { return null; }
  const developerToken = env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!developerToken) return null;

  const client = new GoogleAdsMutateHttpClient({
    resolverAccessToken: () => obtenerAccessTokenDeOrg(comp, org), // conexión REAL por tenant (no env)
    developerToken,
    loginCustomerId: ads.loginCustomerId ?? ads.customerId, // manager (1742063041) si el acceso es vía MCC
    ...(opts.validateOnly ? { validateOnly: true } : {}),
    ...(opts.logger ? { logger: opts.logger } : {}),
  });
  return new GoogleAdsRealMutatePort(client);
}
