/**
 * apps/api · Composición PRODUCTIVA del OAuth de Meta: une persistencia PG + SecretWriter (EnvelopeSecretBackend
 * + AWS KMS) + adaptadores HTTP reales (OAuth + Graph read-only), desde env + pool. Sin fakes en el production
 * path. Fail-closed: si falta config Meta o KMS, no se construye (retorna null).
 */

import type { Pool } from 'pg';
import { AwsKmsPort, type ConfigAwsKms } from './aws-kms';
import { ClienteKmsSdk } from './aws-kms-sdk';
import { EnvelopeSecretBackend } from './meta-secret-backend';
import { crearRepositoriosMetaPg, type PgOAuthStateStore, type PgCredentialRepo, type PgConnectionRepo } from './meta-oauth-pg';
import { configMetaOAuthDesdeEnv } from './meta-config';
import { TransporteHttpMeta } from './meta-http';
import { MetaOAuthHttpAdapter } from './meta-oauth-http';
import { MetaGraphReadHttpAdapter } from './meta-graph-http';

type Env = Record<string, string | undefined>;

function configKmsDesdeEnv(env: Env): ConfigAwsKms | null {
  const region = env['AWS_REGION'];
  const keyId = env['SOEC_KMS_KEY_ID'];
  if (!region || !keyId || !env['AWS_ACCESS_KEY_ID'] || !env['AWS_SECRET_ACCESS_KEY']) return null;
  const timeoutMs = Number(env['SOEC_KMS_TIMEOUT_MS'] ?? '5000');
  const maxAttempts = Number(env['SOEC_KMS_MAX_ATTEMPTS'] ?? '3');
  return { region, keyId, timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 5000, maxAttempts: Number.isFinite(maxAttempts) && maxAttempts >= 1 ? maxAttempts : 3 };
}

export interface ComposicionMetaOAuth {
  readonly stateStore: PgOAuthStateStore;
  readonly credRepo: PgCredentialRepo;
  readonly connRepo: PgConnectionRepo;
  readonly secretWriter: EnvelopeSecretBackend;
  readonly oauth: MetaOAuthHttpAdapter;
  /** El adapter de Graph se crea por-conexión con el token resuelto (boundary-only). */
  readonly crearGraphRead: (accessToken: string) => MetaGraphReadHttpAdapter;
  readonly graphVersion: string;
  readonly redirectUri: string;
}

export function crearComposicionMetaOAuth(pool: Pool, env: Env): ComposicionMetaOAuth | null {
  const cfgMeta = configMetaOAuthDesdeEnv(env);
  const cfgKms = configKmsDesdeEnv(env);
  if (cfgMeta === null || cfgKms === null) return null;
  const repos = crearRepositoriosMetaPg(pool);
  const secretWriter = new EnvelopeSecretBackend(new AwsKmsPort(cfgKms, new ClienteKmsSdk(cfgKms)), repos.ciphertextStore);
  const transporte = new TransporteHttpMeta();
  const oauth = new MetaOAuthHttpAdapter(cfgMeta, transporte);
  return {
    stateStore: repos.stateStore,
    credRepo: repos.credRepo,
    connRepo: repos.connRepo,
    secretWriter,
    oauth,
    crearGraphRead: (accessToken: string) => new MetaGraphReadHttpAdapter({ graphVersion: cfgMeta.graphVersion, appSecret: cfgMeta.appSecret }, transporte, accessToken),
    graphVersion: cfgMeta.graphVersion,
    redirectUri: cfgMeta.redirectUri,
  };
}

export type MetaOAuthHttpStatus = 'CONFIGURED' | 'IMPLEMENTED_NOT_CONFIGURED';

/** Estado de configuración del OAuth HTTP (no ejecuta nada real). */
export function metaOAuthHttpStatus(env: Env): MetaOAuthHttpStatus {
  return configMetaOAuthDesdeEnv(env) !== null && configKmsDesdeEnv(env) !== null ? 'CONFIGURED' : 'IMPLEMENTED_NOT_CONFIGURED';
}
