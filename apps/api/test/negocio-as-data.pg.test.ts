/**
 * Autonomy Fase A · NEGOCIO COMO DATO — test de aceptación sobre PostgreSQL REAL.
 *
 * Demuestra la afirmación que define la fase: incorporar una empresa nueva a SOEC no requiere un módulo
 * TypeScript, ni tocar el registro, ni desplegar, ni crear variables de entorno. Todo ocurre por la MISMA
 * API que usa la interfaz.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@soec/event-store/pg';
import { identityMigrations } from '@soec/identity/pg';
import { InMemoryEventStore } from '@soec/event-store';
import { DeterministicIntelligenceProvider } from '@soec/intelligence';
import { makeTestPool, ejecutarDestructivoDePrueba } from '@soec/event-store/test-db';
import { buildApp } from '../src/app';
import { negocioMigrations, RepositorioNegocios } from '../src/negocio/negocio-pg';
import { migrarNegociosDelRegistro } from '../src/negocio/migracion-registro';
import { crearDescubridorDeNegocios } from '../src/negocio/descubrimiento';
import { slugDeNegocio } from '../src/negocio/negocio-service';

const H = { 'content-type': 'application/json' };
const pool = makeTestPool();
const NOMBRE_QA = 'Empresa QA Autonomy';

beforeEach(async () => {
  await runMigrations(pool);
  await runMigrations(pool, identityMigrations);
  await runMigrations(pool, negocioMigrations);
  await ejecutarDestructivoDePrueba(pool, 'truncate business_audit, business_restriction, business_geo_scope, business_offering, business_objective, business_governance, business_profile restart identity cascade');
  await ejecutarDestructivoDePrueba(
    pool,
    'truncate identity_password_resets, identity_audit_events, identity_invitations, identity_sessions, identity_memberships, identity_organizations, identity_users cascade',
  );
});
afterAll(async () => { await pool.end(); });

function app() {
  return buildApp({ store: new InMemoryEventStore(), intelligence: new DeterministicIntelligenceProvider(), pool, legacyDemoAccess: false });
}
type App = ReturnType<typeof app>;

function cookieDe(res: { headers: Record<string, unknown> }): string {
  const sc = res.headers['set-cookie'];
  const arr = Array.isArray(sc) ? sc : [sc];
  const c = arr.find((x): x is string => typeof x === 'string' && x.startsWith('soec_session='));
  return c ? c.split(';')[0]! : '';
}

async function usuario(a: App, email: string): Promise<string> {
  await a.inject({ method: 'POST', url: '/auth/register', headers: H, payload: { email, displayName: email, password: 'Password123' } });
  return cookieDe(await a.inject({ method: 'POST', url: '/auth/login', headers: H, payload: { email, password: 'Password123' } }));
}

const ENTRADA_QA = {
  displayName: NOMBRE_QA,
  businessType: 'SERVICIOS',
  country: 'CL',
  currency: 'CLP',
  timezone: 'America/Santiago',
  website: 'https://qa-autonomy.example',
  description: 'empresa de prueba creada íntegramente por API',
  primaryObjective: 'validar que una empresa nueva no necesita código',
};

describe('alta de una empresa nueva · sólo por API', () => {
  it('no existe antes, se crea, queda con dueño y postura segura, y se puede leer y editar', async () => {
    const a = app();
    const cookie = await usuario(a, 'qa-owner@soec.cl');
    const repo = new RepositorioNegocios(pool);

    // 1) No existe.
    expect((await repo.listarTodos()).some((p) => p.displayName === NOMBRE_QA)).toBe(false);

    // 2) CREATE por la misma API que usa la interfaz.
    const creado = await a.inject({ method: 'POST', url: '/negocios', headers: { ...H, cookie }, payload: ENTRADA_QA });
    expect(creado.statusCode, creado.body).toBe(201);
    const negocio = creado.json();
    const org = negocio.perfil.organizationId as string;
    expect(negocio.perfil.displayName).toBe(NOMBRE_QA);
    expect(negocio.perfil.status).toBe('DRAFT');
    expect(negocio.perfil.businessKey).toMatch(/^[0-9a-f-]{36}$/); // identidad opaca, no derivada del nombre
    expect(org).not.toBe(negocio.perfil.businessKey);

    // 3) POSTURA SEGURA: nada encendido. Crear una empresa no puede gastar.
    expect(negocio.gobierno).toMatchObject({ externalMutations: false, autonomousSpend: false, automaticSafetyPause: false, campaignExecution: false });

    // 4) MEMBRESÍA del propietario creada en la misma transacción.
    const orgs = (await a.inject({ method: 'GET', url: '/organizations', headers: { cookie } })).json();
    expect(orgs.organizaciones.find((o: { slug: string; role: string }) => o.slug === org)?.role).toBe('OWNER');

    // 5) LIST y GET.
    const lista = (await a.inject({ method: 'GET', url: '/negocios', headers: { cookie } })).json();
    expect(lista.filtradoPorMembresia).toBe(true);
    expect(lista.negocios.map((n: { organizationId: string }) => n.organizationId)).toContain(org);
    const leido = await a.inject({ method: 'GET', url: `/negocios/${org}`, headers: { cookie, 'x-organization-slug': org } });
    expect(leido.statusCode, leido.body).toBe(200);
    expect(leido.json().perfil.website).toBe('https://qa-autonomy.example/');

    // 6) UPDATE: el nombre cambia; la identidad NO.
    const editado = await a.inject({ method: 'PATCH', url: `/negocios/${org}`, headers: { ...H, cookie, 'x-organization-slug': org }, payload: { displayName: 'Empresa QA Autonomy (editada)', status: 'CONFIGURING' } });
    expect(editado.statusCode, editado.body).toBe(200);
    expect(editado.json().perfil.displayName).toBe('Empresa QA Autonomy (editada)');
    expect(editado.json().perfil.organizationId).toBe(org);
    expect(editado.json().perfil.businessKey).toBe(negocio.perfil.businessKey);
    expect(editado.json().perfil.status).toBe('CONFIGURING');

    // 7) El RUNTIME la descubre: el descubrimiento sale de la base, no de un array en código.
    expect(await crearDescubridorDeNegocios(pool)()).toContain(org);

    // 8) AUDITORÍA con actor, organización y campos cambiados; sin secretos.
    const auditoria = await pool.query('select action, actor, changed_fields from business_audit where organization_id = $1 order by id', [org]);
    expect(auditoria.rows.map((r: { action: string }) => r.action)).toEqual(['BUSINESS_CREATED', 'BUSINESS_STATUS_CHANGED']);
    expect(JSON.stringify(auditoria.rows)).not.toMatch(/password|token|secret/i);

    // 9) NO hay módulo TypeScript ni entrada en el registro para esta empresa.
    const dirNegocios = join(__dirname, '../src/plataforma/negocios');
    expect(readdirSync(dirNegocios).some((f) => f.toLowerCase().includes('qa'))).toBe(false);
    const registro = readFileSync(join(__dirname, '../src/plataforma/registro.ts'), 'utf8');
    expect(registro).not.toContain(org);
    expect(registro).not.toContain('QA Autonomy');

    // 10) NINGUNA variable de entorno específica de la empresa.
    const prefijo = org.split('-')[0]!.toUpperCase();
    expect(Object.keys(process.env).some((k) => k.startsWith(prefijo) && k.length > prefijo.length)).toBe(false);

    await a.close();
  });

  it('otro tenant no ve ni puede leer la empresa ajena', async () => {
    const a = app();
    const cookieA = await usuario(a, 'duena@soec.cl');
    const cookieB = await usuario(a, 'ajena@soec.cl');
    const org = (await a.inject({ method: 'POST', url: '/negocios', headers: { ...H, cookie: cookieA }, payload: ENTRADA_QA })).json().perfil.organizationId;

    // Su listado no la incluye…
    const listaB = (await a.inject({ method: 'GET', url: '/negocios', headers: { cookie: cookieB } })).json();
    expect(listaB.negocios).toEqual([]);
    // …y pedirla explícitamente tampoco sirve: sin membresía, el gateway responde 404 (no revela existencia).
    const leerB = await a.inject({ method: 'GET', url: `/negocios/${org}`, headers: { cookie: cookieB, 'x-organization-slug': org } });
    expect([403, 404]).toContain(leerB.statusCode);
    const editarB = await a.inject({ method: 'PATCH', url: `/negocios/${org}`, headers: { ...H, cookie: cookieB, 'x-organization-slug': org }, payload: { displayName: 'secuestrada' } });
    expect([403, 404]).toContain(editarB.statusCode);
    expect((await new RepositorioNegocios(pool).perfil(org))?.displayName).toBe(NOMBRE_QA);
    await a.close();
  });

  it('sin sesión no se crea nada, y una entrada inválida no deja organización huérfana', async () => {
    const a = app();
    const sinSesion = await a.inject({ method: 'POST', url: '/negocios', headers: H, payload: ENTRADA_QA });
    expect(sinSesion.statusCode).toBe(401);

    const cookie = await usuario(a, 'validacion@soec.cl');
    const invalida = await a.inject({ method: 'POST', url: '/negocios', headers: { ...H, cookie }, payload: { ...ENTRADA_QA, businessType: 'LO_QUE_SEA' } });
    expect(invalida.statusCode).toBe(400);
    const sitioMalo = await a.inject({ method: 'POST', url: '/negocios', headers: { ...H, cookie }, payload: { ...ENTRADA_QA, website: 'no-es-una-url' } });
    expect(sitioMalo.statusCode).toBe(400);

    // Ni organizaciones ni perfiles a medias.
    expect((await pool.query('select count(*)::int n from identity_organizations')).rows[0].n).toBe(0);
    expect((await new RepositorioNegocios(pool).listarTodos()).length).toBe(0);
    await a.close();
  });

  it('dos empresas con el mismo nombre no colisionan y su identidad es distinta', async () => {
    const a = app();
    const cookie = await usuario(a, 'dos@soec.cl');
    const una = (await a.inject({ method: 'POST', url: '/negocios', headers: { ...H, cookie }, payload: ENTRADA_QA })).json();
    const otra = (await a.inject({ method: 'POST', url: '/negocios', headers: { ...H, cookie }, payload: ENTRADA_QA })).json();
    expect(una.perfil.organizationId).not.toBe(otra.perfil.organizationId);
    expect(una.perfil.businessKey).not.toBe(otra.perfil.businessKey);
    await a.close();
  });
});

describe('migración de los negocios históricos', () => {
  it('SmileFlow y CP quedan persistidos sin duplicar organizaciones ni regenerar identidades', async () => {
    const r1 = await migrarNegociosDelRegistro(pool);
    expect(r1.migrados).toContain('org-smileflow');
    expect(r1.migrados).toContain('org-cp-odontologia');

    const repo = new RepositorioNegocios(pool);
    const sf = await repo.completo('org-smileflow');
    const cp = await repo.completo('org-cp-odontologia');
    expect(sf?.perfil.organizationId).toBe('org-smileflow'); // identidad intacta
    expect(sf?.perfil.businessType).toBe('SAAS');
    expect(sf?.perfil.status).toBe('ACTIVE');
    expect(cp?.perfil.businessType).toBe('CLINICA');
    expect(cp?.perfil.primaryObjective).toMatch(/captar pacientes/);

    // Gobierno preservado: SmileFlow conserva su pausa automática; CP no la tiene.
    expect(sf?.gobierno.automaticSafetyPause).toBe(true);
    expect(cp?.gobierno.automaticSafetyPause).toBe(false);
    for (const n of [sf, cp]) {
      expect(n?.gobierno.externalMutations).toBe(false);
      expect(n?.gobierno.autonomousSpend).toBe(false);
      expect(n?.gobierno.campaignExecution).toBe(false);
    }

    // Territorio de CP: 9 comunas declaradas como alcance del NEGOCIO (lo ejecutable en Google es otra cosa).
    const territorio = cp?.territorios.find((t) => t.ambito === 'BUSINESS');
    expect(territorio?.localities).toHaveLength(9);
    expect(territorio?.criterio).toBe('PRESENCIA');

    // Oferta como dato: la especialidad y las líneas declaradas dejan de vivir en TypeScript.
    expect(cp?.oferta.map((o) => o.slug)).toContain('rehabilitacion-oral');
    expect(cp?.oferta.every((o) => o.advertisingEligibility === 'REQUIRES_APPROVAL')).toBe(true);

    // IDEMPOTENTE: una segunda corrida no vuelve a migrar ni duplica filas.
    const r2 = await migrarNegociosDelRegistro(pool);
    expect(r2.migrados).toEqual([]);
    expect(r2.yaEstaban).toContain('org-smileflow');
    expect((await pool.query('select count(*)::int n from business_profile')).rows[0].n).toBe(r1.migrados.length);
  });

  it('el descubrimiento del runtime devuelve las empresas migradas y las creadas por API', async () => {
    await migrarNegociosDelRegistro(pool);
    const a = app();
    const cookie = await usuario(a, 'mixta@soec.cl');
    const org = (await a.inject({ method: 'POST', url: '/negocios', headers: { ...H, cookie }, payload: ENTRADA_QA })).json().perfil.organizationId;
    const descubiertas = await crearDescubridorDeNegocios(pool)();
    expect(descubiertas).toContain('org-smileflow');
    expect(descubiertas).toContain('org-cp-odontologia');
    expect(descubiertas).toContain(org);
    expect(new Set(descubiertas).size).toBe(descubiertas.length); // sin repetidos con el registro histórico
    await a.close();
  });
});

describe('alias históricos de identidad', () => {
  it('una empresa migrada aparece en el listado de su dueño aunque su slug de identidad sea un alias', async () => {
    await migrarNegociosDelRegistro(pool);
    const a = app();
    const cookie = await usuario(a, 'duena-sf@soec.cl');
    // La organización de identidad usa el alias legado `smileflow`; el negocio vive como `org-smileflow`.
    const creada = await a.inject({ method: 'POST', url: '/organizations', headers: { ...H, cookie }, payload: { slug: 'smileflow', name: 'SmileFlow Clinic' } });
    expect(creada.statusCode, creada.body).toBe(201);
    const lista = (await a.inject({ method: 'GET', url: '/negocios', headers: { cookie } })).json();
    expect(lista.negocios.map((n: { organizationId: string }) => n.organizationId)).toContain('org-smileflow');
    await a.close();
  });
});

describe('identidad de tenant', () => {
  it('el slug no es adivinable sólo con el nombre y tolera nombres repetidos o raros', () => {
    const a = slugDeNegocio('Clínica CP');
    const b = slugDeNegocio('Clínica CP');
    expect(a).not.toBe(b);
    expect(a.startsWith('clinica-cp-')).toBe(true);
    expect(slugDeNegocio('***').startsWith('empresa-')).toBe(true);
    expect(slugDeNegocio('A'.repeat(80)).length).toBeLessThanOrEqual(40);
  });
});
