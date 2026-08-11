import { describe, expect, it } from 'vitest';
import { ActorId, OrganizationId, type RequestContext } from '@soec/contracts';
import { SecretStoreEnv } from '@soec/secretos';
import type { EsquemaSalida } from '@soec/adaptadores';
import { GoogleAdsAdapter } from '../src/ingesta/google-ads-adapter';

const DEV_TOKEN = 'developer-token-super-secreto';
const CLIENT_SECRET = 'client-secret-super-secreto';
const REFRESH_TOKEN = 'refresh-token-super-secreto';
const ACCESS_TOKEN = 'access-token-efimero';

const ESQUEMA: EsquemaSalida = {
  operacion: 'ingesta-ads',
  campos: [
    { nombre: 'query', tipo: 'string' },
    { nombre: 'customerId', tipo: 'string' },
  ],
};

function ctx(): RequestContext {
  const o = OrganizationId('org-smileflow');
  return { organizationId: o, actor: ActorId('t'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: 'c' };
}

function secretStore(): SecretStoreEnv {
  return new SecretStoreEnv({
    GOOGLE_ADS_DEVELOPER_TOKEN: DEV_TOKEN,
    GOOGLE_ADS_CLIENT_ID: 'client-id-publico',
    GOOGLE_ADS_CLIENT_SECRET: CLIENT_SECRET,
    GOOGLE_ADS_REFRESH_TOKEN: REFRESH_TOKEN,
  });
}

const SECRET_REFS = {
  developerToken: 'env:GOOGLE_ADS_DEVELOPER_TOKEN',
  clientId: 'env:GOOGLE_ADS_CLIENT_ID',
  clientSecret: 'env:GOOGLE_ADS_CLIENT_SECRET',
  refreshToken: 'env:GOOGLE_ADS_REFRESH_TOKEN',
} as const;

function solicitud() {
  return {
    solicitudId: 's1',
    capacidadId: 'ingesta-ads',
    peticion: { operacion: 'ingesta-ads', parametros: { query: 'SELECT campaign.id FROM campaign', customerId: '8605539300' } },
  };
}

const BODY_SEARCHSTREAM = JSON.stringify([{ results: [{ campaign: { id: '24120966895' } }] }]);

describe('GoogleAdsAdapter', () => {
  it('host autorizado: intercambia OAuth, llama searchStream con developer-token y devuelve el body (sin filtrar tokens)', async () => {
    let devTokenRecibido: string | null = null;
    let authRecibido: string | null = null;
    let loginRecibido: string | null = null;
    let urlSearchStream: string | null = null;
    const fetchFn = (async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('oauth2.googleapis.com')) {
        return new Response(JSON.stringify({ access_token: ACCESS_TOKEN }), { status: 200 });
      }
      if (url.includes('googleads.googleapis.com')) {
        urlSearchStream = url;
        const h = init?.headers as Record<string, string>;
        devTokenRecibido = h['developer-token'] ?? null;
        authRecibido = h['Authorization'] ?? null;
        loginRecibido = h['login-customer-id'] ?? null;
        return new Response(BODY_SEARCHSTREAM, { status: 200 });
      }
      return new Response('nope', { status: 500 });
    }) as typeof fetch;

    const adapter = new GoogleAdsAdapter({ secretStore: secretStore(), esquemaEgress: ESQUEMA, secretRefs: SECRET_REFS, loginCustomerId: '1742063041', fetchFn });
    const res = await adapter.ejecutar(ctx(), solicitud());

    expect(res.estado).toBe('OK');
    expect(res.salida?.body).toContain('24120966895');
    // usa la versión soportada v25 (v21 quedó deprecada / bloqueada con HTTP 400 UNSUPPORTED_VERSION)
    expect(urlSearchStream).toContain('/v25/customers/8605539300/googleAds:searchStream');
    expect(urlSearchStream).not.toContain('/v21/');
    // los tokens viajaron en headers pero NO aparecen en la salida
    expect(devTokenRecibido).toBe(DEV_TOKEN);
    expect(authRecibido).toBe(`Bearer ${ACCESS_TOKEN}`);
    expect(loginRecibido).toBe('1742063041');
    const asStr = JSON.stringify(res);
    expect(asStr).not.toContain(DEV_TOKEN);
    expect(asStr).not.toContain(ACCESS_TOKEN);
    expect(asStr).not.toContain(CLIENT_SECRET);
    expect(asStr).not.toContain(REFRESH_TOKEN);
  });

  it('host NO autorizado (apiBaseUrl evil): ERROR por default-deny y no golpea el host malicioso', async () => {
    let evilLlamado = false;
    const fetchFn = (async (input: string | URL) => {
      const url = String(input);
      if (url.includes('oauth2.googleapis.com')) return new Response(JSON.stringify({ access_token: ACCESS_TOKEN }), { status: 200 });
      if (url.includes('evil.example.com')) { evilLlamado = true; return new Response('pwned', { status: 200 }); }
      return new Response('nope', { status: 500 });
    }) as typeof fetch;

    const adapter = new GoogleAdsAdapter({ secretStore: secretStore(), esquemaEgress: ESQUEMA, secretRefs: SECRET_REFS, loginCustomerId: '1742063041', fetchFn, apiBaseUrl: 'https://evil.example.com' });
    const res = await adapter.ejecutar(ctx(), solicitud());

    expect(res.estado).toBe('ERROR');
    expect(res.error?.clase).toBe('NO_AUTORIZADO');
    expect(res.salida).toBeNull();
    expect(evilLlamado).toBe(false);
  });

  it('respuesta no-ok del searchStream: ERROR normalizado, sin filtrar tokens', async () => {
    const fetchFn = (async (input: string | URL) => {
      const url = String(input);
      if (url.includes('oauth2.googleapis.com')) return new Response(JSON.stringify({ access_token: ACCESS_TOKEN }), { status: 200 });
      return new Response('boom', { status: 503 });
    }) as typeof fetch;
    const adapter = new GoogleAdsAdapter({ secretStore: secretStore(), esquemaEgress: ESQUEMA, secretRefs: SECRET_REFS, loginCustomerId: '1742063041', fetchFn });
    const res = await adapter.ejecutar(ctx(), solicitud());
    expect(res.estado).toBe('ERROR');
    expect(res.error?.clase).toBe('NO_DISPONIBLE');
    const asStr = JSON.stringify(res);
    expect(asStr).not.toContain(DEV_TOKEN);
    expect(asStr).not.toContain(ACCESS_TOKEN);
  });

  it('es READ ONLY: no expone ningún método público de mutación', () => {
    const adapter = new GoogleAdsAdapter({ secretStore: secretStore(), esquemaEgress: ESQUEMA, secretRefs: SECRET_REFS, loginCustomerId: '1742063041' });
    const proto = Object.getPrototypeOf(adapter) as object;
    const metodos = Object.getOwnPropertyNames(proto);
    for (const prohibido of ['mutate', 'create', 'update', 'remove', 'delete', 'pause', 'enable', 'setBudget', 'setBid', 'addKeyword', 'budget', 'bid', 'keyword']) {
      expect(metodos).not.toContain(prohibido);
      expect((adapter as unknown as Record<string, unknown>)[prohibido]).toBeUndefined();
    }
  });
});
