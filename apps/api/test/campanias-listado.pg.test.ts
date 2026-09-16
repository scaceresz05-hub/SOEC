/**
 * LISTADO de campañas sobre PostgreSQL REAL, detrás del gateway autenticado.
 *
 * Es la ruta que usa producción: `PgEventStore` + prefix scan sobre `events` (`campania:<org>:%`) acotado
 * por `organization_id`. Los tres borradores de CP se escriben con la MISMA forma que tienen hoy en la base
 * de producción (un `campania.creada` y un `decmkt.creada` por campaña, sin pasar por la API), y se
 * comprueba que el árbol integrado los descubre y los reconstruye sin recrearlos ni escribir nada.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PgEventStore, runMigrations } from '@soec/event-store/pg';
import { identityMigrations } from '@soec/identity/pg';
import { DeterministicIntelligenceProvider } from '@soec/intelligence';
import { ActorId, OrganizationId, type Attribution, type RequestContext } from '@soec/contracts';
import { EVENTOS_CAMPANIA, campaniaStreamId } from '@soec/campanias';
import { DecisionMktService } from '@soec/decisiones-mkt';
import { buildApp } from '../src/app';
import { makeTestPool, ejecutarDestructivoDePrueba } from '@soec/event-store/test-db';

const H = { 'content-type': 'application/json' };
const pool = makeTestPool();
const CP = 'org-cp-odontologia';
const ESPEC = JSON.parse(readFileSync(join(__dirname, '../../../docs/growth/cp-odontologia-borradores.json'), 'utf8')) as {
  borradores: { campaniaId: string; campania: Record<string, unknown>; decision: Record<string, unknown> }[];
};
const ATR: Attribution = { source: 'campanias-borrador', purpose: 'p', assumptions: [], claimType: 'observational', regime: 'empirical', uncertainty: 'media' };

beforeEach(async () => {
  await runMigrations(pool);
  await runMigrations(pool, identityMigrations);
  await ejecutarDestructivoDePrueba(pool, 'truncate table events, outbox restart identity cascade');
  await ejecutarDestructivoDePrueba(
    pool,
    'truncate identity_password_resets, identity_audit_events, identity_invitations, identity_sessions, identity_memberships, identity_organizations, identity_users cascade',
  );
});
afterAll(async () => {
  await pool.end();
});

const ctx = (org: string): RequestContext => {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('owner'), scope: { organizationId: o, permissions: ['events:read', 'events:append'] }, correlationId: 'pg' };
};

async function sembrarComoProduccion(store: PgEventStore): Promise<void> {
  const dec = new DecisionMktService(store);
  for (const b of ESPEC.borradores) {
    const d = b.decision;
    await dec.crear(ctx(CP), `dec-${b.campaniaId}`, {
      organizacionId: CP, objetivo: String(d['objetivo']), contexto: String(d['contexto']), hechos: [],
      fuentes: d['fuentes'] as string[], faltantesObligatorios: d['faltantesObligatorios'] as string[], inferencias: [],
      hipotesis: (d['hipotesis'] as string[]).map((enunciado, i) => ({ id: `h${i + 1}`, enunciado, tipo: 'HIPOTESIS' as const })),
      alternativas: [], justificacion: String(d['justificacion']), riesgos: d['riesgos'] as string[], confianza: null,
      criterioExito: String(d['criterioExito']), criterioFracaso: String(d['criterioFracaso']),
      aprobacionRequerida: true, nivelAutonomia: 0, aprendizajeQueLaCambio: null,
    }, ATR, '2026-09-16T15:00:00.000Z');
    await store.append(ctx(CP), campaniaStreamId(CP, b.campaniaId), 0, [{
      type: EVENTOS_CAMPANIA.creada,
      payload: { ...b.campania, campaniaId: b.campaniaId, organizacionId: CP, decisionId: `dec-${b.campaniaId}`, aprobaciones: [], nivelAutonomia: 0, estado: 'BORRADOR' },
      attribution: ATR,
      occurredAt: '2026-09-16T15:00:00.000Z',
    }]);
  }
}

function cookieDe(res: { headers: Record<string, unknown> }): string {
  const sc = res.headers['set-cookie'];
  const arr = Array.isArray(sc) ? sc : [sc];
  const c = arr.find((x): x is string => typeof x === 'string' && x.startsWith('soec_session='));
  return c ? c.split(';')[0]! : '';
}

async function usuarioConOrg(app: ReturnType<typeof buildApp>, email: string, slug: string): Promise<string> {
  await app.inject({ method: 'POST', url: '/auth/register', headers: H, payload: { email, displayName: email, password: 'Password123' } });
  const cookie = cookieDe(await app.inject({ method: 'POST', url: '/auth/login', headers: H, payload: { email, password: 'Password123' } }));
  const org = await app.inject({ method: 'POST', url: '/organizations', headers: { ...H, cookie }, payload: { slug, name: slug } });
  expect(org.statusCode).toBe(201);
  return cookie;
}

describe('GET /campanias · PostgreSQL real + gateway', () => {
  it('descubre y reconstruye los 4 borradores de CP guardados con la forma de producción, sin escribir', async () => {
    const store = new PgEventStore(pool);
    await sembrarComoProduccion(store);
    const eventosAntes = (await pool.query<{ n: number }>('select count(*)::int n from events')).rows[0]!.n;

    const app = buildApp({ store, intelligence: new DeterministicIntelligenceProvider(), pool, legacyDemoAccess: false });
    const cookie = await usuarioConOrg(app, 'owner@cp.cl', CP);
    const r = await app.inject({ method: 'GET', url: '/campanias?estado=BORRADOR', headers: { ...H, cookie, 'x-organization-slug': CP } });
    expect(r.statusCode, r.body).toBe(200);
    const v = r.json();
    expect(v.total).toBe(4);
    expect(v.campanias.map((c: { campania: { campaniaId: string; presupuesto: unknown; estado: string } }) => [c.campania.campaniaId, c.campania.estado, c.campania.presupuesto])).toEqual([
      ['cp-carillas-estetica-provincia-curico', 'BORRADOR', null],
      ['cp-implantes-provincia-curico', 'BORRADOR', null],
      ['cp-odontologia-general-provincia-curico', 'BORRADOR', null],
      ['cp-rehabilitacion-protesis-provincia-curico', 'BORRADOR', null],
    ]);
    for (const c of v.campanias) expect(c.geographicScope).toBe('Provincia de Curicó, Región del Maule, Chile');

    // Leer no escribe: el recuento de eventos es el mismo (los de identidad viven en otras tablas).
    const eventosDespues = (await pool.query<{ n: number }>('select count(*)::int n from events')).rows[0]!.n;
    expect(eventosDespues).toBe(eventosAntes);
    await app.close();
  });

  it('aislamiento: un usuario de otra organización no ve las campañas de CP, y no puede pedir CP', async () => {
    const store = new PgEventStore(pool);
    await sembrarComoProduccion(store);
    const app = buildApp({ store, intelligence: new DeterministicIntelligenceProvider(), pool, legacyDemoAccess: false });
    const ajena = await usuarioConOrg(app, 'otro@x.cl', 'org-ajena');
    const propia = await app.inject({ method: 'GET', url: '/campanias', headers: { ...H, cookie: ajena, 'x-organization-slug': 'org-ajena' } });
    expect(propia.statusCode).toBe(200);
    expect(propia.json().total).toBe(0);
    // Pedir la organización de CP sin membresía: el gateway corta antes de llegar al listado.
    const cruzada = await app.inject({ method: 'GET', url: '/campanias', headers: { ...H, cookie: ajena, 'x-organization-slug': CP } });
    expect(cruzada.statusCode).toBe(404);
    await app.close();
  });
});
