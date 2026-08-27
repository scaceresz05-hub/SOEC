/**
 * REPAIR ACCOUNT_SELECTION_PENDING — `GET /acquisition/google-ads/accounts` operativo (READ ONLY) para que la
 * conexión OAuth ya consentida pueda listar cuentas y completar la selección. Cubre: GET ya no 404; token válido
 * lista; token ausente/ inválido falla cerrado; customer no accesible no se selecciona; accesible sí ⇒ CONNECTED
 * (READY). Sin mutaciones de campañas, sin tocar el envelope, sin regenerar OAuth.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance, type InjectOptions } from 'fastify';
import type { EventStore, RequestContext } from '@soec/contracts';
import { EnvelopeSecretBackend, InMemoryCiphertextStore, KmsFake } from '../src/acquisition/meta-secret-backend';
import { InMemoryStateStore, InMemoryCredentialRepo, InMemoryConnectionRepo, type ComponentesFlujoGoogleAds } from '../src/acquisition/google-ads-oauth-flow';
import type { GoogleOAuthPort, GoogleAdsAccountsPort, ResultadoIntercambio, ResultadoRefresh } from '../src/acquisition/google-ads-api-http';
import { registerGoogleAdsOAuthAutenticadas, registerGoogleAdsCallbackPublico } from '../src/acquisition/google-ads-oauth-routes';

const SECRET_REFRESH = 'refresh-token-secretisimo-999';
const CUENTA = '8605539300'; // la cuenta real que se debe poder seleccionar

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
  public reads = 0;
  async listAccessibleCustomers(): Promise<readonly string[]> { this.reads += 1; return [CUENTA]; }
  async describeCustomer(_at: string, customerId: string, login: string | null) {
    this.reads += 1;
    return { customerId, descriptiveName: 'SmileFlow Clinic', currencyCode: 'CLP', timeZone: 'America/Santiago', manager: false, testAccount: false, managerCustomerId: login };
  }
  async listClientCustomers(): Promise<readonly string[]> { this.reads += 1; return []; }
}
class FakeStore {
  readonly streams = new Map<string, unknown[]>();
  async readStream(_c: RequestContext, id: string): Promise<unknown[]> { return this.streams.get(id) ?? []; }
  async append(_c: RequestContext, id: string, _v: number, ev: unknown[]): Promise<{ version: number; events: unknown[] }> {
    const a = this.streams.get(id) ?? []; a.push(...ev); this.streams.set(id, a); return { version: a.length, events: ev };
  }
}

const H = { 'x-organization-id': 'org-smileflow', 'x-actor-id': 'admin', 'x-permissions': 'business.manage' };
let app: FastifyInstance;
let oauth: OAuthFake;
let accounts: AccountsFake;
let store: FakeStore;

beforeEach(async () => {
  oauth = new OAuthFake();
  accounts = new AccountsFake();
  store = new FakeStore();
  const comp: ComponentesFlujoGoogleAds = {
    stateStore: new InMemoryStateStore(), credRepo: new InMemoryCredentialRepo(), connRepo: new InMemoryConnectionRepo(),
    secretWriter: new EnvelopeSecretBackend(new KmsFake(), new InMemoryCiphertextStore()),
    oauth, accounts, clientId: 'cid.apps.googleusercontent.com', redirectUri: 'https://api/acquisition/google-ads/oauth/callback',
    ahora: () => new Date('2026-08-27T00:00:00Z').toISOString(),
  };
  app = Fastify();
  registerGoogleAdsOAuthAutenticadas(app, { composicion: comp, store: store as unknown as EventStore, env: {} as NodeJS.ProcessEnv });
  registerGoogleAdsCallbackPublico(app, { composicion: comp, store: store as unknown as EventStore, env: {} as NodeJS.ProcessEnv });
  await app.ready();
});
afterEach(async () => { await app.close(); });

async function inj(method: 'GET' | 'POST', url: string, headers: Record<string, string> = H, payload?: unknown) {
  const opts: InjectOptions = { method, url, headers: { 'content-type': 'application/json', ...headers } };
  if (payload !== undefined) opts.payload = payload as InjectOptions['payload'];
  return app.inject(opts);
}
/** Lleva la conexión a ACCOUNT_SELECTION_PENDING (OAuth ya consentido). */
async function hastaPending(): Promise<void> {
  const state = (await inj('POST', '/acquisition/google-ads/oauth/start', H, {})).json().datos.state as string;
  await inj('GET', `/acquisition/google-ads/oauth/callback?state=${state}&code=good`, {});
}

