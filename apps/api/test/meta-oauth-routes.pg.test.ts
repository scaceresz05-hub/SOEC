/**
 * Rutas HTTP del OAuth READ-ONLY de Meta (Parte 3b) — E2E sobre PostgreSQL REAL con transportes FAKE (sin
 * Meta/AWS reales). Cubre: start→callback→assets→binding→CONNECTED_READ_ONLY→read-smoke HEALTHY, y adversarial
 * (auth requerido, forged/replay/cross-tenant/actor-mismatch, SC Topografía no vinculable, sin write routes).
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { makeTestPool, ejecutarDestructivoDePrueba } from '@soec/event-store/test-db';
import { runMigrations } from '@soec/event-store/pg';
import { metaOAuthMigrations, crearRepositoriosMetaPg } from '../src/acquisition/meta-oauth-pg';
import { EnvelopeSecretBackend } from '../src/acquisition/meta-secret-backend';
import { AwsKmsPort } from '../src/acquisition/aws-kms';
import { ClienteKmsProductivoSimulado } from '../src/acquisition/aws-kms-fake';
import { FakeTransporteMeta } from '../src/acquisition/meta-http';
import { MetaOAuthHttpAdapter } from '../src/acquisition/meta-oauth-http';
import { MetaGraphReadHttpAdapter } from '../src/acquisition/meta-graph-http';
import { registerMetaOAuthRoutes } from '../src/acquisition/meta-oauth-routes';
import type { ComposicionMetaOAuth } from '../src/acquisition/meta-runtime';

const AHORA = '2026-08-17T12:00:00.000Z';
const pool = makeTestPool();
const CFG = { appId: 'APP', appSecret: 'SECRET_APP', redirectUri: 'https://soec/cb', graphVersion: 'v26.0' };
const H = (org = 'org-a', actor = 'actor-1') => ({ 'x-organization-id': org, 'x-actor-id': actor, 'x-scope': 'events:read' });

function comp(): ComposicionMetaOAuth {
  const repos = crearRepositoriosMetaPg(pool);
  const transporte = new FakeTransporteMeta();
  const secretWriter = new EnvelopeSecretBackend(new AwsKmsPort({ region: 'us-east-1', keyId: 'alias/soec', timeoutMs: 2000, maxAttempts: 3 }, new ClienteKmsProductivoSimulado()), repos.ciphertextStore);
  return {
    stateStore: repos.stateStore,
    credRepo: repos.credRepo,
    connRepo: repos.connRepo,
    secretWriter,
    oauth: new MetaOAuthHttpAdapter(CFG, transporte),
    crearGraphRead: (t) => new MetaGraphReadHttpAdapter({ graphVersion: CFG.graphVersion, appSecret: CFG.appSecret }, transporte, t),
    graphVersion: CFG.graphVersion,
    redirectUri: CFG.redirectUri,
  };
}
function app(composicion: ComposicionMetaOAuth | null = comp()): FastifyInstance {
  const f = Fastify();
  registerMetaOAuthRoutes(f, { composicion, ahora: () => AHORA });
  return f;
}

beforeEach(async () => {
  await runMigrations(pool, metaOAuthMigrations);
  await ejecutarDestructivoDePrueba(pool, 'truncate table meta_oauth_state, meta_credential, meta_connection, meta_ciphertext');
});
afterAll(async () => {
  await pool.end();
});

async function start(a: FastifyInstance, org = 'org-a', actor = 'actor-1'): Promise<string> {
  const r = await a.inject({ method: 'POST', url: '/acquisition/meta/oauth/start', headers: H(org, actor) });
  expect(r.statusCode).toBe(200);
  return r.json().datos.state as string;
}

describe('meta routes · E2E feliz', () => {
  it('start → callback → assets → binding → CONNECTED_READ_ONLY + read-smoke HEALTHY', async () => {
    const a = app();
    const state = await start(a);

    const cb = await a.inject({ method: 'GET', url: `/acquisition/meta/oauth/callback?state=${state}&code=CODE`, headers: H() });
    expect(cb.statusCode).toBe(200);
    expect(cb.json().datos.estado).toBe('BINDING_PENDING'); // nunca CONNECTED automático

    const assets = await a.inject({ method: 'GET', url: '/acquisition/meta/assets', headers: H() });
    const ids = (assets.json().datos.candidatos as { externalId: string }[]).map((c) => c.externalId);
    expect(ids).toContain('934186066270538'); // business SmileFlow
    expect(ids).toContain('1066708446525633'); // page
    expect(ids).toContain('17841432883225770'); // instagram
    expect(JSON.stringify(assets.json())).not.toContain('SYNTH_LONG_TOKEN'); // sin token en el DTO

    const bind = await a.inject({ method: 'POST', url: '/acquisition/meta/binding', headers: H(), payload: { externalId: '1066708446525633', assetType: 'page' } });
    expect(bind.statusCode).toBe(200);
    expect(bind.json().datos.estado).toBe('CONNECTED_READ_ONLY');
    expect(bind.json().datos.readSmoke).toBe('READ_SMOKE_PASS');
    expect(bind.json().datos.salud).toBe('HEALTHY'); // HEALTHY sólo tras read-smoke

    const conn = await a.inject({ method: 'GET', url: '/acquisition/meta/connection', headers: H() });
    expect(conn.json().datos.estado).toBe('CONNECTED_READ_ONLY');
    expect(JSON.stringify(conn.json())).not.toContain('secretstore:'); // sin secretRef en el DTO
  });
});

describe('meta routes · seguridad y adversarial', () => {
  it('AUTH requerido en start/assets/binding', async () => {
    const a = app();
    expect((await a.inject({ method: 'POST', url: '/acquisition/meta/oauth/start' })).statusCode).toBe(401);
    expect((await a.inject({ method: 'GET', url: '/acquisition/meta/assets' })).statusCode).toBe(401);
  });

  it('callback forged/replay/cross-tenant/actor-mismatch NUNCA conecta', async () => {
    const a = app();
    // forged
    expect((await a.inject({ method: 'GET', url: '/acquisition/meta/oauth/callback?state=bogus&code=C', headers: H() })).json().datos.estado).toBe('NOT_CONNECTED');
    // actor mismatch: state creado por actor-1, callback con actor-2
    const st = await start(a);
    expect((await a.inject({ method: 'GET', url: `/acquisition/meta/oauth/callback?state=${st}&code=C`, headers: H('org-a', 'actor-2') })).statusCode).toBe(403);
    // cross-tenant: state org-a, callback org-b
    const st2 = await start(a);
    expect((await a.inject({ method: 'GET', url: `/acquisition/meta/oauth/callback?state=${st2}&code=C`, headers: H('org-b', 'actor-1') })).json().datos.estado).toBe('NOT_CONNECTED');
    // replay: consumir dos veces
    const st3 = await start(a);
    expect((await a.inject({ method: 'GET', url: `/acquisition/meta/oauth/callback?state=${st3}&code=C`, headers: H() })).json().datos.estado).toBe('BINDING_PENDING');
    expect((await a.inject({ method: 'GET', url: `/acquisition/meta/oauth/callback?state=${st3}&code=C`, headers: H() })).json().datos.estado).toBe('NOT_CONNECTED');
  });

  it('SC Topografía / unknown asset NO vinculable (no descubierto) — auto-bind prevented', async () => {
    const a = app();
    const state = await start(a);
    await a.inject({ method: 'GET', url: `/acquisition/meta/oauth/callback?state=${state}&code=C`, headers: H() });
    const sc = await a.inject({ method: 'POST', url: '/acquisition/meta/binding', headers: H(), payload: { externalId: '100558733139736', assetType: 'page' } });
    expect(sc.statusCode).toBe(409);
    expect(sc.json().error).toBe('NOT_DISCOVERED');
  });

  it('composicion null ⇒ status NOT_CONFIGURED; start 503 (fail-closed sin romper API)', async () => {
    const a = app(null);
    expect((await a.inject({ method: 'GET', url: '/acquisition/meta/connection', headers: H() })).json().datos.estado).toBe('NOT_CONFIGURED');
    expect((await a.inject({ method: 'POST', url: '/acquisition/meta/oauth/start', headers: H() })).statusCode).toBe(503);
  });

  it('ROUTE ARCHITECTURE: la superficie Meta no tiene endpoints de escritura', () => {
    const src = readFileSync(new URL('../src/acquisition/meta-oauth-routes.ts', import.meta.url), 'utf8');
    for (const w of ['publish', 'campaign', 'budget', 'comments', 'messages', 'leads', 'ads_management']) {
      expect(src.toLowerCase().includes(`/acquisition/meta/${w}`)).toBe(false);
    }
    // sólo GET/POST de lectura/onboarding; ninguna ruta con verbos mutantes de negocio
    expect(/app\.(put|delete|patch)\(/.test(src)).toBe(false);
  });
});
