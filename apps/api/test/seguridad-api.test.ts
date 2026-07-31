/**
 * Endurecimiento vía HTTP (incremento final Macrobloque 1): cabeceras de seguridad en todas las
 * respuestas, rate limiting de login (429 tras varios fallos) y flujo de restablecimiento de
 * contraseña de extremo a extremo. Requiere PostgreSQL de test (plano de identidad).
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { makePool, runMigrations } from '@soec/event-store/pg';
import { identityMigrations } from '@soec/identity/pg';
import { DeterministicIntelligenceProvider } from '@soec/intelligence';
import { buildApp } from '../src/app';

const H = { 'content-type': 'application/json' };
const pool = makePool(process.env.DATABASE_URL ?? 'postgres://soec:soec@localhost:5544/soec');

function makeApp() {
  return buildApp({ store: new InMemoryEventStore(), intelligence: new DeterministicIntelligenceProvider(), pool, legacyDemoAccess: false });
}

beforeEach(async () => {
  await runMigrations(pool, identityMigrations);
  await pool.query('truncate identity_password_resets, identity_audit_events, identity_invitations, identity_sessions, identity_memberships, identity_organizations, identity_users cascade');
});
afterAll(async () => {
  await pool.end();
});

describe('API · cabeceras de seguridad', () => {
  it('todas las respuestas incluyen las cabeceras de endurecimiento', async () => {
    const app = makeApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(String(res.headers['content-security-policy'])).toContain("default-src 'none'");
    // HSTS sólo con cookies Secure (producción): en dev NO debe aparecer.
    expect(res.headers['strict-transport-security']).toBeUndefined();
  });

  it('con secureCookies=true se emite HSTS', async () => {
    const app = buildApp({ store: new InMemoryEventStore(), intelligence: new DeterministicIntelligenceProvider(), pool, secureCookies: true });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(String(res.headers['strict-transport-security'])).toContain('max-age=');
  });
});

describe('API · rate limiting de login', () => {
  it('tras varios intentos fallidos, el login responde 429', async () => {
    const app = makeApp();
    await app.inject({ method: 'POST', url: '/auth/register', headers: H, payload: { email: 'a@x.com', displayName: 'A', password: 'Password123' } });
    // 5 intentos fallidos (mismo email + IP) → el 5º arma el bloqueo.
    for (let i = 0; i < 5; i++) {
      const r = await app.inject({ method: 'POST', url: '/auth/login', headers: H, payload: { email: 'a@x.com', password: 'mala' } });
      expect(r.statusCode).toBe(401);
    }
    // El 6º queda bloqueado (429) aun con credenciales correctas.
    const bloqueado = await app.inject({ method: 'POST', url: '/auth/login', headers: H, payload: { email: 'a@x.com', password: 'Password123' } });
    expect(bloqueado.statusCode).toBe(429);
    expect(bloqueado.headers['retry-after']).toBeDefined();
  });
});

describe('API · restablecimiento de contraseña (extremo a extremo)', () => {
  it('solicitar (devToken en dev) → confirmar → entrar con la nueva contraseña', async () => {
    const app = makeApp();
    await app.inject({ method: 'POST', url: '/auth/register', headers: H, payload: { email: 'a@x.com', displayName: 'A', password: 'Password123' } });
    const req = await app.inject({ method: 'POST', url: '/auth/password-reset/request', headers: H, payload: { email: 'a@x.com' } });
    expect(req.statusCode).toBe(200);
    const devToken = req.json().devToken as string;
    expect(devToken).toBeTruthy();
    const conf = await app.inject({ method: 'POST', url: '/auth/password-reset/confirm', headers: H, payload: { token: devToken, nueva: 'NuevaClave456' } });
    expect(conf.statusCode).toBe(200);
    // La contraseña anterior ya no sirve; la nueva sí.
    expect((await app.inject({ method: 'POST', url: '/auth/login', headers: H, payload: { email: 'a@x.com', password: 'Password123' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/auth/login', headers: H, payload: { email: 'a@x.com', password: 'NuevaClave456' } })).statusCode).toBe(200);
  });

  it('solicitar reset de un email inexistente responde 200 sin devToken (no enumera)', async () => {
    const app = makeApp();
    const req = await app.inject({ method: 'POST', url: '/auth/password-reset/request', headers: H, payload: { email: 'nadie@x.com' } });
    expect(req.statusCode).toBe(200);
    expect(req.json().devToken).toBeUndefined();
  });
});
