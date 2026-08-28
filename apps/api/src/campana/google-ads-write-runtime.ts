/**
 * apps/api · campana · Wiring del transporte de ESCRITURA real de Google Ads + resolución de geo.
 *
 * TOKEN (P0 fix): el access_token se resuelve por la CONEXIÓN OAuth REAL por tenant (refresh cifrado) — la misma
 * vía de accounts/refresh que funciona — NO por `env:GOOGLE_ADS_REFRESH_TOKEN`. Developer-token de env (presente).
 * Fail-closed: sin composición/config ⇒ null. `validateOnly` permite validar sin crear ni gastar.
 */
import type { ComponentesFlujoGoogleAds } from '../acquisition/google-ads-oauth-flow';
import { obtenerAccessTokenDeOrg } from '../acquisition/google-ads-oauth-flow';
import { getRecursoGoogleAds } from '../plataforma';
import { GoogleAdsMutateHttpClient, type GoogleAdsWriteLog } from './google-ads-mutate-http';
import { GoogleAdsRealMutatePort } from './google-ads-real-port';
import { GoogleAdsPauseAdapter } from './google-ads-pause-adapter';
import type { GeoPolicy, GeoRegionResuelta } from './geo-policy';

export interface OpcionesEscrituraGoogleAds {
  readonly validateOnly?: boolean;
  readonly logger?: (info: GoogleAdsWriteLog) => void;
}

/** Cliente HTTP de escritura para una org, o null si no está configurada (fail-closed). Token vía conexión REAL. */
export function construirClienteEscrituraGoogleAds(env: NodeJS.ProcessEnv, org: string, comp: ComponentesFlujoGoogleAds | null | undefined, opts: OpcionesEscrituraGoogleAds = {}): GoogleAdsMutateHttpClient | null {
  if (!comp) return null;
  let ads: ReturnType<typeof getRecursoGoogleAds>;
  try { ads = getRecursoGoogleAds(org); } catch { return null; }
  const developerToken = env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!developerToken) return null;
  return new GoogleAdsMutateHttpClient({
    resolverAccessToken: () => obtenerAccessTokenDeOrg(comp, org),
    developerToken,
    loginCustomerId: ads.loginCustomerId ?? ads.customerId, // manager (MCC) si el acceso es vía MCC
    ...(opts.validateOnly ? { validateOnly: true } : {}),
    ...(opts.logger ? { logger: opts.logger } : {}),
  });
}

/**
 * Construye el adapter PAUSE-ONLY para una org (o null si no está configurada, fail-closed). El scheduler de stops
 * recibe SÓLO esto: capacidad estructural de pausar, jamás de crear/habilitar/editar. Token vía conexión REAL.
 */
export function construirAdapterPausaGoogleAds(env: NodeJS.ProcessEnv, org: string, comp: ComponentesFlujoGoogleAds | null | undefined, logger?: DepsPauseAdapterLogger): GoogleAdsPauseAdapter | null {
  if (!comp) return null;
  let ads: ReturnType<typeof getRecursoGoogleAds>;
  try { ads = getRecursoGoogleAds(org); } catch { return null; }
  const developerToken = env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!developerToken) return null;
  return new GoogleAdsPauseAdapter({
    resolverAccessToken: () => obtenerAccessTokenDeOrg(comp, org),
    developerToken,
    loginCustomerId: ads.loginCustomerId ?? ads.customerId,
    ...(logger ? { logger } : {}),
  });
}
type DepsPauseAdapterLogger = ConstructorParameters<typeof GoogleAdsPauseAdapter>[0]['logger'];

/** Construye el `GoogleAdsRealMutatePort` real (adaptador Phase2B) sobre el cliente, o null (fail-closed). */
export function construirPuertoEscrituraGoogleAds(env: NodeJS.ProcessEnv, org: string, comp: ComponentesFlujoGoogleAds | null | undefined, opts: OpcionesEscrituraGoogleAds = {}): GoogleAdsRealMutatePort | null {
  const client = construirClienteEscrituraGoogleAds(env, org, comp, opts);
  return client ? new GoogleAdsRealMutatePort(client) : null;
}

/**
 * Resuelve los criterionId reales de las regiones (SuggestGeoTargetConstants). Verifica country del `geo` y
 * prefiere nivel región (targetType). Devuelve las resueltas y las faltantes (para fallar cerrado si alguna no).
 */
export async function resolverGeoRegiones(client: GoogleAdsMutateHttpClient, geo: GeoPolicy): Promise<{ resueltas: GeoRegionResuelta[]; faltantes: string[] }> {
  const resueltas: GeoRegionResuelta[] = [];
  const faltantes: string[] = [];
  for (const region of geo.regiones) {
    const sugeridos = await client.sugerirGeoTargets([region.nombre], geo.countryCode);
    const delPais = sugeridos.filter((s) => s.countryCode === geo.countryCode && s.criterionId);
    const match = delPais.find((s) => /region/i.test(s.targetType)) ?? delPais[0];
    if (match) resueltas.push({ ...region, criterionId: match.criterionId, canonicalName: match.canonicalName });
    else faltantes.push(region.nombre);
  }
  return { resueltas, faltantes };
}
