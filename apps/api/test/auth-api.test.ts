/**
 * Autenticación y autorización multi-tenant vía HTTP (matriz adversarial). Verifica que la
 * AUSENCIA DE SESIÓN NUNCA es autorización: rutas productivas sin cookie → 401; acceso cruzado
 * entre organizaciones rechazado; permisos por rol; AUTONOMOUS_REAL bloqueado; y que con la demo
 * legacy DESHABILITADA (default) las rutas /experience/* no existen (acceso anónimo imposible).
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
  // Plano productivo: pool presente, demo legacy DESHABILITADA (default seguro).
  return buildApp({ store: new InMemoryEventStore(), intelligence: new DeterministicIntelligenceProvider(), pool, legacyDemoAccess: false });
}
type App = ReturnType<typeof makeApp>;

function cookieDe(res: { headers: Record<string, unknown> }): string {
  const sc = res.headers['set-cookie'];
  const raw = Array.isArray(sc) ? (sc[0] as string) : (sc as string);
  return raw.split(';')[0]!;
}

async function registrarYLoguear(app: App, email: string): Promise<string> {
  await app.inject({ method: 'POST', url: '/auth/register', headers: H, payload: { email, displayName: 'U', password: 'Password123' } });
  const login = await app.inject({ method: 'POST', url: '/auth/login', headers: H, payload: { email, password: 'Password123' } });
  return cookieDe(login);
}
async function crearOrg(app: App, cookie: string, slug: string): Promise<void> {
  await app.inject({ method: 'POST', url: '/organizations', headers: { ...H, cookie }, payload: { slug, name: `Org ${slug}` } });
}

beforeEach(async () => {
  await runMigrations(pool, identityMigrations);
  await pool.query('truncate identity_audit_events, identity_invitations, identity_sessions, identity_memberships, identity_organizations, identity_users cascade');
});
afterAll(async () => {
  await pool.end();
});

describe('API · autenticación (sin sesión ⇒ 401)', () => {
  it('1-2. sin cookie o con token inexistente → 401 en rutas productivas', async () => {
    const app = makeApp();
    expect((await app.inject({ method: 'GET', url: '/auth/me' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/organizations' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/organizations', headers: { cookie: 'soec_session=inexistente' } })).statusCode).toBe(401);
  });

  it('login incorrecto → 401 genérico (no enumera)', async () => {
    const app = makeApp();
    await app.inject({ method: 'POST', url: '/auth/register', headers: H, payload: { email: 'a@x.com', displayName: 'A', password: 'Password123' } });
    expect((await app.inject({ method: 'POST', url: '/auth/login', headers: H, payload: { email: 'a@x.com', password: 'mala' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/auth/login', headers: H, payload: { email: 'noexiste@x.com', password: 'Password123' } })).statusCode).toBe(401);
  });

  it('4. sesión revocada (logout) → 401', async () => {
    const app = makeApp();
    const cookie = await registrarYLoguear(app, 'a@x.com');
    expect((await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie } })).statusCode).toBe(200);
    await app.inject({ method: 'POST', url: '/auth/logout', headers: { cookie } });
    expect((await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie } })).statusCode).toBe(401);
  });
});

describe('API · aislamiento multi-tenant', () => {
  it('7-8-13. usuario de A no ve ni modifica B; :org manipulado no da autoridad (404)', async () => {
    const app = makeApp();
    const a = await registrarYLoguear(app, 'a@x.com');
    await crearOrg(app, a, 'org-a');
    const b = await registrarYLoguear(app, 'b@x.com');
    await crearOrg(app, b, 'org-b');
    // A ve org-a (200) pero no org-b (404).
    expect((await app.inject({ method: 'GET', url: '/organizations/org-a', headers: { cookie: a } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/organizations/org-b', headers: { cookie: a } })).statusCode).toBe(404);
    // A intenta modificar org-b (PATCH) → 404.
    expect((await app.inject({ method: 'PATCH', url: '/organizations/org-b', headers: { ...H, cookie: a }, payload: { name: 'hack' } })).statusCode).toBe(404);
  });

  it('9-10. VIEWER no administra miembros (403); OPERATOR no cambia modo (403)', async () => {
    const app = makeApp();
    const owner = await registrarYLoguear(app, 'owner@x.com');
    await crearOrg(app, owner, 'org-a');
    // Invitar VIEWER y aceptar.
    const invV = await app.inject({ method: 'POST', url: '/organizations/org-a/invitations', headers: { ...H, cookie: owner }, payload: { email: 'viewer@x.com', role: 'VIEWER' } });
    const tokenV = invV.json().devToken as string;
    const accV = await app.inject({ method: 'POST', url: `/invitations/${tokenV}/accept`, headers: H, payload: { displayName: 'V', password: 'Password123' } });
    const cookieV = cookieDe(accV);
    // VIEWER intenta invitar → 403.
    expect((await app.inject({ method: 'POST', url: '/organizations/org-a/invitations', headers: { ...H, cookie: cookieV }, payload: { email: 'x@x.com', role: 'ANALYST' } })).statusCode).toBe(403);
    // OPERATOR intenta cambiar modo → 403.
    const invO = await app.inject({ method: 'POST', url: '/organizations/org-a/invitations', headers: { ...H, cookie: owner }, payload: { email: 'op@x.com', role: 'MARKETING_OPERATOR' } });
    const accO = await app.inject({ method: 'POST', url: `/invitations/${invO.json().devToken}/accept`, headers: H, payload: { displayName: 'O', password: 'Password123' } });
    expect((await app.inject({ method: 'PATCH', url: '/organizations/org-a/operational-mode', headers: { ...H, cookie: cookieDe(accO) }, payload: { mode: 'SUPERVISED_REAL' } })).statusCode).toBe(403);
  });

  it('11-17. OWNER administra su org; AUTONOMOUS_REAL rechazado incluso para OWNER (409)', async () => {
    const app = makeApp();
    const owner = await registrarYLoguear(app, 'owner@x.com');
    await crearOrg(app, owner, 'org-a');
    expect((await app.inject({ method: 'PATCH', url: '/organizations/org-a/operational-mode', headers: { ...H, cookie: owner }, payload: { mode: 'SUPERVISED_REAL' } })).statusCode).toBe(200);
    const auto = await app.inject({ method: 'PATCH', url: '/organizations/org-a/operational-mode', headers: { ...H, cookie: owner }, payload: { mode: 'AUTONOMOUS_REAL' } });
    expect(auto.statusCode).toBe(409);
  });
});

describe('API · cutover de la superficie vertical (18)', () => {
  it('sin sesión, una ruta vertical real → 401: ya NO es alcanzable sin autenticación', async () => {
    const app = makeApp(); // pool presente, legacy off ⇒ superficie vertical bajo gateway autenticado
    const res = await app.inject({ method: 'GET', url: '/experiencia/comprender-estado/historial' });
    expect(res.statusCode).toBe(401);
  });

  it('con sesión pero sin organización → 400; con sesión + organización propia el gateway deja pasar', async () => {
    const app = makeApp();
    const cookie = await registrarYLoguear(app, 'a@x.com');
    await crearOrg(app, cookie, 'org-a');
    // Con sesión pero sin indicar organización → 400 (el gateway exige membresía).
    expect((await app.inject({ method: 'GET', url: '/experiencia/comprender-estado/historial', headers: { cookie } })).statusCode).toBe(400);
    // Con sesión + organización propia → pasa el gateway (no 401/404).
    const ok = await app.inject({ method: 'GET', url: '/experiencia/comprender-estado/historial', headers: { cookie, 'x-organization-slug': 'org-a' } });
    expect(ok.statusCode).toBe(200);
  });

  it('con sesión, indicar una organización ajena NO da autoridad (404)', async () => {
    const app = makeApp();
    const a = await registrarYLoguear(app, 'a@x.com');
    await crearOrg(app, a, 'org-a');
    const b = await registrarYLoguear(app, 'b@x.com');
    await crearOrg(app, b, 'org-b');
    // A intenta operar sobre org-b vía cabecera → 404 (no es miembro).
    const res = await app.inject({ method: 'GET', url: '/experiencia/comprender-estado/historial', headers: { cookie: a, 'x-organization-slug': 'org-b' } });
    expect(res.statusCode).toBe(404);
  });

  it('demo legacy: bajo el flag explícito, la misma ruta responde SIN sesión (aislada a test/dev)', async () => {
    const legacy = buildApp({ store: new InMemoryEventStore(), intelligence: new DeterministicIntelligenceProvider(), legacyDemoAccess: true });
    const res = await legacy.inject({ method: 'GET', url: '/experiencia/comprender-estado/historial' });
    expect(res.statusCode).toBe(200);
  });
});
