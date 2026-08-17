/**
 * apps/api · Contrato de configuración PRODUCTIVA del OAuth de Meta. Tipado, fail-closed.
 *
 * `META_APP_SECRET` es un SECRETO: sólo cruza este boundary de config (env). NUNCA al frontend, logs ni audit.
 * Este módulo sólo TRANSPORTA el valor a los adaptadores; no lo imprime ni lo persiste. Sin hardcode.
 */

export interface ConfigMetaOAuth {
  readonly appId: string; // META_APP_ID (público)
  readonly appSecret: string; // META_APP_SECRET (secreto — nunca loggear/persistir/frontend)
  readonly redirectUri: string; // META_OAUTH_REDIRECT_URI
  readonly graphVersion: string; // META_GRAPH_API_VERSION (default estable)
}

type Env = Record<string, string | undefined>;

export const GRAPH_VERSION_DEFAULT = 'v26.0';

export interface PresenciaMetaOAuth {
  readonly appId: boolean;
  readonly appSecret: boolean; // sólo presencia — el valor nunca se lee para mostrar
  readonly redirectUri: boolean;
}

export function presenciaMetaOAuth(env: Env): PresenciaMetaOAuth {
  const tiene = (k: string): boolean => typeof env[k] === 'string' && env[k]!.length > 0;
  return { appId: tiene('META_APP_ID'), appSecret: tiene('META_APP_SECRET'), redirectUri: tiene('META_OAUTH_REDIRECT_URI') };
}

/** Config productiva desde env, o null si falta algo requerido (fail-closed). Nunca devuelve valores por log. */
export function configMetaOAuthDesdeEnv(env: Env): ConfigMetaOAuth | null {
  const p = presenciaMetaOAuth(env);
  if (!p.appId || !p.appSecret || !p.redirectUri) return null;
  const redirectUri = env['META_OAUTH_REDIRECT_URI']!;
  if (!/^https:\/\//.test(redirectUri)) return null; // el redirect DEBE ser https en producción
  return {
    appId: env['META_APP_ID']!,
    appSecret: env['META_APP_SECRET']!,
    redirectUri,
    graphVersion: env['META_GRAPH_API_VERSION'] && env['META_GRAPH_API_VERSION']!.length > 0 ? env['META_GRAPH_API_VERSION']! : GRAPH_VERSION_DEFAULT,
  };
}
