/**
 * Adapters HTTP reales de Meta (OAuth + Graph read-only) — matriz adversarial con transporte FAKE (sin Meta
 * real). Verifica exchange, errores tipados/sanitizados, discovery de IDs canónicos, paging saneado
 * (sin access_token), appsecret_proof, y la AUSENCIA de métodos write en el port de Graph.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FakeTransporteMeta, MetaAutenticacionError, MetaNoDisponibleError, MetaPermisoError } from '../src/acquisition/meta-http';
import { MetaOAuthHttpAdapter } from '../src/acquisition/meta-oauth-http';
import { MetaGraphReadHttpAdapter } from '../src/acquisition/meta-graph-http';
import { metaOAuthHttpStatus } from '../src/acquisition/meta-runtime';
import type { ConfigMetaOAuth } from '../src/acquisition/meta-config';

const CFG: ConfigMetaOAuth = { appId: 'APP', appSecret: 'SECRET_APP', redirectUri: 'https://soec/cb', graphVersion: 'v26.0' };

describe('meta-oauth-http · exchange', () => {
  it('J-happy: code → long token + scopes + user id (nunca persiste el token)', async () => {
    const a = new MetaOAuthHttpAdapter(CFG, new FakeTransporteMeta());
    const r = await a.exchangeAuthorizationCode('CODE', CFG.redirectUri);
    expect(r.accessTokenValor).toBe('SYNTH_LONG_TOKEN');
    expect(r.tokenType).toBe('USER_LONG_LIVED');
    expect(r.effectiveScopes).toContain('ads_read');
    expect(r.providerUserId).toBe('SYNTH_USER_1');
  });
  it('K Meta invalid code (190) ⇒ AUTH; J timeout ⇒ NoDisponible; error sin token/code', async () => {
    await expect(new MetaOAuthHttpAdapter(CFG, new FakeTransporteMeta({ forzarStatus: 400, forzarErrorCodigo: 190 })).exchangeAuthorizationCode('C', CFG.redirectUri)).rejects.toBeInstanceOf(MetaAutenticacionError);
    await expect(new MetaOAuthHttpAdapter(CFG, new FakeTransporteMeta({ forzarTimeout: true })).exchangeAuthorizationCode('C', CFG.redirectUri)).rejects.toBeInstanceOf(MetaNoDisponibleError);
    try {
      await new MetaOAuthHttpAdapter(CFG, new FakeTransporteMeta({ forzarStatus: 401 })).exchangeAuthorizationCode('SECRETCODE', CFG.redirectUri);
    } catch (e) {
      expect((e as Error).message).not.toContain('SECRETCODE');
      expect((e as Error).message).not.toContain('SECRET_APP');
    }
  });
  it('authorization URL: allowlist read-only, sin scopes de escritura', () => {
    const url = new MetaOAuthHttpAdapter(CFG, new FakeTransporteMeta()).authorizationUrl('ST');
    expect(url).toContain('ads_read');
    expect(url).not.toMatch(/ads_management|leads_retrieval|content_publish|manage_posts/);
  });
});

describe('meta-graph-http · read-only', () => {
  const graph = (opts = {}) => new MetaGraphReadHttpAdapter({ graphVersion: 'v26.0', appSecret: 'SECRET_APP' }, new FakeTransporteMeta(opts), 'SYNTH_LONG_TOKEN');

  it('discovery: IDs canónicos de SmileFlow (business/page/instagram)', async () => {
    expect((await graph().discoverBusinesses())[0]?.externalId).toBe('934186066270538');
    expect((await graph().discoverPages())[0]?.externalId).toBe('1066708446525633');
    expect((await graph().discoverInstagram())[0]?.externalId).toBe('17841432883225770');
  });

  it('PAGING saneado: la respuesta no lleva access_token ni URL next; conserva cursors', async () => {
    const j = (await graph().readAdsInsights('act_1037025024374407')) as { paging?: { cursors?: unknown; next?: unknown } };
    const s = JSON.stringify(j);
    expect(s).not.toContain('access_token');
    expect(s).not.toContain('graph.facebook.com/n?');
    expect(j.paging?.cursors).toBeDefined();
    expect(j.paging?.next).toBeUndefined();
  });

  it('R permission error (código 10) ⇒ MetaPermisoError; appsecret_proof en la URL', async () => {
    const fake = new FakeTransporteMeta();
    await graphConTransporte(fake).discoverBusinesses();
    expect(fake.urls.some((u) => u.includes('appsecret_proof='))).toBe(true);
    await expect(graph({ forzarErrorCodigo: 10, forzarStatus: 403 }).discoverBusinesses()).rejects.toBeInstanceOf(MetaPermisoError);
  });

  function graphConTransporte(t: FakeTransporteMeta): MetaGraphReadHttpAdapter {
    return new MetaGraphReadHttpAdapter({ graphVersion: 'v26.0', appSecret: 'SECRET_APP' }, t, 'SYNTH_LONG_TOKEN');
  }
});

describe('meta · arquitectura y estado', () => {
  it('Z/AA NO_WRITE_METHODS: el adapter de Graph no tiene verbos de escritura ni leads', () => {
    const src = readFileSync(new URL('../src/acquisition/meta-graph-http.ts', import.meta.url), 'utf8');
    for (const verbo of ['create', 'update', 'publish', 'pause', 'budget', 'comment', 'message', 'lead', 'reEncrypt']) {
      // método de escritura = verbo seguido de '(' NO precedido por '.' (excluye llamadas como hmac.update())
      expect(new RegExp(`(?<![.\\w])${verbo}\\s*\\(`, 'i').test(src)).toBe(false);
    }
  });
  it('metaOAuthHttpStatus: sin env ⇒ IMPLEMENTED_NOT_CONFIGURED', () => {
    expect(metaOAuthHttpStatus({})).toBe('IMPLEMENTED_NOT_CONFIGURED');
  });
  it('AD adapters no usan console.log (sin fuga por stdout)', () => {
    for (const f of ['meta-oauth-http.ts', 'meta-graph-http.ts', 'meta-http.ts']) {
      const src = readFileSync(new URL(`../src/acquisition/${f}`, import.meta.url), 'utf8');
      expect(src.includes('console.log')).toBe(false);
    }
  });
});
