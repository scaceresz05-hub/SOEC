/**
 * Superficie AUTENTICADA del Motor de Generación (Macrobloque 3, Tramo J). Verifica por HTTP real:
 * sesión obligatoria (401), membresía activa (404, la URL no autoriza), autorización fina por permiso
 * atómico (403), gate de aprobación humana (409 → 201), rechazo de modo real (AUTONOMOUS_REAL → 422),
 * rate limiting de acciones (429) y el flujo completo SIMULADO. Requiere PostgreSQL de test (identidad).
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { runMigrations } from '@soec/event-store/pg';
import { identityMigrations } from '@soec/identity/pg';
import { DeterministicIntelligenceProvider } from '@soec/intelligence';
import {
  ActorId,
  OrganizationId,
  type Attribution,
  type EventStore,
  type RequestContext,
} from '@soec/contracts';
import { ConocimientoComercialService, HipotesisComercialService } from '@soec/crm-comercial';
import { buildApp } from '../src/app';
import { RateLimiter } from '../src/rate-limit';
import { makeTestPool, ejecutarDestructivoDePrueba } from '@soec/event-store/test-db';

const H = { 'content-type': 'application/json' };
const pool = makeTestPool();
const O = '2026-08-01T00:00:00.000Z';
const DECL = 'DATO_DECLARADO_POR_USUARIO' as const;
const attr: Attribution = {
  source: 'seed',
  purpose: 'test',
  assumptions: [],
  claimType: 'observational',
  regime: 'empirical',
  uncertainty: 'na',
};

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

async function sembrarConocimiento(store: EventStore, slug: string): Promise<void> {
  const con = new ConocimientoComercialService(store);
  const hip = new HipotesisComercialService(store);
  const c: RequestContext = {
    organizationId: OrganizationId(slug),
    actor: ActorId('seed'),
    scope: { organizationId: OrganizationId(slug), permissions: ['events:append', 'events:read'] },
    correlationId: 'seed',
  };
  await con.registrarEntidad(c, 'empresa', 'EMPRESA', 'SmileFlow', attr, O);
  await con.establecerCampo(
    c,
    'empresa',
    'propuestaValor',
    'Odontología cercana y a plazos',
    DECL,
    attr,
    O,
  );
  await con.registrarEntidad(c, 'p1', 'PRODUCTO', 'Ortodoncia invisible', attr, O);
  await con.establecerCampo(
    c,
    'p1',
    'problemaQueResuelve',
    'alinear dientes sin brackets',
    DECL,
    attr,
    O,
  );
  await con.establecerCampo(c, 'p1', 'beneficios', 'sonrisa alineada discreta', DECL, attr, O);
  await con.registrarEntidad(c, 'icp1', 'CLIENTE_IDEAL', 'Adultos jóvenes profesionales', attr, O);
  await con.establecerCampo(c, 'icp1', 'dolores', 'vergüenza por dientes torcidos', DECL, attr, O);
  await hip.registrar(c, 'h1', 'Correo convierte para el ICP joven', 'canales', attr, O, {
    segmentoId: 'icp1',
  });
  await hip.agregarEvidencia(
    c,
    'h1',
    'e1',
    'ICP responde a email',
    'DATO_IMPORTADO',
    true,
    attr,
    O,
  );
}

const PARAMS = {
  objetivoComercial: 'crecer',
  objetivoMarketing: 'generar leads',
  indicador: 'leads',
  valorEsperado: 100,
  horizonteDias: 30,
  prioridad: 'alta',
  presupuestoTotal: 100000,
  frecuenciaDias: 2,
  canales: ['correo'],
};

/** Monta app+store, registra un OWNER, crea la organización y siembra conocimiento. Devuelve handles. */
async function montar(rateLimit?: RateLimiter) {
  const store = new InMemoryEventStore();
  const app = buildApp({
    store,
    intelligence: new DeterministicIntelligenceProvider(),
    pool,
    legacyDemoAccess: false,
    ...(rateLimit ? { generationRateLimit: rateLimit } : {}),
  });
  await app.inject({
    method: 'POST',
    url: '/auth/register',
    headers: H,
    payload: { email: 'owner@x.com', displayName: 'Owner', password: 'Password123' },
  });
  const login = await app.inject({
    method: 'POST',
    url: '/auth/login',
    headers: H,
    payload: { email: 'owner@x.com', password: 'Password123' },
  });
  const cookie = cookieDe(login);
  const created = await app.inject({
    method: 'POST',
    url: '/organizations',
    headers: { ...H, cookie },
    payload: { slug: 'gen-org', name: 'Gen Org' },
  });
  const slug = created.json().slug as string;
  await sembrarConocimiento(store, slug);
  return { app, store, cookie, slug };
}

/** Cabeceras de una request autenticada a la superficie vertical (cookie + organización). */
function auth(cookie: string, slug: string): Record<string, string> {
  return { ...H, cookie, 'x-organization-slug': slug };
}