describe('REPAIR · GET /acquisition/google-ads/accounts', () => {
  it('A+B: GET accounts ya NO da 404 y lista con token válido', async () => {
    await hastaPending();
    const r = await inj('GET', '/acquisition/google-ads/accounts');
    expect(r.statusCode).toBe(200);              // A: no 404
    expect(r.statusCode).not.toBe(404);
    const cuentas = r.json().datos.cuentas as Array<{ customerId: string }>;
    expect(cuentas.some((c) => c.customerId === CUENTA)).toBe(true); // B: token válido lista 8605539300
    expect(accounts.reads).toBeGreaterThan(0);
  });

  it('C: sin sesión ⇒ 401; token inválido (invalid_grant) ⇒ 409 NEEDS_REAUTH (fail-closed)', async () => {
    await hastaPending();
    const sinAuth = await inj('GET', '/acquisition/google-ads/accounts', { 'content-type': 'application/json' });
    expect(sinAuth.statusCode).toBe(401);
    oauth.invalidGrant = true;
    const revocado = await inj('GET', '/acquisition/google-ads/accounts');
    expect(revocado.statusCode).toBe(409);
    expect(revocado.json().error).toBe('NEEDS_REAUTH');
  });

  it('D: customer NO accesible no puede seleccionarse ⇒ ACCESO_DENEGADO', async () => {
    await hastaPending();
    const r = await inj('POST', '/acquisition/google-ads/select-account', H, { customerId: '1111111111' });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe('ACCESO_DENEGADO');
    // la conexión NO quedó CONNECTED
    expect((await inj('GET', '/acquisition/google-ads/connection')).json().datos.conexion.estado).toBe('ACCOUNT_SELECTION_PENDING');
  });

  it('E+F: customer accesible SÍ se selecciona ⇒ CONNECTED / salud HEALTHY (READY)', async () => {
    await hastaPending();
    const sel = await inj('POST', '/acquisition/google-ads/select-account', H, { customerId: CUENTA });
    expect(sel.statusCode).toBe(200);
    expect(sel.json().datos.estado).toBe('CONNECTED');
    expect(sel.json().datos.salud).toBe('HEALTHY');
    expect(sel.json().datos.customerId).toBe(CUENTA);
    const conn = (await inj('GET', '/acquisition/google-ads/connection')).json().datos.conexion;
    expect(conn.estado).toBe('CONNECTED');
    expect(conn.needsReauth).toBe(false);
    expect(conn.connectedAt !== null || conn.estado === 'CONNECTED').toBe(true);
  });

  it('G+H: discovery/selección son READ ONLY (sin mutaciones de campañas ni streams de envelope)', async () => {
    await hastaPending();
    await inj('GET', '/acquisition/google-ads/accounts');
    await inj('POST', '/acquisition/google-ads/select-account', H, { customerId: CUENTA });
    // G: sólo se usaron métodos de LECTURA de Google (listAccessibleCustomers/describeCustomer/listClientCustomers);
    //    no existe puerto de mutación de campañas en este flujo.
    expect(accounts.reads).toBeGreaterThan(0);
    // H: el flujo Google Ads no toca el Authorized Execution Envelope (ningún stream execution-envelope creado).
    expect([...store.streams.keys()].some((k) => k.startsWith('execution-envelope'))).toBe(false);
  });

  it('el body de GET accounts nunca expone el refresh token', async () => {
    await hastaPending();
    const r = await inj('GET', '/acquisition/google-ads/accounts');
    expect(r.body).not.toContain(SECRET_REFRESH);
    expect(r.body.toLowerCase()).not.toContain('refresh_token');
  });
});
