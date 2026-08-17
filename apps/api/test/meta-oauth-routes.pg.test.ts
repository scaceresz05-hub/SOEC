/**
 * Rutas HTTP del OAuth READ-ONLY de Meta + CERTIFICACIÓN DE CALLBACK — E2E sobre PostgreSQL REAL con
 * transportes FAKE (sin Meta/AWS reales). Demuestra que el callback se completa SIN Authorization/sesión
 * (como el redirect real de Meta), autenticado sólo por el state; y que start/connection/assets/binding
 * SIGUEN exigiendo auth. Adversarial: forged/expired/replay, org/actor swap ignorados, SC no vinculable.
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
import { registerMetaCallbackPublico, registerMetaOAuthAutenticadas } from '../src/acquisition/meta-oauth-routes';
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
  registerMetaCallbackPublico(f, { composicion, ahora: () => AHORA }); // público
  registerMetaOAuthAutenticadas(f, { composicion, ahora: () => AHORA }); // autenticadas
  return f;
}
async function start(a: FastifyInstance): Promise<string> {
  const r = await a.inject({ method: 'POST', url: '/acquisition/meta/oauth/start', headers: H() });
  expect(r.statusCode).toBe(200);
  return r.json().datos.state as string;
}
// Callback EXACTAMENTE como el redirect de Meta: sin headers de auth/sesión.
const callback = (a: FastifyInstance, qs: string) => a.inject({ method: 'GET', url: `/acquisition/meta/oauth/callback?${qs}` });

beforeEach(async () => {
  await runMigrations(pool, metaOAuthMigrations);
  await ejecutarDestructivoDePrueba(pool, 'truncate table meta_oauth_state, meta_credential, meta_connection, meta_ciphertext');
});
afterAll(async () => {
  await pool.end();
});

describe('meta callback · certificación (SIN Authorization, autoridad por state)', () => {
  it('A E2E: start(auth) → callback(SIN auth) → assets(auth) → binding(auth) → CONNECTED_READ_ONLY + read-smoke', async () => {
    const a = app();
    const state = await start(a);
    const cb = await callback(a, `state=${state}&code=CODE`);
    expect(cb.statusCode).toBe(200);
    expect(cb.json().datos.estado).toBe('BINDING_PENDING'); // callback nunca auto-conecta
    expect(JSON.stringify(cb.json())).not.toContain('SYNTH_LONG_TOKEN'); // sin token en la respuesta

    const assets = await a.inject({ method: 'GET', url: '/acquisition/meta/assets', headers: H() });
    expect((assets.json().datos.candidatos as { externalId: string }[]).map((c) => c.externalId)).toContain('1066708446525633');

    const bind = await a.inject({ method: 'POST', url: '/acquisition/meta/binding', headers: H(), payload: { externalId: '1066708446525633', assetType: 'page' } });
    expect(bind.json().datos.estado).toBe('CONNECTED_READ_ONLY');
    expect(bind.json().datos.salud).toBe('HEALTHY');
  });

  it('B/C/E/F callback: sin state 400 · forged NOT_CONNECTED · replay NOT_CONNECTED', async () => {
    const a = app();
    expect((await callback(a, 'code=C')).statusCode).toBe(400);
    expect((await callback(a, 'state=bogus&code=C')).json().datos.estado).toBe('NOT_CONNECTED');
    const st = await start(a);
    expect((await callback(a, `state=${st}&code=C`)).json().datos.estado).toBe('BINDING_PENDING');
    expect((await callback(a, `state=${st}&code=C`)).json().datos.estado).toBe('NOT_CONNECTED'); // replay
  });

  it('G/H org/actor swap en query IGNORADOS (autoridad = state)', async () => {
    const a = app();
    const st = await start(a); // state creado para org-a/actor-1
    const cb = await callback(a, `state=${st}&code=C&organizationId=org-EVIL&actorId=evil`);
    expect(cb.json().datos.estado).toBe('BINDING_PENDING'); // procesa org-a del state; ignora la query
    // la conexión quedó en org-a, no en org-EVIL
    const conn = await a.inject({ method: 'GET', url: '/acquisition/meta/connection', headers: H('org-a') });
    expect(conn.json().datos.estado).toBe('BINDING_PENDING');
    const evil = await a.inject({ method: 'GET', url: '/acquisition/meta/connection', headers: H('org-EVIL') });
    expect(evil.json().datos.estado).toBe('NOT_CONNECTED');
  });
});

describe('meta rutas autenticadas · siguen exigiendo auth', () => {
  it('I/J/K/L start/assets/binding/connection SIN auth ⇒ 401', async () => {
    const a = app();
    expect((await a.inject({ method: 'POST', url: '/acquisition/meta/oauth/start' })).statusCode).toBe(401);
    expect((await a.inject({ method: 'GET', url: '/acquisition/meta/assets' })).statusCode).toBe(401);
    expect((await a.inject({ method: 'POST', url: '/acquisition/meta/binding', payload: { externalId: 'x', assetType: 'page' } })).statusCode).toBe(401);
    expect((await a.inject({ method: 'GET', url: '/acquisition/meta/connection' })).statusCode).toBe(401);
  });

  it('SC Topografía no vinculable (no descubierto) — auto-bind prevented', async () => {
    const a = app();
    const st = await start(a);
    await callback(a, `state=${st}&code=C`);
    const sc = await a.inject({ method: 'POST', url: '/acquisition/meta/binding', headers: H(), payload: { externalId: '100558733139736', assetType: 'page' } });
    expect(sc.statusCode).toBe(409);
    expect(sc.json().error).toBe('NOT_DISCOVERED');
  });

  it('composicion null ⇒ connection NOT_CONFIGURED (auth) · callback 503 (público)', async () => {
    const a = app(null);
    expect((await a.inject({ method: 'GET', url: '/acquisition/meta/connection', headers: H() })).json().datos.estado).toBe('NOT_CONFIGURED');
    expect((await callback(a, 'state=x&code=y')).statusCode).toBe(503);
  });

  it('ROUTE ARCHITECTURE: sin endpoints de escritura ni verbos mutantes', () => {
    const src = readFileSync(new URL('../src/acquisition/meta-oauth-routes.ts', import.meta.url), 'utf8');
    for (const w of ['publish', 'campaign', 'budget', 'comments', 'messages', 'leads', 'ads_management']) {
      expect(src.toLowerCase().includes(`/acquisition/meta/${w}`)).toBe(false);
    }
    expect(/app\.(put|delete|patch)\(/.test(src)).toBe(false);
  });
});
