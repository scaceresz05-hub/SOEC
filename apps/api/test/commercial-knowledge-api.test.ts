/**
 * Superficie AUTENTICADA del CONOCIMIENTO COMERCIAL (A-1). Verifica por HTTP real que un usuario puede
 * poblar el cerebro comercial de SU organización (empresa/producto/ICP/hipótesis) y que, tras poblarlo,
 * el Motor de Generación deja de ABSTENERSE. Seguridad: sin sesión 401, sin permiso 403, cross-tenant 404.
 * Requiere PostgreSQL de test (identidad).
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { makePool, runMigrations } from '@soec/event-store/pg';
import { identityMigrations } from '@soec/identity/pg';
import { DeterministicIntelligenceProvider } from '@soec/intelligence';
import { buildApp } from '../src/app';

const H = { 'content-type': 'application/json' };
const pool = makePool(process.env.DATABASE_URL ?? 'postgres://soec:soec@localhost:5544/soec');

beforeEach(async () => {
  await runMigrations(pool, identityMigrations);
  await pool.query('truncate identity_password_resets, identity_audit_events, identity_invitations, identity_sessions, identity_memberships, identity_organizations, identity_users cascade');
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

async function montar() {
  const app = buildApp({ store: new InMemoryEventStore(), intelligence: new DeterministicIntelligenceProvider(), pool, legacyDemoAccess: false });
  await app.inject({ method: 'POST', url: '/auth/register', headers: H, payload: { email: 'owner@x.com', displayName: 'Owner', password: 'Password123' } });
  const login = await app.inject({ method: 'POST', url: '/auth/login', headers: H, payload: { email: 'owner@x.com', password: 'Password123' } });
  const cookie = cookieDe(login);
  const created = await app.inject({ method: 'POST', url: '/organizations', headers: { ...H, cookie }, payload: { slug: 'ck-org', name: 'CK Org' } });
  return { app, cookie, slug: created.json().slug as string };
}

const auth = (cookie: string, slug: string) => ({ ...H, cookie, 'x-organization-slug': slug });

async function poblar(app: Awaited<ReturnType<typeof montar>>['app'], cookie: string, slug: string) {
  const h = auth(cookie, slug);
  const ck = '/commercial-knowledge';
  await app.inject({ method: 'POST', url: `${ck}/entities`, headers: h, payload: { id: 'empresa', tipo: 'EMPRESA', nombre: 'SmileFlow' } });
  await app.inject({ method: 'PATCH', url: `${ck}/entities/empresa`, headers: h, payload: { clave: 'propuestaValor', valor: 'Odontología cercana y a plazos' } });
  await app.inject({ method: 'POST', url: `${ck}/entities`, headers: h, payload: { id: 'p1', tipo: 'PRODUCTO', nombre: 'Ortodoncia invisible' } });
  await app.inject({ method: 'PATCH', url: `${ck}/entities/p1`, headers: h, payload: { clave: 'problemaQueResuelve', valor: 'alinear dientes sin brackets' } });
  await app.inject({ method: 'PATCH', url: `${ck}/entities/p1`, headers: h, payload: { clave: 'beneficios', valor: 'sonrisa alineada discreta' } });
  await app.inject({ method: 'POST', url: `${ck}/entities`, headers: h, payload: { id: 'icp1', tipo: 'CLIENTE_IDEAL', nombre: 'Adultos jóvenes' } });
  await app.inject({ method: 'PATCH', url: `${ck}/entities/icp1`, headers: h, payload: { clave: 'dolores', valor: 'vergüenza por dientes torcidos' } });
  await app.inject({ method: 'POST', url: `${ck}/hypotheses`, headers: h, payload: { id: 'h1', enunciado: 'Correo convierte para el ICP joven', contexto: 'canales', segmentoId: 'icp1' } });
  await app.inject({ method: 'POST', url: `${ck}/hypotheses/h1/evidence`, headers: h, payload: { descripcion: 'ICP responde a email', origen: 'DATO_IMPORTADO', aFavor: true } });
}

describe('Conocimiento comercial · API autenticada (A-1)', () => {
  it('sin sesión → 401', async () => {
    const { app, slug } = await montar();
    expect((await app.inject({ method: 'GET', url: '/commercial-knowledge', headers: { ...H, 'x-organization-slug': slug } })).statusCode).toBe(401);
  });

  it('cross-tenant: con sesión pero sin membresía en la org pedida → 404', async () => {
    const { app, cookie } = await montar();
    expect((await app.inject({ method: 'GET', url: '/commercial-knowledge', headers: auth(cookie, 'otra-org') })).statusCode).toBe(404);
  });

  it('un VIEWER no puede escribir conocimiento → 403; sí puede leer', async () => {
    const { app, cookie, slug } = await montar();
    const inv = await app.inject({ method: 'POST', url: `/organizations/${slug}/invitations`, headers: { ...H, cookie }, payload: { email: 'v@x.com', role: 'VIEWER' } });
    const acc = await app.inject({ method: 'POST', url: `/invitations/${inv.json().devToken}/accept`, headers: H, payload: { displayName: 'V', password: 'Password123' } });
    const cv = cookieDe(acc);
    expect((await app.inject({ method: 'POST', url: '/commercial-knowledge/entities', headers: auth(cv, slug), payload: { tipo: 'EMPRESA', nombre: 'X' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/commercial-knowledge', headers: auth(cv, slug) })).statusCode).toBe(200);
  });

  it('poblar el CRM por API persiste y deja el motor LISTO; start ya no ABSTIENE', async () => {
    const { app, cookie, slug } = await montar();
    // Antes de poblar: cobertura incompleta y start abstiene.
    const cov0 = await app.inject({ method: 'GET', url: '/commercial-knowledge/coverage', headers: auth(cookie, slug) });
    expect(cov0.json().listoParaGenerar).toBe(false);
    const start0 = await app.inject({ method: 'POST', url: '/generation/programas/progA/start', headers: auth(cookie, slug), payload: { objetivoComercial: 'crecer', objetivoMarketing: 'leads', canales: ['correo'] } });
    expect(start0.statusCode).toBe(422); // ABSTENCION

    await poblar(app, cookie, slug);

    // El conocimiento quedó persistido y visible.
    const listado = await app.inject({ method: 'GET', url: '/commercial-knowledge', headers: auth(cookie, slug) });
    expect((listado.json().entidades as unknown[]).length).toBe(3);
    const hips = await app.inject({ method: 'GET', url: '/commercial-knowledge/hypotheses', headers: auth(cookie, slug) });
    expect(hips.json().hipotesis[0].segmentoId).toBe('icp1');
    const cov = await app.inject({ method: 'GET', url: '/commercial-knowledge/coverage', headers: auth(cookie, slug) });
    expect(cov.json().listoParaGenerar).toBe(true);

    // Ahora el motor SÍ genera (no abstiene).
    const start = await app.inject({ method: 'POST', url: '/generation/programas/progA/start', headers: auth(cookie, slug), payload: { objetivoComercial: 'crecer', objetivoMarketing: 'leads', presupuestoTotal: 100000, canales: ['correo'] } });
    expect(start.statusCode).toBe(201);
    expect(start.json().estado).toBe('PREPARADO');
    expect((start.json().piezas as unknown[]).length).toBeGreaterThan(0);
  });

  it('asociar una hipótesis a un ICP inexistente → 400 gobernado', async () => {
    const { app, cookie, slug } = await montar();
    await app.inject({ method: 'POST', url: '/commercial-knowledge/hypotheses', headers: auth(cookie, slug), payload: { id: 'h9', enunciado: 'algo' } });
    const res = await app.inject({ method: 'POST', url: '/commercial-knowledge/hypotheses/h9/segment', headers: auth(cookie, slug), payload: { segmentoId: 'no-existe' } });
    expect(res.statusCode).toBe(400);
  });
});
