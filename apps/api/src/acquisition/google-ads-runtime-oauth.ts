/**
 * apps/api · Composición PRODUCTIVA del OAuth de Google Ads: persistencia PG (tablas google_ads_*) +
 * EnvelopeSecretBackend (AWS KMS, REUTILIZADO tal cual de la infra de secretos) + adaptadores HTTP reales
 * (OAuth token + descubrimiento de cuentas). Sin fakes en el production path.
 *
 * Fail-closed: si falta el KMS (SOEC_KMS_KEY_ID/AWS_*) o la config app-level de Google Ads
 * (client_id/secret/developer_token/redirect_uri), NO se construye (retorna null) y las rutas responden
 * GOOGLE_ADS_NOT_CONFIGURED. No se toca producción: esta composición sólo se activa cuando el entorno tiene
 * las variables cargadas (gate humano posterior).
 */

import type { Pool } from 'pg';
import { AwsKmsPort, type ConfigAwsKms } from './aws-kms';
import { ClienteKmsSdk } from './aws-kms-sdk';
import { EnvelopeSecretBackend } from './meta-secret-backend';
import { crearRepositoriosGoogleAdsPg } from './google-ads-oauth-pg';
import { GoogleOAuthHttpAdapter, GoogleAdsAccountsHttpAdapter } from './google-ads-api-http';
import type { ComponentesFlujoGoogleAds } from './google-ads-oauth-flow';

type Env = Record<string, string | undefined>;

function configKmsDesdeEnv(env: Env): ConfigAwsKms | null {
  const region = env['AWS_REGION'];
  const keyId = env['SOEC_KMS_KEY_ID'];
  if (!region || !keyId || !env['AWS_ACCESS_KEY_ID'] || !env['AWS_SECRET_ACCESS_KEY']) return null;
  const timeoutMs = Number(env['SOEC_KMS_TIMEOUT_MS'] ?? '5000');
  const maxAttempts = Number(env['SOEC_KMS_MAX_ATTEMPTS'] ?? '3');
  return { region, keyId, timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 5000, maxAttempts: Number.isFinite(maxAttempts) && maxAttempts >= 1 ? maxAttempts : 3 };
}

export interface ConfigAppGoogleAds {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly developerToken: string;
  readonly redirectUri: string;
}

/** App-level (global a todas las empresas) desde env. null si falta cualquiera. NUNCA expone valores. */
export function configAppGoogleAdsDesdeEnv(env: Env): ConfigAppGoogleAds | null {
  const clientId = env['GOOGLE_ADS_CLIENT_ID'];
  const clientSecret = env['GOOGLE_ADS_CLIENT_SECRET'];
  const developerToken = env['GOOGLE_ADS_DEVELOPER_TOKEN'];
  const redirectUri = env['GOOGLE_ADS_OAUTH_REDIRECT_URI'];
  if (!clientId || !clientSecret || !developerToken || !redirectUri) return null;
  return { clientId, clientSecret, developerToken, redirectUri };
}

export function crearComposicionGoogleAdsOAuth(pool: Pool, env: Env): ComponentesFlujoGoogleAds | null {
  const cfgApp = configAppGoogleAdsDesdeEnv(env);
  const cfgKms = configKmsDesdeEnv(env);
  if (cfgApp === null || cfgKms === null) return null;
  const repos = crearRepositoriosGoogleAdsPg(pool);
  const secretWriter = new EnvelopeSecretBackend(new AwsKmsPort(cfgKms, new ClienteKmsSdk(cfgKms)), repos.ciphertextStore);
  return {
    stateStore: repos.stateStore,
    credRepo: repos.credRepo,
    connRepo: repos.connRepo,
    secretWriter,
    oauth: new GoogleOAuthHttpAdapter({ clientId: cfgApp.clientId, clientSecret: cfgApp.clientSecret }),
    accounts: new GoogleAdsAccountsHttpAdapter({ developerToken: cfgApp.developerToken }),
    clientId: cfgApp.clientId,
    redirectUri: cfgApp.redirectUri,
    ahora: () => new Date().toISOString(),
  };
}

export type GoogleAdsOAuthStatus = 'CONFIGURED' | 'NOT_CONFIGURED';
export function googleAdsOAuthStatus(env: Env): GoogleAdsOAuthStatus {
  return configAppGoogleAdsDesdeEnv(env) !== null && configKmsDesdeEnv(env) !== null ? 'CONFIGURED' : 'NOT_CONFIGURED';
}
