/**
 * apps/api · campana · Wiring del PUERTO DE ESCRITURA real de Google Ads. Construye el `GoogleAdsRealMutatePort`
 * (adaptador real EXISTENTE de Phase2B) sobre el transporte HTTP de escritura, reutilizando la MISMA
 * configuración/secret-refs que la ingesta de lectura (`construirIngestaGoogleAds`). Fail-closed: devuelve null
 * si la org no tiene fuente google-ads o falta configuración — nunca inventa.
 *
 * IMPORTANTE: este puerto es ALCANZABLE sólo con SUPERVISED_REAL=true. En la fase actual (flag en false) el
 * ejecutor DENIEGA antes del primer provider write, así que este transporte JAMÁS se invoca.
 */
import { SecretStoreEnv } from '@soec/secretos';
import type { RequestContext } from '@soec/contracts';
import { buscarFuente, getRecursoGoogleAds } from '../plataforma';
import { GoogleAdsMutateHttpClient } from './google-ads-mutate-http';
import { GoogleAdsRealMutatePort } from './google-ads-real-port';

/** Construye el `GoogleAdsRealMutatePort` real para una org, o null si no está configurada (fail-closed). */
export function construirPuertoEscrituraGoogleAds(env: NodeJS.ProcessEnv, org: string, ctx: RequestContext): GoogleAdsRealMutatePort | null {
  const fuente = buscarFuente(org, 'google-ads');
  if (!fuente) return null;
  let ads: ReturnType<typeof getRecursoGoogleAds>;
  try { ads = getRecursoGoogleAds(org); } catch { return null; }
  if (!(env.GOOGLE_ADS_DEVELOPER_TOKEN && env.GOOGLE_ADS_CLIENT_ID && env.GOOGLE_ADS_CLIENT_SECRET)) return null;

  const client = new GoogleAdsMutateHttpClient({
    secretStore: new SecretStoreEnv(env),
    ctx,
    secretRefs: {
      developerToken: 'env:GOOGLE_ADS_DEVELOPER_TOKEN',
      clientId: 'env:GOOGLE_ADS_CLIENT_ID',
      clientSecret: 'env:GOOGLE_ADS_CLIENT_SECRET',
      refreshToken: fuente.credenciales.find((c) => c.nombreLogico === 'google-ads-refresh-token')?.secretRef ?? 'env:GOOGLE_ADS_REFRESH_TOKEN',
    },
    loginCustomerId: ads.loginCustomerId,
  });
  return new GoogleAdsRealMutatePort(client);
}
