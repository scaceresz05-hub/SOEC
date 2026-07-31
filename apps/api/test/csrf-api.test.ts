/**
 * Protección CSRF/Origin (F-01) vía HTTP. Métodos mutativos con Origin ajeno → 403; con Origin
 * permitido → continúan; sin Origin (cliente no-navegador) → continúan; métodos seguros (GET) nunca
 * se bloquean por CSRF. El chequeo corre antes que la autorización (Origin ajeno → 403 aun sin cookie).
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { makePool, runMigrations } from '@soec/event-store/pg';
import { identityMigrations } from '@soec/identity/pg';
import { DeterministicIntelligenceProvider } from '@soec/intelligence';
import { buildApp } from '../src/app';

const ORIGEN_OK = 'http://localhost:3080';
const ORIGEN_AJENO = 'https://evil.com';
const H = { 'content-type': 'application/json' };
const pool = makePool(process.env.DATABASE_URL ?? 'postgres://soec:soec@localhost:5544/soec');

function makeApp() {
  return buildApp({ store: new InMemoryEventStore(), intelligence: new DeterministicIntelligenceProvider(), pool, allowedOrigins: [ORIGEN_OK] });
}
function cookieDe(res: { headers: Record<string, unknown> }): string {
  const sc = res.headers['set-cookie'];
  const raw = Array.isArray(sc) ? (sc[0] as string) : (sc as string);
  return raw.split(';')[0]!;
}

beforeEach(async () => {
  await runMigrations(pool, identityMigrations);
  await pool.query('truncate identity_password_resets, identity_audit_events, identity_invitations, identity_sessions, identity_memberships, identity_organizations, identity_users cascade');
});
afterAll(async () => {
  await pool.end();
});

describe('API · protección CSRF/Origin (F-01)', () => {
  it('POST con Origin permitido + cookie → permitido; con Origin ajeno → 403', async () => {
    const app = makeApp();
    // register/login sin Origin (cliente no-navegador) → permitido.
    await app.inject({ method: 'POST', url: '/auth/register', headers: H, payload: { email: 'a@x.com', displayName: 'A', password: 'Password123' } });
    const login = await app.inject({ method: 'POST', url: '/auth/login', headers: H, payload: { email: 'a@x.com', password: 'Password123' } });
    const cookie = cookieDe(login);

    // Mutación con Origin permitido → pasa CSRF (201).
    const ok = await app.inject({ method: 'POST', url: '/organizations', headers: { ...H, cookie, origin: ORIGEN_OK }, payload: { slug: 'org-ok', name: 'OK' } });
    expect(ok.statusCode).toBe(201);

    // Mutación con Origin ajeno → 403 (aunque la cookie sea válida).
    const bad = await app.inject({ method: 'POST', url: '/organizations', headers: { ...H, cookie, origin: ORIGEN_AJENO }, payload: { slug: 'org-evil', name: 'X' } });
    expect(bad.statusCode).toBe(403);
  });

  it('PATCH y DELETE con Origin ajeno → 403', async () => {
    const app = makeApp();
    await app.inject({ method: 'POST', url: '/auth/register', headers: H, payload: { email: 'o@x.com', displayName: 'O', password: 'Password123' } });
    const login = await app.inject({ method: 'POST', url: '/auth/login', headers: H, payload: { email: 'o@x.com', password: 'Password123' } });
    const cookie = cookieDe(login);
    await app.inject({ method: 'POST', url: '/organizations', headers: { ...H, cookie, origin: ORIGEN_OK }, payload: { slug: 'org-a', name: 'A' } });

    const patch = await app.inject({ method: 'PATCH', url: '/organizations/org-a', headers: { ...H, cookie, origin: ORIGEN_AJENO }, payload: { name: 'hack' } });
    expect(patch.statusCode).toBe(403);
    const del = await app.inject({ method: 'DELETE', url: '/organizations/org-a/members/algo', headers: { ...H, cookie, origin: ORIGEN_AJENO } });
    expect(del.statusCode).toBe(403);
  });

  it('GET con Origin ajeno NO se bloquea por CSRF (405/200/401 según ruta, nunca 403 por origen)', async () => {
    const app = makeApp();
    const res = await app.inject({ method: 'GET', url: '/organizations', headers: { origin: ORIGEN_AJENO } });
    expect(res.statusCode).toBe(401); // sin sesión → 401 (auth), no 403 (CSRF no aplica a GET)
  });

  it('el chequeo CSRF corre antes que la autorización: Origin ajeno sin cookie → 403', async () => {
    const app = makeApp();
    const res = await app.inject({ method: 'POST', url: '/organizations', headers: { ...H, origin: ORIGEN_AJENO }, payload: { slug: 'x', name: 'x' } });
    expect(res.statusCode).toBe(403);
    // Sin Origin ni cookie → 401 (auth), no 403.
    const sinOrigin = await app.inject({ method: 'POST', url: '/organizations', headers: H, payload: { slug: 'x', name: 'x' } });
    expect(sinOrigin.statusCode).toBe(401);
  });
});
