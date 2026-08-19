/**
 * GOOGLE_ADS_UI_LOCAL_SMOKE (nivel rutas/proxy, determinista): monta las rutas reales sobre Fastify con una
 * composición FAKE (fakes de OAuth/cuentas + envelope in-memory) y recorre TODOS los estados vía HTTP:
 * NOT_CONNECTED → OAUTH/callback → ACCOUNT_SELECTION_PENDING → CONNECTED → NEEDS_REAUTH → DISCONNECTED.
 * Verifica: rutas responden, estados cambian, gate business.manage, y que NINGÚN body expone token/secret.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance, type InjectOptions } from 'fastify';
import type { EventStore, RequestContext } from '@soec/contracts';
import { EnvelopeSecretBackend, InMemoryCiphertextStore, KmsFake } from '../src/acquisition/meta-secret-backend';
import { InMemoryStateStore, InMemoryCredentialRepo, InMemoryConnectionRepo, type ComponentesFlujoGoogleAds } from '../src/acquisition/google-ads-oauth-flow';
import type { GoogleOAuthPort, GoogleAdsAccountsPort, ResultadoIntercambio, ResultadoRefresh } from '../src/acquisition/google-ads-api-http';
import { registerGoogleAdsOAuthAutenticadas, registerGoogleAdsCallbackPublico } from '../src/acquisition/google-ads-oauth-routes';

const SECRET_REFRESH = 'refresh-token-secretisimo-999';

class OAuthFake implements GoogleOAuthPort {
  invalidGrant = false;
  async intercambiarCodigo(code: string): Promise<ResultadoIntercambio> {
    return code === 'good' ? { ok: true, refreshToken: SECRET_REFRESH, accessToken: 'at', scope: 'adwords', expiresIn: 3600 } : { ok: false, motivo: 'CODE_INVALIDO' };
  }
  async refrescarAccessToken(): Promise<ResultadoRefresh> {
    return this.invalidGrant ? { ok: false, motivo: 'INVALID_GRANT' } : { ok: true, accessToken: 'at', expiresIn: 3600 };
  }
  async revocar(): Promise<void> {}
}
class AccountsFake implements GoogleAdsAccountsPort {
  async listAccessibleCustomers(): Promise<readonly string[]> {
    return ['9090909090'];
  }
  async describeCustomer(_at: string, customerId: string, login: string | null) {
    return { customerId, descriptiveName: `Cuenta ${customerId}`, currencyCode: 'CLP', timeZone: 'America/Santiago', manager: false, testAccount: false, managerCustomerId: login };
  }
  async listClientCustomers(): Promise<readonly string[]> {
    return [];
  }
}
class FakeStore {
  readonly streams = new Map<string, unknown[]>();
  async readStream(_c: RequestContext, id: string): Promise<unknown[]> {
    return this.streams.get(id) ?? [];
  }
  async append(_c: RequestContext, id: string, _v: number, ev: unknown[]): Promise<{ version: number; events: unknown[] }> {
    const a = this.streams.get(id) ?? [];
    a.push(...ev);
    this.streams.set(id, a);
    return { version: a.length, events: ev };
  }
}

const H = { 'x-organization-id': 'org-smoke', 'x-actor-id': 'admin', 'x-permissions': 'business.manage' };
const bodies: string[] = []; // acumula todo lo que respondió el server (para el escaneo anti-secretos)
let app: FastifyInstance;
let oauth: OAuthFake;

beforeAll(async () => {
  oauth = new OAuthFake();
  const comp: ComponentesFlujoGoogleAds = {
    stateStore: new InMemoryStateStore(),
    credRepo: new InMemoryCredentialRepo(),
    connRepo: new InMemoryConnectionRepo(),
    secretWriter: new EnvelopeSecretBackend(new KmsFake(), new InMemoryCiphertextStore()),
    oauth,
    accounts: new AccountsFake(),
    clientId: 'cid.apps.googleusercontent.com',
    redirectUri: 'https://api/acquisition/google-ads/oauth/callback',
    ahora: () => new Date('2026-08-18T00:00:00Z').toISOString(),
  };
  app = Fastify();
  const store = new FakeStore() as unknown as EventStore;
  registerGoogleAdsOAuthAutenticadas(app, { composicion: comp, store, env: {} as NodeJS.ProcessEnv });
  registerGoogleAdsCallbackPublico(app, { composicion: comp, store, env: {} as NodeJS.ProcessEnv }); // sin webBaseUrl ⇒ JSON
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

async function inj(method: 'GET' | 'POST', url: string, headers: Record<string, string> = H, payload?: unknown) {
  const opts: InjectOptions = { method, url, headers: { 'content-type': 'application/json', ...headers } };
  if (payload !== undefined) opts.payload = payload as InjectOptions['payload'];
  const res = await app.inject(opts);
  bodies.push(res.body);
  return res;
}

describe('GOOGLE_ADS_UI_LOCAL_SMOKE (rutas)', () => {
  it('NOT_CONNECTED: /connection responde estado inicial y configurado', async () => {
    const r = await inj('GET', '/acquisition/google-ads/connection');
    expect(r.statusCode).toBe(200);
    const d = r.json().datos;
    expect(d.conexion.estado).toBe('NOT_CONNECTED');
    expect(d.configurado).toBe(true);
  });

  it('business.manage gate: start sin permiso ⇒ 403', async () => {
    const r = await inj('POST', '/acquisition/google-ads/oauth/start', { 'x-organization-id': 'org-smoke', 'x-actor-id': 'admin' }, {});
    expect(r.statusCode).toBe(403);
  });

  it('flujo completo: start → callback → selección → CONNECTED → refresh(NEEDS_REAUTH) → disconnect', async () => {
    // start
    const start = await inj('POST', '/acquisition/google-ads/oauth/start', H, {});
    expect(start.statusCode).toBe(200);
    const state = start.json().datos.state as string;
    expect(start.json().datos.authorizationUrl).toContain('accounts.google.com');

    // callback público (autoridad = state)
    const cb = await inj('GET', `/acquisition/google-ads/oauth/callback?state=${state}&code=good`, {});
    expect(cb.statusCode).toBe(200);
    expect(cb.json().datos.estado).toBe('ACCOUNT_SELECTION_PENDING');

    // estado intermedio
    expect((await inj('GET', '/acquisition/google-ads/connection')).json().datos.conexion.estado).toBe('ACCOUNT_SELECTION_PENDING');

    // descubrir cuentas
    const acc = await inj('POST', '/acquisition/google-ads/accounts', H, {});
    expect(acc.statusCode).toBe(200);
    expect(acc.json().datos.cuentas[0].customerId).toBe('9090909090');

    // seleccionar cuenta ⇒ CONNECTED
    const sel = await inj('POST', '/acquisition/google-ads/select-account', H, { customerId: '9090909090' });
    expect(sel.statusCode).toBe(200);
    expect(sel.json().datos.estado).toBe('CONNECTED');
    expect((await inj('GET', '/acquisition/google-ads/connection')).json().datos.conexion.estado).toBe('CONNECTED');

    // refresh con token revocado ⇒ NEEDS_REAUTH
    oauth.invalidGrant = true;
    await inj('POST', '/acquisition/google-ads/refresh', H, {});
    expect((await inj('GET', '/acquisition/google-ads/connection')).json().datos.conexion.estado).toBe('NEEDS_REAUTH');

    // desconectar ⇒ DISCONNECTED
    const dis = await inj('POST', '/acquisition/google-ads/disconnect', H, {});
    expect(dis.statusCode).toBe(200);
    expect((await inj('GET', '/acquisition/google-ads/connection')).json().datos.conexion.estado).toBe('DISCONNECTED');
  });

  it('no aparecen tokens/secrets en NINGUNA respuesta', () => {
    const todo = bodies.join('\n');
    expect(todo).not.toContain(SECRET_REFRESH);
    expect(todo).not.toContain('client_secret');
    expect(todo.toLowerCase()).not.toContain('refresh_token');
    expect(todo).not.toContain('secretstore:');
    expect(todo).not.toContain('developer-token');
  });
});
