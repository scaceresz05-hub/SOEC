/**
 * apps/api · Wiring REUTILIZABLE de la ingesta Google Ads (READ ONLY). Único caso de uso central que comparten
 * el scheduler/script (`ingest-all.ts`) y el refresh manual desde la UI (`POST /medicion/refresh-ads`). No
 * duplica lógica: construye el GoogleAdsAdapter + IngestaGoogleAds desde el env + el registro de la org.
 * Devuelve null si la organización no tiene fuente google-ads o falta configuración (fail-closed, sin inventar).
 */
import type { EventStore } from '@soec/contracts';
import { SecretStoreEnv } from '@soec/secretos';
import { ObservacionService } from '@soec/motor-medicion';
import type { EsquemaSalida } from '@soec/adaptadores';
import { GoogleAdsAdapter } from './google-ads-adapter';
import { IngestaGoogleAds } from './ingesta-google-ads-service';
import { buscarFuente, getRecursoGoogleAds } from '../plataforma';

/** Egress cerrado y tipado para Google Ads: sólo query/customerId (strings) pueden salir. READ ONLY. */
const ESQUEMA_EGRESS_ADS: EsquemaSalida = {
  operacion: 'ingesta-ads',
  campos: [
    { nombre: 'query', tipo: 'string' },
    { nombre: 'customerId', tipo: 'string' },
  ],
};

export interface EnvGoogleAds extends NodeJS.ProcessEnv {}

/** ¿Están presentes las variables mínimas para intentar OAuth de Google Ads? (no expone valores). */
export function googleAdsConfigurado(env: EnvGoogleAds, org: string): boolean {
  if (!buscarFuente(org, 'google-ads')) return false;
  try {
    getRecursoGoogleAds(org);
  } catch {
    return false;
  }
  return Boolean(env.GOOGLE_ADS_DEVELOPER_TOKEN && env.GOOGLE_ADS_CLIENT_ID && env.GOOGLE_ADS_CLIENT_SECRET);
}

/**
 * Construye la ingesta Google Ads para una organización, o null si no está configurada. El refreshToken se
 * resuelve por la referencia OPACA declarada por la FUENTE de la org (nunca el valor). Si algo falta ⇒ null.
 */
export function construirIngestaGoogleAds(store: EventStore, env: EnvGoogleAds, org: string): IngestaGoogleAds | null {
  const fuenteAds = buscarFuente(org, 'google-ads');
  if (!fuenteAds) return null;
  let ads: ReturnType<typeof getRecursoGoogleAds>;
  try {
    ads = getRecursoGoogleAds(org);
  } catch {
    return null;
  }
  if (!(env.GOOGLE_ADS_DEVELOPER_TOKEN && env.GOOGLE_ADS_CLIENT_ID && env.GOOGLE_ADS_CLIENT_SECRET)) return null;

  const secretStore = new SecretStoreEnv(env);
  const observaciones = new ObservacionService(store, {} as never);
  const adaptador = new GoogleAdsAdapter({
    secretStore,
    esquemaEgress: ESQUEMA_EGRESS_ADS,
    secretRefs: {
      developerToken: 'env:GOOGLE_ADS_DEVELOPER_TOKEN',
      clientId: 'env:GOOGLE_ADS_CLIENT_ID',
      clientSecret: 'env:GOOGLE_ADS_CLIENT_SECRET',
      refreshToken: fuenteAds.credenciales.find((c) => c.nombreLogico === 'google-ads-refresh-token')?.secretRef ?? 'env:GOOGLE_ADS_REFRESH_TOKEN',
    },
    loginCustomerId: ads.loginCustomerId,
  });
  return new IngestaGoogleAds({ adaptador, observaciones, store, org, customerId: ads.customerId });
}
