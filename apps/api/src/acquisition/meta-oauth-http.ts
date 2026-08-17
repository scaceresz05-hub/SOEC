/**
 * apps/api · Adaptador PRODUCTIVO de `MetaOAuthPort` sobre los endpoints oficiales de Meta.
 *
 * exchangeAuthorizationCode: code → token corto → token largo (fb_exchange_token) → debug_token (scopes+user).
 * NO persiste el token. NUNCA loggea code/token/app_secret/Authorization. Sin retry ciego del code exchange.
 * Errores tipados/sanitizados. La authorization URL se construye con la allowlist read-only (reutiliza
 * `construirAuthorizationUrl`, que ya excluye scopes de escritura).
 */

import type { ConfigMetaOAuth } from './meta-config';
import { claseErrorGraph, codigoErrorGraph, MetaRespuestaInvalidaError, type TransporteMeta } from './meta-http';
import { construirAuthorizationUrl, type MetaOAuthPort, type ResultadoExchange } from './meta-oauth-flow';

function base(cfg: ConfigMetaOAuth): string {
  return `https://graph.facebook.com/${cfg.graphVersion}`;
}
function enc(s: string): string {
  return encodeURIComponent(s);
}
function leerString(json: unknown, clave: string): string | null {
  const v = (json as Record<string, unknown> | null)?.[clave];
  return typeof v === 'string' ? v : null;
}
function leerData(json: unknown): Record<string, unknown> | null {
  const d = (json as { data?: unknown } | null)?.data;
  return d && typeof d === 'object' ? (d as Record<string, unknown>) : null;
}

export class MetaOAuthHttpAdapter implements MetaOAuthPort {
  constructor(
    private readonly cfg: ConfigMetaOAuth,
    private readonly transporte: TransporteMeta,
    private readonly timeoutMs = 8000,
  ) {}

  /** Authorization URL con la allowlist read-only (sin scopes de escritura). */
  authorizationUrl(state: string): string {
    return construirAuthorizationUrl({ appId: this.cfg.appId, redirectUri: this.cfg.redirectUri, graphVersion: this.cfg.graphVersion, state });
  }

  async exchangeAuthorizationCode(code: string, redirectUri: string): Promise<ResultadoExchange> {
    const b = base(this.cfg);
    // 1) code → token corto (UNA sola vez; sin retry para evitar replay ambiguo).
    const r1 = await this.transporte.enviar({ metodo: 'GET', url: `${b}/oauth/access_token?client_id=${enc(this.cfg.appId)}&redirect_uri=${enc(redirectUri)}&client_secret=${enc(this.cfg.appSecret)}&code=${enc(code)}`, timeoutMs: this.timeoutMs });
    if (!r1.ok) throw claseErrorGraph(r1.status, codigoErrorGraph(r1.json))('intercambio de code rechazado por Meta');
    const tokenCorto = leerString(r1.json, 'access_token');
    if (tokenCorto === null) throw new MetaRespuestaInvalidaError('respuesta de access_token inválida');

    // 2) token corto → token largo (long-lived) para una conexión de lectura estable.
    const r2 = await this.transporte.enviar({ metodo: 'GET', url: `${b}/oauth/access_token?grant_type=fb_exchange_token&client_id=${enc(this.cfg.appId)}&client_secret=${enc(this.cfg.appSecret)}&fb_exchange_token=${enc(tokenCorto)}`, timeoutMs: this.timeoutMs });
    const tokenLargo = (r2.ok ? leerString(r2.json, 'access_token') : null) ?? tokenCorto;
    const expiresInLargo = r2.ok ? (r2.json as { expires_in?: unknown } | null)?.expires_in : undefined;

    // 3) debug_token → scopes efectivos + user id (app access token = app_id|app_secret).
    const r3 = await this.transporte.enviar({ metodo: 'GET', url: `${b}/debug_token?input_token=${enc(tokenLargo)}&access_token=${enc(`${this.cfg.appId}|${this.cfg.appSecret}`)}`, timeoutMs: this.timeoutMs });
    if (!r3.ok) throw claseErrorGraph(r3.status, codigoErrorGraph(r3.json))('debug_token rechazado por Meta');
    const data = leerData(r3.json);
    const scopes = Array.isArray(data?.['scopes']) ? (data!['scopes'] as unknown[]).filter((s): s is string => typeof s === 'string') : [];
    const providerUserId = typeof data?.['user_id'] === 'string' ? (data!['user_id'] as string) : '';
    const expiresAtUnix = typeof data?.['expires_at'] === 'number' ? (data!['expires_at'] as number) : typeof expiresInLargo === 'number' ? Math.floor(Date.now() / 1000) + (expiresInLargo as number) : null;
    const expiresAt = expiresAtUnix && expiresAtUnix > 0 ? new Date(expiresAtUnix * 1000).toISOString() : null;

    return { tokenType: 'USER_LONG_LIVED', accessTokenValor: tokenLargo, effectiveScopes: scopes, issuedAt: null, expiresAt, providerUserId };
  }

  async revoke(accessTokenValor: string): Promise<void> {
    // Best-effort: revoca los permisos del usuario. No lanza si Meta responde no-ok (revocación oportunista).
    await this.transporte
      .enviar({ metodo: 'DELETE', url: `${base(this.cfg)}/me/permissions?access_token=${enc(accessTokenValor)}`, timeoutMs: this.timeoutMs })
      .catch(() => undefined);
  }
}
