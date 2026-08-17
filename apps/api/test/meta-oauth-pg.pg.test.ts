/**
 * Persistencia PostgreSQL del OAuth de Meta (Parte 2) sobre `soec_test` REAL. Verifica consumo atómico
 * one-time, expiry/replay/cross-tenant, aislamiento por tenant de credencial/conexión/ciphertext,
 * round-trip del envelope con delete, supervivencia a "reinicio" y que NO se persiste plaintext/token/code.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ActorId, OrganizationId, type RequestContext } from '@soec/contracts';
import { makeTestPool, ejecutarDestructivoDePrueba } from '@soec/event-store/test-db';
import { runMigrations } from '@soec/event-store/pg';
import {
  metaOAuthMigrations,
  PgOAuthStateStore,
  PgCredentialRepo,
  PgConnectionRepo,
  PgCiphertextStore,
} from '../src/acquisition/meta-oauth-pg';
import { EnvelopeSecretBackend, KmsFake } from '../src/acquisition/meta-secret-backend';
import { crearEstadoOAuth, validarEstadoOAuth } from '../src/acquisition/meta-oauth';
import type { CredencialMetaRef, ConexionMeta } from '../src/acquisition/meta-onboarding';

const AHORA = '2026-08-17T12:00:00.000Z';
const pool = makeTestPool();
function ctx(org: string): RequestContext {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('t'), scope: { organizationId: o, permissions: ['events:read'] }, correlationId: 'c' };
}
function nonce(n: number): string {
  return `nonce-impredecible-${n.toString().padStart(20, '0')}`;
}

beforeEach(async () => {
  await runMigrations(pool, metaOAuthMigrations);
  await ejecutarDestructivoDePrueba(pool, 'truncate table meta_oauth_state, meta_credential, meta_connection, meta_ciphertext');
});
afterAll(async () => {
  await pool.end();
});

describe('PG · OAuth state', () => {
  it('A/B create + read', async () => {
    const s = new PgOAuthStateStore(pool);
    const e = crearEstadoOAuth({ nonce: nonce(1), ahora: AHORA, ttlMs: 600_000 }, 'org-a', 'actor-1');
    await s.guardar(e);
    const got = await s.obtener(e.valor);
    expect(got?.organizationId).toBe('org-a');
    expect(got?.actorId).toBe('actor-1'); // actor binding persistido
    expect(got?.consumido).toBe(false);
  });

  it('C/E expired + cross-tenant rechazados por validarEstadoOAuth', async () => {
    const s = new PgOAuthStateStore(pool);
    const e = crearEstadoOAuth({ nonce: nonce(2), ahora: AHORA, ttlMs: 1000 }, 'org-a', 'actor-1');
    await s.guardar(e);
    const almacenado = await s.obtener(e.valor);
    expect(validarEstadoOAuth(almacenado, { valor: e.valor, ahora: '2026-08-17T13:00:00.000Z' })).toBe('STATE_EXPIRADO');
    expect(validarEstadoOAuth(almacenado, { valor: e.valor, organizationIdCallback: 'org-b', ahora: AHORA })).toBe('CROSS_TENANT');
    expect(validarEstadoOAuth(almacenado, { valor: 'otro', ahora: AHORA })).toBe('STATE_DESCONOCIDO');
  });

  it('D CONCURRENT_CONSUME: dos intentos → exactamente uno gana (atómico)', async () => {
    const s = new PgOAuthStateStore(pool);
    const e = crearEstadoOAuth({ nonce: nonce(3), ahora: AHORA, ttlMs: 600_000 }, 'org-a', 'actor-1');
    await s.guardar(e);
    const [r1, r2] = await Promise.all([s.consumir(e.valor), s.consumir(e.valor)]);
    expect([r1, r2].filter((r) => r === 'CONSUMED')).toHaveLength(1);
    expect([r1, r2].filter((r) => r === 'ALREADY_CONSUMED')).toHaveLength(1);
    expect((await s.obtener(e.valor))?.consumido).toBe(true);
    expect(await s.consumir('inexistente')).toBe('NOT_FOUND');
  });
});

describe('PG · credential repo (tenant-scoped, sólo metadata)', () => {
  const cred = (org: string): CredencialMetaRef => ({
    provider: 'meta',
    organizationId: org,
    credentialId: `meta-${org}`,
    tokenType: 'USER_LONG_LIVED',
    secretRef: `secretstore:${org}/meta-user-token`,
    issuedAt: AHORA,
    expiresAt: null,
    lastValidatedAt: AHORA,
    revokedAt: null,
    status: 'ACTIVE',
  });

  it('G store/read tenant-scoped; H no cross-tenant', async () => {
    const repo = new PgCredentialRepo(pool);
    await repo.guardar(cred('org-a'));
    expect((await repo.obtener('org-a', 'meta-org-a'))?.secretRef).toBe('secretstore:org-a/meta-user-token');
    expect(await repo.obtener('org-b', 'meta-org-a')).toBeNull(); // otra org no lo ve
  });
});

describe('PG · connection repo (state machine + candidatos)', () => {
  const conn = (org: string, estado: ConexionMeta['estado']): ConexionMeta => ({
    organizationId: org,
    provider: 'meta',
    connectionId: `meta-${org}`,
    estado,
    salud: 'HEALTHY',
    bindings: [],
    credencialRef: `secretstore:${org}/meta-user-token`,
  });

  it('K persistence + M survives recreation; L cross-tenant reject', async () => {
    await new PgConnectionRepo(pool).guardar({ conexion: conn('org-a', 'BINDING_PENDING'), candidatos: [{ provider: 'meta', assetType: 'page', externalId: '123', displayName: 'X', provenance: 'GRAPH_OBSERVED' }] });
    // "reinicio": instancia nueva del repo leyendo el mismo Postgres.
    const reg = await new PgConnectionRepo(pool).obtener('org-a', 'meta-org-a');
    expect(reg?.conexion.estado).toBe('BINDING_PENDING');
    expect(reg?.candidatos).toHaveLength(1);
    expect(reg?.candidatos[0]?.externalId).toBe('123');
    expect(await new PgConnectionRepo(pool).obtener('org-b', 'meta-org-a')).toBeNull();
  });
});

describe('PG · ciphertext store + envelope (cross-tenant, delete)', () => {
  it('H/I/J round-trip; cross-tenant REJECT; delete ⇒ resolve falla; N no plaintext token', async () => {
    const backend = new EnvelopeSecretBackend(new KmsFake(), new PgCiphertextStore(pool));
    const TOKEN = 'SYNTH_META_TOKEN_do_not_use_pg';
    const { secretRef } = await backend.almacenar('org-a', 'meta-user-token', TOKEN);
    expect((await backend.resolver(ctx('org-a'), secretRef)).usar((v) => v === TOKEN)).toBe(true);
    // cross-tenant: org-b no resuelve el secreto de org-a
    await expect(backend.resolver(ctx('org-b'), secretRef)).rejects.toBeDefined();
    // el token NO está en claro en la tabla
    const raw = await pool.query('select ciphertext, wrapped_data_key from meta_ciphertext');
    expect(JSON.stringify(raw.rows)).not.toContain(TOKEN);
    // delete ⇒ resolve posterior falla
    await backend.revocar(secretRef);
    await expect(backend.resolver(ctx('org-a'), secretRef)).rejects.toBeDefined();
  });

  it('O/P schema sin columnas de token/code/app-secret plaintext', async () => {
    const cols = await pool.query(
      `select table_name, column_name from information_schema.columns
       where table_name in ('meta_oauth_state','meta_credential','meta_connection','meta_ciphertext')`,
    );
    const nombres = cols.rows.map((r: Record<string, unknown>) => String(r['column_name']).toLowerCase());
    for (const prohibido of ['access_token', 'refresh_token', 'authorization_code', 'app_secret', 'plaintext', 'data_key']) {
      expect(nombres).not.toContain(prohibido);
    }
  });
});