describe('Motor de Generación · API autenticada (Tramo J)', () => {
  it('sin sesión → 401 (la ausencia de sesión nunca autoriza)', async () => {
    const { app, slug } = await montar();
    const res = await app.inject({
      method: 'GET',
      url: '/generation/programas/prog1',
      headers: { ...H, 'x-organization-slug': slug },
    });
    expect(res.statusCode).toBe(401);
  });

  it('con sesión pero sin membresía en la organización pedida → 404 (la URL/el header no autorizan)', async () => {
    const { app, cookie } = await montar();
    const res = await app.inject({
      method: 'GET',
      url: '/generation/programas/prog1',
      headers: auth(cookie, 'otra-org-inexistente'),
    });
    expect(res.statusCode).toBe(404);
  });

  it('flujo completo SIMULADO: start (201) → gate 409 → aprobar piezas → run-simulated (201, EVALUADO)', async () => {
    const { app, cookie, slug } = await montar();
    const start = await app.inject({
      method: 'POST',
      url: '/generation/programas/prog1/start',
      headers: auth(cookie, slug),
      payload: PARAMS,
    });
    expect(start.statusCode).toBe(201);
    expect(start.json().estado).toBe('PREPARADO');
    const piezas = start.json().piezas as string[];
    expect(piezas.length).toBeGreaterThan(0);

    // Lecturas gobernadas responden 200 y declaran naturaleza SIMULADO.
    for (const path of [
      'creative-strategies',
      'campaigns',
      'content',
      'experiments',
      'calendar',
      'approvals',
    ]) {
      const r = await app.inject({
        method: 'GET',
        url: `/generation/programas/prog1/${path}`,
        headers: auth(cookie, slug),
      });
      expect(r.statusCode).toBe(200);
      expect(r.json().naturaleza).toBe('SIMULADO');
    }

    // Sin aprobación humana, ejecutar se detiene en 409 PENDIENTE_APROBACION (no ejecuta).
    const pendiente = await app.inject({
      method: 'POST',
      url: '/generation/programas/prog1/run-simulated',
      headers: auth(cookie, slug),
      payload: {},
    });
    expect(pendiente.statusCode).toBe(409);
    expect(pendiente.json().estado).toBe('PENDIENTE_APROBACION');

    // Aprobación humana granular de TODOS los recursos (piezas + variantes + calendario), en su versión real.
    const listado = await app.inject({
      method: 'GET',
      url: '/generation/programas/prog1/approvals',
      headers: auth(cookie, slug),
    });
    const recursos = listado.json().aprobaciones as {
      resourceType: string;
      resourceId: string;
      resourceVersion: number;
    }[];
    expect(recursos.some((r) => r.resourceType === 'VARIANTE')).toBe(true);
    expect(recursos.some((r) => r.resourceType === 'ENTRADA_CALENDARIO')).toBe(true);
    for (const r of recursos) {
      const apr = await app.inject({
        method: 'POST',
        url: '/generation/programas/prog1/approvals',
        headers: auth(cookie, slug),
        payload: {
          resourceType: r.resourceType,
          resourceId: r.resourceId,
          resourceVersion: r.resourceVersion,
          decision: 'APROBADA',
        },
      });
      expect(apr.statusCode).toBe(201);
    }

    // Ahora sí ejecuta el ciclo simulado hasta dejar el programa EVALUADO.
    const run = await app.inject({
      method: 'POST',
      url: '/generation/programas/prog1/run-simulated',
      headers: auth(cookie, slug),
      payload: { modo: 'PILOT' },
    });
    expect(run.statusCode).toBe(201);
    expect(run.json().estado).toBe('EJECUTADO_SIMULADO');
    expect(run.json().naturaleza).toBe('SIMULADO');
  });

  it('rechaza la ejecución en modo real (AUTONOMOUS_REAL) → 422 MODO_REAL_BLOQUEADO', async () => {
    const { app, cookie, slug } = await montar();
    await app.inject({
      method: 'POST',
      url: '/generation/programas/prog1/start',
      headers: auth(cookie, slug),
      payload: PARAMS,
    });
    const real = await app.inject({
      method: 'POST',
      url: '/generation/programas/prog1/run-simulated',
      headers: auth(cookie, slug),
      payload: { real: true },
    });
    expect(real.statusCode).toBe(422);
    expect(real.json().error).toBe('MODO_REAL_BLOQUEADO');
  });

  it('autorización fina: un VIEWER no puede iniciar generación → 403 (permiso atómico faltante)', async () => {
    const { app, cookie, slug } = await montar();
    const inv = await app.inject({
      method: 'POST',
      url: `/organizations/${slug}/invitations`,
      headers: { ...H, cookie },
      payload: { email: 'viewer@x.com', role: 'VIEWER' },
    });
    const token = inv.json().devToken as string;
    const acc = await app.inject({
      method: 'POST',
      url: `/invitations/${token}/accept`,
      headers: H,
      payload: { displayName: 'Viewer', password: 'Password123' },
    });
    const cookieViewer = cookieDe(acc);
    // El VIEWER es miembro (no es 404) pero carece de generation.start → 403.
    const res = await app.inject({
      method: 'POST',
      url: '/generation/programas/prog1/start',
      headers: auth(cookieViewer, slug),
      payload: PARAMS,
    });
    expect(res.statusCode).toBe(403);
    // …aunque SÍ puede leer (generation.read es transversal).
    const lectura = await app.inject({
      method: 'GET',
      url: '/generation/programas/prog1',
      headers: auth(cookieViewer, slug),
    });
    expect([200, 404]).toContain(lectura.statusCode); // 404 si aún no hay programa; nunca 403
  });

  it('rate limiting de acciones de generación: supera el límite → 429 con retry-after', async () => {
    const { app, cookie, slug } = await montar(
      new RateLimiter({ maxIntentos: 2, ventanaMs: 60_000, bloqueoMs: 60_000 }),
    );
    const call = () =>
      app.inject({
        method: 'POST',
        url: '/generation/programas/prog1/start',
        headers: auth(cookie, slug),
        payload: PARAMS,
      });
    expect((await call()).statusCode).toBe(201);
    const segundo = await call();
    expect(segundo.statusCode).toBe(429);
    expect(segundo.headers['retry-after']).toBeDefined();
  });
});
