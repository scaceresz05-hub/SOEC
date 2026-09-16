/**
 * Campañas en BORRADOR detrás del GATEWAY REAL (sesión + membresía + rol), con PostgreSQL de identidad.
 *
 * La prueba unitaria (`campanias-borrador-api.test.ts`) fija la lógica con cabeceras de contexto
 * aportadas por el test. Ésta comprueba que, en la composición productiva, esas cabeceras las pone el
 * gateway y no el cliente: sin sesión 401, sin membresía 404, un VIEWER no crea (403) pero sí lee, y un
 * cliente que intenta falsificar `x-permissions` u otra organización no consigue nada.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { runMigrations } from '@soec/event-store/pg';
import { identityMigrations } from '@soec/identity/pg';
import { DeterministicIntelligenceProvider } from '@soec/intelligence';
import { buildApp } from '../src/app';
import { makeTestPool, ejecutarDestructivoDePrueba } from '@soec/event-store/test-db';

const H = { 'content-type': 'application/json' };
const pool = makeTestPool();

const ESPEC = JSON.parse(
  readFileSync(join(__dirname, '../../../docs/growth/cp-odontologia-borradores.json'), 'utf8'),
) as { borradores: { campaniaId: string; campania: Record<string, unknown>; decision: Record<string, unknown> }[] };
const IMPLANTES = ESPEC.borradores[0]!;

beforeEach(async () => {
  await runMigrations(pool, identityMigrations);
  await ejecutarDestructivoDePrueba(
    pool,
    'truncate identity_password_resets, identity_audit_events, identity_invitations, identity_sessions, identity_memberships, identity_organizations, identity_users cascade',
  );
});
afterAll(async () => {
  await pool.end();
});

function cookieDe(res: { headers: Record<string, unknown> }): string {
  const sc = res.headers['set-cookie'];
  const arr = Array.isArray(sc) ? sc : [sc];
  const c = arr.find((x): x is string => typeof x === 'string' && x.startsWith('soec_session='));
  return c ? c.split(';')[0]! : '';
}

/** Owner con la organización `org-cp-odontologia` creada por el endpoint real. */
async function montar() {
  const app = buildApp({
    store: new InMemoryEventStore(),
    intelligence: new DeterministicIntelligenceProvider(),
    pool,
    legacyDemoAccess: false,
  });
  await app.inject({ method: 'POST', url: '/auth/register', headers: H, payload: { email: 'owner@x.com', displayName: 'Owner', password: 'Password123' } });
  const login = await app.inject({ method: 'POST', url: '/auth/login', headers: H, payload: { email: 'owner@x.com', password: 'Password123' } });
  const cookie = cookieDe(login);
  const org = await app.inject({ method: 'POST', url: '/organizations', headers: { ...H, cookie }, payload: { slug: 'org-cp-odontologia', name: 'CP Odontología' } });
  expect(org.statusCode).toBe(201);
  return { app, cookie };
}

const auth = (cookie: string, slug = 'org-cp-odontologia') => ({ ...H, cookie, 'x-organization-slug': slug });

describe('Campañas en BORRADOR · gateway autenticado real', () => {
  it('sin sesión → 401', async () => {
    const { app } = await montar();
    const r = await app.inject({ method: 'POST', url: '/campanias/borradores', headers: { ...H, 'x-organization-slug': 'org-cp-odontologia' }, payload: IMPLANTES });
    expect(r.statusCode).toBe(401);
  });

  it('con sesión pero sin membresía en la organización pedida → 404', async () => {
    const { app, cookie } = await montar();
    const r = await app.inject({ method: 'POST', url: '/campanias/borradores', headers: auth(cookie, 'org-ajena'), payload: IMPLANTES });
    expect(r.statusCode).toBe(404);
  });

  it('OWNER crea el borrador real de CP: BORRADOR, presupuesto null, Provincia de Curicó', async () => {
    const { app, cookie } = await montar();
    const r = await app.inject({ method: 'POST', url: '/campanias/borradores', headers: auth(cookie), payload: IMPLANTES });
    expect(r.statusCode, r.body).toBe(201);
    const v = r.json();
    expect(v.campania.organizacionId).toBe('org-cp-odontologia');
    expect(v.campania.estado).toBe('BORRADOR');
    expect(v.campania.presupuesto).toBeNull();
    expect(v.geographicScope).toBe('Provincia de Curicó, Región del Maule, Chile');
    expect(v.decision.estado).toBe('NO_EVALUABLE');
    const g = await app.inject({ method: 'GET', url: `/campanias/${IMPLANTES.campaniaId}`, headers: auth(cookie) });
    expect(g.statusCode).toBe(200);
  });

  it('las cabeceras de contexto las fija el gateway: falsificar x-permissions u otra org no sirve', async () => {
    const { app, cookie } = await montar();
    await app.inject({ method: 'POST', url: '/campanias/borradores', headers: auth(cookie), payload: IMPLANTES });
    // Un cliente que declara otra organización en x-organization-id sigue operando en la suya (la de la sesión).
    const r = await app.inject({
      method: 'GET',
      url: `/campanias/${IMPLANTES.campaniaId}`,
      headers: { ...auth(cookie), 'x-organization-id': 'org-smileflow', 'x-permissions': 'nada' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().campania.organizacionId).toBe('org-cp-odontologia');
  });

  it('un VIEWER no crea ni edita borradores (403) pero sí los lee', async () => {
    const { app, cookie } = await montar();
    await app.inject({ method: 'POST', url: '/campanias/borradores', headers: auth(cookie), payload: IMPLANTES });
    const inv = await app.inject({ method: 'POST', url: '/organizations/org-cp-odontologia/invitations', headers: { ...H, cookie }, payload: { email: 'v@x.com', role: 'VIEWER' } });
    const acc = await app.inject({ method: 'POST', url: `/invitations/${inv.json().devToken}/accept`, headers: H, payload: { displayName: 'V', password: 'Password123' } });
    const cv = cookieDe(acc);
    const otro = { ...IMPLANTES, campaniaId: 'cp-viewer-no' };
    expect((await app.inject({ method: 'POST', url: '/campanias/borradores', headers: auth(cv), payload: otro })).statusCode).toBe(403);
    expect(
      (await app.inject({ method: 'PATCH', url: `/campanias/${IMPLANTES.campaniaId}/borrador`, headers: auth(cv), payload: { canal: 'META_INSTAGRAM' } })).statusCode,
    ).toBe(403);
    const g = await app.inject({ method: 'GET', url: `/campanias/${IMPLANTES.campaniaId}`, headers: auth(cv) });
    expect(g.statusCode).toBe(200);
    expect(g.json().campania.canal).toBe('GOOGLE_SEARCH');
  });
});
