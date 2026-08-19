/**
 * GOOGLE ADS OAUTH — persistencia PG real (tablas google_ads_*): migraciones, consumo ATÓMICO de state
 * (anti-replay), aislamiento por tenant en conexión/credencial, y envelope cifrado con rechazo cross-tenant.
 * Prueba que CROSS_TENANT_GOOGLE_ADS es imposible por construcción a nivel de DB.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { makeTestPool, ejecutarDestructivoDePrueba } from '@soec/event-store/test-db';
import { runMigrations } from '@soec/event-store/pg';
import type { RequestContext } from '@soec/contracts';
import { googleAdsOAuthMigrations, crearRepositoriosGoogleAdsPg, runGoogleAdsMigrationsSeguro } from '../src/acquisition/google-ads-oauth-pg';
import { EnvelopeSecretBackend, KmsFake } from '../src/acquisition/meta-secret-backend';
import { crearEstadoGoogleAds } from '../src/acquisition/google-ads-oauth';
import { conexionInicial, connectionIdDe, type ConexionGoogleAds, type CredencialGoogleAdsRef } from '../src/acquisition/google-ads-connection';

const pool = makeTestPool();
const repos = crearRepositoriosGoogleAdsPg(pool);
const AHORA = '2026-08-18T12:00:00.000Z';

function ctx(org: string): RequestContext {
  return { organizationId: org, actor: 'x', scope: { organizationId: org, permissions: [] }, correlationId: 'c' } as unknown as RequestContext;
}
function conectada(org: string, customerId: string, credencialRef: string): ConexionGoogleAds {
  return { ...conexionInicial(org, AHORA), estado: 'CONNECTED', salud: 'HEALTHY', customerId, loginCustomerId: customerId, descriptiveName: `Cuenta ${customerId}`, credencialRef, updatedAt: AHORA };
}

beforeEach(async () => {
  await runMigrations(pool, googleAdsOAuthMigrations);
  await ejecutarDestructivoDePrueba(pool, 'truncate table google_ads_oauth_state, google_ads_credential, google_ads_connection, google_ads_ciphertext, google_ads_sync_lease');
});
afterAll(async () => {
  await pool.end();
});

describe('google-ads PG · state anti-replay atómico', () => {
  it('consumir es one-time: CONSUMED la primera vez, ALREADY_CONSUMED después; NOT_FOUND si no existe', async () => {
    const st = crearEstadoGoogleAds({ nonce: 'n'.repeat(32), ahora: AHORA, ttlMs: 600_000 }, 'org-a', 'actor');
    await repos.stateStore.guardar(st);
    expect((await repos.stateStore.obtener(st.valor))?.provider).toBe('google-ads');
    expect(await repos.stateStore.consumir(st.valor)).toBe('CONSUMED');
    expect(await repos.stateStore.consumir(st.valor)).toBe('ALREADY_CONSUMED');
    expect(await repos.stateStore.consumir('inexistente')).toBe('NOT_FOUND');
  });
});

describe('google-ads PG · aislamiento por tenant', () => {
  it('la conexión de org-a NO es visible como org-b; listarConectadas devuelve todas las CONNECTED', async () => {
    await repos.connRepo.guardar(conectada('org-a', '1111111111', 'secretstore:org-a/google-ads-refresh-token'));
    await repos.connRepo.guardar(conectada('org-b', '2222222222', 'secretstore:org-b/google-ads-refresh-token'));
    expect((await repos.connRepo.obtener('org-a', connectionIdDe('org-a')))?.customerId).toBe('1111111111');
    expect(await repos.connRepo.obtener('org-b', connectionIdDe('org-a'))).toBeNull(); // no cross-tenant
    const conectadas = await repos.connRepo.listarConectadas();
    expect(conectadas.map((c) => c.organizationId).sort()).toEqual(['org-a', 'org-b']);
  });

  it('credencial: roundtrip con secretRef OPACO (sin material secreto)', async () => {
    const cred: CredencialGoogleAdsRef = { provider: 'google-ads', organizationId: 'org-a', credentialId: connectionIdDe('org-a'), secretRef: 'secretstore:org-a/google-ads-refresh-token', issuedAt: AHORA, lastValidatedAt: AHORA, revokedAt: null, status: 'ACTIVE' };
    await repos.credRepo.guardar(cred);
    const leida = await repos.credRepo.obtener('org-a', connectionIdDe('org-a'));
    expect(leida?.secretRef).toBe('secretstore:org-a/google-ads-refresh-token');
    expect(await repos.credRepo.obtener('org-b', connectionIdDe('org-a'))).toBeNull();
  });
});

describe('google-ads PG · sync lease (single-flight distribuido)', () => {
  const KEY = 'org-a:google-ads-org-a';
  const MAS_TARDE = '2026-08-18T12:11:00.000Z'; // AHORA + 11 min (> TTL 10 min)

  it('scheduler_same_connection_single_flight: la misma conexión sólo la adquiere un holder a la vez', async () => {
    expect(await repos.syncLease.adquirir(KEY, 'replica-A', AHORA)).toBe(true);
    expect(await repos.syncLease.adquirir(KEY, 'replica-B', AHORA)).toBe(false); // A la tiene, no expiró
    await repos.syncLease.liberar(KEY, 'replica-A');
    expect(await repos.syncLease.adquirir(KEY, 'replica-B', AHORA)).toBe(true); // liberada ⇒ B la toma
  });

  it('crash recovery: un lease vencido lo recupera otro holder (expiración por TTL)', async () => {
    expect(await repos.syncLease.adquirir(KEY, 'replica-A', AHORA)).toBe(true);
    expect(await repos.syncLease.adquirir(KEY, 'replica-B', AHORA)).toBe(false);
    // A "crashea" sin liberar; pasado el TTL, B recupera el lease.
    expect(await repos.syncLease.adquirir(KEY, 'replica-B', MAS_TARDE)).toBe(true);
  });

  it('scheduler_different_tenants_can_run_independently: distintas conexiones no se bloquean', async () => {
    expect(await repos.syncLease.adquirir('org-a:c', 'r', AHORA)).toBe(true);
    expect(await repos.syncLease.adquirir('org-b:c', 'r', AHORA)).toBe(true);
  });
});

describe('google-ads PG · boot de migración concurrente', () => {
  it('CONCURRENT_MIGRATION_BOOT: dos instancias migrando a la vez no corrompen ni fallan (advisory lock)', async () => {
    // Simula un ledger sin las migraciones Google Ads (dos boots "frescos").
    await ejecutarDestructivoDePrueba(pool, "delete from schema_migrations where id in ('0001_google_ads_oauth_init','0002_google_ads_sync_lease')");
    // Dos boots concurrentes: el advisory lock los serializa ⇒ ninguno falla por carrera del ledger.
    const [a, b] = await Promise.all([runGoogleAdsMigrationsSeguro(pool), runGoogleAdsMigrationsSeguro(pool)]);
    expect(() => a).not.toThrow();
    expect(() => b).not.toThrow();
    // Cada migración quedó registrada EXACTAMENTE una vez (sin duplicado ni parcial).
    const r = await pool.query("select id, count(*)::int as n from schema_migrations where id like '%google_ads%' group by id");
    for (const row of r.rows as Array<{ id: string; n: number }>) expect(row.n).toBe(1);
    // Las tablas existen (esquema íntegro).
    const t = await pool.query("select to_regclass('public.google_ads_connection') as c, to_regclass('public.google_ads_sync_lease') as l");
    expect(t.rows[0].c).not.toBeNull();
    expect(t.rows[0].l).not.toBeNull();
  });
});

describe('google-ads PG · envelope cifrado (token nunca en claro; cross-tenant rechazado)', () => {
  it('almacena cifrado en google_ads_ciphertext, resuelve para el dueño, RECHAZA a otro tenant', async () => {
    const backend = new EnvelopeSecretBackend(new KmsFake(), repos.ciphertextStore);
    const { secretRef } = await backend.almacenar('org-a', 'google-ads-refresh-token', 'refresh-super-secreto');
    // La fila persistida NO contiene el plaintext.
    const fila = await pool.query('select ciphertext from google_ads_ciphertext where organization_id = $1', ['org-a']);
    expect(String(fila.rows[0].ciphertext)).not.toContain('refresh-super-secreto');
    // El dueño resuelve al valor original (sólo por la caja opaca).
    const resuelto = await backend.resolver(ctx('org-a'), secretRef);
    expect(resuelto.usar((v) => v === 'refresh-super-secreto')).toBe(true);
    // Otro tenant NO puede resolver el secretRef de org-a.
    await expect(backend.resolver(ctx('org-b'), secretRef)).rejects.toThrow();
  });
});
