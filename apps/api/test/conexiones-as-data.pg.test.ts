/**
 * Autonomy Fase B · CONEXIONES COMO DATO — test de aceptación sobre PostgreSQL REAL.
 *
 * Demuestra la afirmación que define la fase: después de crear una empresa desde SOEC, se le pueden conectar
 * sus fuentes y habilitar sus capacidades operativas DESDE SOEC — sin escribir TypeScript, sin variables de
 * entorno por empresa y sin desplegar. Y demuestra también lo que NO pasa: no se guarda ningún secreto en
 * claro, ninguna empresa ve las conexiones de otra y la migración de las empresas históricas no enciende nada
 * que hoy no esté encendido.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@soec/event-store/pg';
import { identityMigrations } from '@soec/identity/pg';
import { InMemoryEventStore } from '@soec/event-store';
import { DeterministicIntelligenceProvider } from '@soec/intelligence';
import { makeTestPool, ejecutarDestructivoDePrueba } from '@soec/event-store/test-db';
import { ActorId, OrganizationId, type RequestContext } from '@soec/contracts';
import { buildApp } from '../src/app';
import { negocioMigrations } from '../src/negocio/negocio-pg';
import { migrarNegociosDelRegistro } from '../src/negocio/migracion-registro';
import { conexionMigrations, PgConexionCiphertextStore, RepositorioConexiones } from '../src/conexion/conexion-pg';
import { migrarConexionesDelRegistro } from '../src/conexion/migracion-conexiones';
import { ConexionService, type DepsConexionService } from '../src/conexion/conexion-service';
import { elegiblesPorCapacidad, refrescarNegociosDelRuntime } from '../src/conexion/snapshot';
import { EnvelopeSecretBackend, KmsFake } from '../src/acquisition/meta-secret-backend';
import type { DepositoSecretosConexion } from '../src/conexion/secreto-conexion';
import {
  CapacidadNoHabilitadaError,
  PerfilIncompletoError,
  bindExperienciaReal,
  buscarFuenteGrowth,
  estadoDeCompatibilidadLegado,
  getBusiness,
  restablecerNegociosDelRuntime,
} from '../src/plataforma';

const H = { 'content-type': 'application/json' };
const pool = makeTestPool();
const NOMBRE_QA = 'Empresa QA Connections';
const TOKEN_QA = 'tok_qa_connections_1234567890';

beforeEach(async () => {
  await runMigrations(pool);
  await runMigrations(pool, identityMigrations);
  await runMigrations(pool, negocioMigrations);
  await runMigrations(pool, conexionMigrations);
  await ejecutarDestructivoDePrueba(pool, 'truncate business_connection_ciphertext, business_capability, business_connection, business_audit, business_restriction, business_geo_scope, business_offering, business_objective, business_governance, business_profile restart identity cascade');
  await ejecutarDestructivoDePrueba(
    pool,
    'truncate identity_password_resets, identity_audit_events, identity_invitations, identity_sessions, identity_memberships, identity_organizations, identity_users cascade',
  );
  restablecerNegociosDelRuntime();
});
afterAll(async () => {
  restablecerNegociosDelRuntime();
  await pool.end();
});

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
  businessType: 'CLINICA',
  country: 'CL',
  currency: 'CLP',
  timezone: 'America/Santiago',
  website: 'https://qa-connections.example',
};

async function crearEmpresa(a: App, cookie: string, nombre = NOMBRE_QA): Promise<string> {
  const res = await a.inject({ method: 'POST', url: '/negocios', headers: { ...H, cookie }, payload: { ...ENTRADA_QA, displayName: nombre } });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().perfil.organizationId as string;
}

/** Depósito de secretos de PRUEBA: mismo backend de envoltura, con un KMS falso (jamás producción). */
function depositoDePrueba(): DepositoSecretosConexion {
  const backend = new EnvelopeSecretBackend(new KmsFake(), new PgConexionCiphertextStore(pool));
  return {
    esProductivo: backend.esProductivo,
    almacenar: (org, nombre, valor) => backend.almacenar(org, nombre, valor),
    resolver: (ctx, ref) => backend.resolver(ctx, ref),
    revocar: (ref) => backend.revocar(ref),
  };
}

function servicio(deposito: DepositoSecretosConexion | null): ConexionService {
  const deps: DepsConexionService = {
    deposito,
    env: {},
    refrescar: async () => {
      await refrescarNegociosDelRuntime(pool);
    },
  };
  return new ConexionService(pool, deps);
}

function ctx(org: string): RequestContext {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('qa'), scope: { organizationId: o, permissions: ['events:read'] }, correlationId: 'qa' };
}

describe('empresa nueva: conectar y habilitar sin código, sin variables y sin desplegar', () => {
  it('nace sin conexiones ni capacidades, se conecta con token cifrado y el runtime la resuelve en el siguiente refresco', async () => {
    const a = app();
    const cookie = await usuario(a, 'qa-conexiones@soec.cl');
    const org = await crearEmpresa(a, cookie);
    const svc = servicio(depositoDePrueba());

    // 1) NACE APAGADA: ninguna conexión, ninguna capacidad habilitada.
    const inicial = await svc.estado(org);
    expect(inicial.conexiones).toEqual([]);
    expect(inicial.capacidades.every((c) => !c.habilitada)).toBe(true);
    expect(inicial.depositoDisponible).toBe(true);

    // 2) El runtime la conoce como negocio VÁLIDO desde el primer refresco (no 404, no «no registrada»).
    await refrescarNegociosDelRuntime(pool);
    expect(getBusiness(org).organizationId).toBe(org);
    expect(buscarFuenteGrowth(org)).toBeNull(); // válida, pero sin fuente: la verdad, no un cero inventado

    // 3) CONECTAR el puente Growth con su token. Ninguna variable de entorno, ningún deploy.
    const conectado = await svc.guardarGrowth(org, 'qa', {
      baseUrl: 'https://qa-connections.example',
      provider: 'qa-connections-growth',
      token: TOKEN_QA,
    });
    const growth = conectado.conexiones.find((c) => c.provider === 'GROWTH_M2M')!;
    expect(growth.estado).toBe('CONNECTED');
    expect(growth.credencial).toEqual({ configurada: true, clase: 'DEPOSITO_CIFRADO' });

    // 4) El runtime resuelve la fuente DESDE LA CONEXIÓN, con su endpoint y su allowlist.
    const descriptor = buscarFuenteGrowth(org);
    expect(descriptor?.baseUrl).toBe('https://qa-connections.example');
    expect(descriptor?.hostsAutorizados).toEqual(['qa-connections.example']);
    expect(descriptor?.credencialRef.startsWith('secretstore:')).toBe(true);
    expect(descriptor?.baseUrlEnvOverride).toBeNull();

    // 5) SECRETO: en la fila de la conexión sólo hay una referencia; el depósito guarda ciphertext, no el token.
    const fila = await new RepositorioConexiones(pool).buscar(org, 'GROWTH_M2M');
    expect(fila?.secretRef).toBe(`secretstore:${org}/qa-connections-growth-token`);
    expect(JSON.stringify(fila?.configuracion)).not.toContain(TOKEN_QA);
    const { rows: ct } = await pool.query('select * from business_connection_ciphertext where organization_id = $1', [org]);
    expect(ct).toHaveLength(1);
    expect(JSON.stringify(ct[0])).not.toContain(TOKEN_QA);

    // 6) Y se puede volver a leer por su referencia, sólo dentro de su propio tenant.
    const dep = depositoDePrueba();
    await expect(dep.resolver(ctx('otra-empresa'), `secretstore:${org}/qa-connections-growth-token`)).rejects.toThrow();

    // 7) CAPACIDAD: habilitarla es un acto aparte, y es la que decide si el negocio ingiere.
    expect(await elegiblesPorCapacidad(pool, 'INGESTA_GROWTH')).not.toContain(org);
    await svc.fijarCapacidad(org, 'qa', 'INGESTA_GROWTH', true);
    expect([...(await elegiblesPorCapacidad(pool, 'INGESTA_GROWTH'))]).toContain(org);

    // 8) TELEMETRÍA: la empresa nueva no toma NADA del módulo TypeScript histórico.
    const propia = estadoDeCompatibilidadLegado().organizaciones.find((x) => x.org === org)!;
    expect(propia.origen).toBe('PERSISTIDA');
    expect(propia.camposDelRegistro).toEqual([]);
    expect(propia.usos).toBe(0);

    await a.close();
  });

  it('el panel del negocio responde 200 para una empresa nueva: negocio válido, conexión pendiente', async () => {
    const a = app();
    const cookie = await usuario(a, 'qa-panel@soec.cl');
    const org = await crearEmpresa(a, cookie);
    await refrescarNegociosDelRuntime(pool);

    const res = await a.inject({ method: 'GET', url: '/plataforma/negocio', headers: { cookie, 'x-organization-slug': org } });
    expect(res.statusCode, res.body).toBe(200); // antes esto era un 404 «organización no configurada»
    const v = res.json();
    expect(v.organizationId).toBe(org);
    expect(v.displayName).toBe(NOMBRE_QA);
    expect(v.fuentes).toEqual([]);                       // sin fuentes: la verdad, no un cero
    expect(v.experienciasHabilitadas).toEqual([]);       // nace apagada
    expect(v.perfilDeEvaluacion.configurado).toBe(false); // y se dice que falta, no se fabrica
    await a.close();
  });

  it('las negativas dicen la verdad: capacidad apagada ⇒ 403; encendida sin política ⇒ 409 PROFILE_INCOMPLETE', async () => {
    const a = app();
    const cookie = await usuario(a, 'qa-binding@soec.cl');
    const org = await crearEmpresa(a, cookie);
    const svc = servicio(depositoDePrueba());
    await refrescarNegociosDelRuntime(pool);

    expect(() => bindExperienciaReal(ctx(org), 'medicion-real')).toThrow(CapacidadNoHabilitadaError);
    await svc.fijarCapacidad(org, 'qa', 'MEDICION_REAL', true);
    expect(() => bindExperienciaReal(ctx(org), 'medicion-real')).toThrow(PerfilIncompletoError);
    await a.close();
  });

  it('sin depósito de secretos, el despliegue NO guarda la credencial: lo dice en lugar de guardarla en claro', async () => {
    const a = app();
    const cookie = await usuario(a, 'qa-sin-kms@soec.cl');
    const org = await crearEmpresa(a, cookie);
    const h = { ...H, cookie, 'x-organization-slug': org };

    // El despliegue de prueba no tiene KMS: el estado lo declara y guardar un token se rechaza.
    const estado = await a.inject({ method: 'GET', url: '/conexiones', headers: h });
    expect(estado.statusCode, estado.body).toBe(200);
    expect(estado.json().depositoDisponible).toBe(false);

    const conToken = await a.inject({ method: 'POST', url: '/conexiones/growth', headers: h, payload: { baseUrl: 'https://qa.example', provider: 'qa-growth', token: TOKEN_QA } });
    expect(conToken.statusCode).toBe(503);
    expect(conToken.json().error).toBe('DEPOSITO_NO_DISPONIBLE');
    const { rows } = await pool.query('select count(*)::int as n from business_connection_ciphertext');
    expect(rows[0].n).toBe(0);

    // Declarar el endpoint SIN token sí se puede: queda como conexión pendiente de credencial.
    const sinToken = await a.inject({ method: 'POST', url: '/conexiones/growth', headers: h, payload: { baseUrl: 'https://qa.example', provider: 'qa-growth' } });
    expect(sinToken.statusCode, sinToken.body).toBe(200);
    const growth = sinToken.json().conexiones.find((c: { provider: string }) => c.provider === 'GROWTH_M2M');
    expect(growth.estado).toBe('NOT_CONNECTED');
    expect(growth.credencial).toEqual({ configurada: false, clase: null });
    await a.close();
  });
});

describe('seguridad y aislamiento', () => {
  it('ninguna respuesta expone el valor ni la referencia del secreto', async () => {
    const a = app();
    const cookie = await usuario(a, 'qa-secretos@soec.cl');
    const org = await crearEmpresa(a, cookie);
    await servicio(depositoDePrueba()).guardarGrowth(org, 'qa', { baseUrl: 'https://qa-secretos.example', provider: 'qa-secretos-growth', token: TOKEN_QA });

    const res = await a.inject({ method: 'GET', url: '/conexiones', headers: { cookie, 'x-organization-slug': org } });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.body).not.toContain(TOKEN_QA);
    expect(res.body).not.toContain('secretstore:'); // ni el valor ni la referencia: sólo su clase
    expect(res.body).toContain('DEPOSITO_CIFRADO');

    // La auditoría tampoco guarda el token.
    const { rows } = await pool.query('select action, changed_fields from business_audit where organization_id = $1', [org]);
    expect(rows.map((r: { action: string }) => r.action)).toContain('CONNECTION_SAVED');
    expect(JSON.stringify(rows)).not.toContain(TOKEN_QA);
    await a.close();
  });

  it('otra empresa no ve ni toca las conexiones ajenas, y sin permiso no se cambia nada', async () => {
    const a = app();
    const cookieA = await usuario(a, 'dueno-a@soec.cl');
    const orgA = await crearEmpresa(a, cookieA, 'Empresa QA Connections A');
    const cookieB = await usuario(a, 'dueno-b@soec.cl');
    await crearEmpresa(a, cookieB, 'Empresa QA Connections B');

    // B pide las conexiones de A declarando su slug: el gateway no le da contexto de A.
    const ajena = await a.inject({ method: 'GET', url: '/conexiones', headers: { cookie: cookieB, 'x-organization-slug': orgA } });
    expect([403, 404]).toContain(ajena.statusCode);
    const mutar = await a.inject({ method: 'POST', url: '/conexiones/growth', headers: { ...H, cookie: cookieB, 'x-organization-slug': orgA }, payload: { baseUrl: 'https://intruso.example', provider: 'intruso-growth' } });
    expect([403, 404]).toContain(mutar.statusCode);
    expect(await new RepositorioConexiones(pool).buscar(orgA, 'GROWTH_M2M')).toBeNull();

    // Sin sesión, nada.
    const anon = await a.inject({ method: 'GET', url: '/conexiones', headers: { 'x-organization-slug': orgA } });
    expect([401, 403]).toContain(anon.statusCode);
    await a.close();
  });

  it('deshabilitar una conexión olvida su credencial y borra su ciphertext', async () => {
    const a = app();
    const cookie = await usuario(a, 'qa-olvido@soec.cl');
    const org = await crearEmpresa(a, cookie);
    const svc = servicio(depositoDePrueba());
    await svc.guardarGrowth(org, 'qa', { baseUrl: 'https://qa-olvido.example', provider: 'qa-olvido-growth', token: TOKEN_QA });
    expect((await pool.query('select count(*)::int as n from business_connection_ciphertext where organization_id = $1', [org])).rows[0].n).toBe(1);

    const tras = await svc.deshabilitar(org, 'qa', 'GROWTH_M2M');
    const growth = tras.conexiones.find((c) => c.provider === 'GROWTH_M2M')!;
    expect(growth.estado).toBe('DISABLED');
    expect(growth.credencial).toEqual({ configurada: false, clase: null });
    expect((await pool.query('select count(*)::int as n from business_connection_ciphertext where organization_id = $1', [org])).rows[0].n).toBe(0);
    await a.close();
  });
});

describe('migración de las empresas históricas: nada se enciende de más', () => {
  it('convierte fuentes conectadas en conexiones, conserva la referencia del secreto y es idempotente', async () => {
    await migrarNegociosDelRegistro(pool);
    const primera = await migrarConexionesDelRegistro(pool);
    expect(primera.conexiones).toContain('org-smileflow:GROWTH_M2M');
    expect(primera.conexiones).toContain('org-smileflow:GOOGLE_ADS');
    expect(primera.conexiones).toContain('org-cp-odontologia:GROWTH_M2M');
    // CP declara Google Ads NO configurado: no se inventa una conexión para ella.
    expect(primera.conexiones).not.toContain('org-cp-odontologia:GOOGLE_ADS');

    const repo = new RepositorioConexiones(pool);
    const growthSf = await repo.buscar('org-smileflow', 'GROWTH_M2M');
    expect(growthSf?.estado).toBe('CONNECTED');
    // La migración NO mueve secretos: conserva la referencia histórica tal cual.
    expect(growthSf?.secretRef).toBe('env:SMILEFLOW_GROWTH_TOKEN');
    const adsSf = await repo.buscar('org-smileflow', 'GOOGLE_ADS');
    expect(adsSf?.externalAccountId).toBe('8605539300');
    // La campaña DECLARADA por el registro (histórica, 24120966895), idéntica a lo que resolvía antes. La
    // campaña del experimento vigente (24194332264) no vive aquí: es estado del envelope/binding, no config.
    expect((adsSf?.configuracion as { campaignId?: string }).campaignId).toBe('24120966895');

    // CAPACIDADES: exactamente las de hoy. CP no recibe monitor de seguridad ni ciclo de director.
    const capsCp = await repo.capacidades('org-cp-odontologia');
    const cp = new Map(capsCp.map((c) => [c.capacidad, c.habilitada]));
    expect(cp.get('INGESTA_GROWTH')).toBe(true);
    expect(cp.get('MONITOR_SEGURIDAD')).toBe(false);
    expect(cp.get('CICLO_DIRECTOR')).toBe(false);
    expect(cp.get('MEDICION_REAL')).toBe(false);
    const capsSf = new Map((await repo.capacidades('org-smileflow')).map((c) => [c.capacidad, c.habilitada]));
    expect(capsSf.get('MEDICION_REAL')).toBe(true);
    expect(capsSf.get('DIRECTOR_REAL')).toBe(true);
    expect(capsSf.get('MONITOR_SEGURIDAD')).toBe(true);
    expect(capsSf.get('CICLO_DIRECTOR')).toBe(true);
    expect(capsSf.get('INGESTA_GROWTH')).toBe(true);

    // IDEMPOTENTE: la segunda corrida no crea nada.
    const segunda = await migrarConexionesDelRegistro(pool);
    expect(segunda.conexiones).toEqual([]);
    expect(segunda.capacidades).toEqual([]);
    expect(segunda.yaEstaban.length).toBeGreaterThan(0);
  });

  it('tras migrar, el runtime resuelve a las históricas desde datos y SmileFlow conserva sus capacidades', async () => {
    await migrarNegociosDelRegistro(pool);
    await migrarConexionesDelRegistro(pool);
    await refrescarNegociosDelRuntime(pool);

    const sf = getBusiness('org-smileflow');
    expect(sf.experienciasHabilitadas).toEqual(['medicion-real', 'director-real', 'autonomia-ads', 'piloto-decision']);
    expect(sf.politicaSeguridad?.pausaAutomatica).toBe(true);
    // El recurso de Google Ads se resuelve desde la CONEXIÓN persistida, con la misma campaña de siempre.
    expect(bindExperienciaReal(ctx('org-smileflow'), 'autonomia-ads').perfil.externalResourceRefs.googleAds?.campaignId).toBe('24120966895');
    // CP sigue sin experiencias reales y sin pausa automática.
    const cp = getBusiness('org-cp-odontologia');
    expect(cp.experienciasHabilitadas).toEqual([]);
    expect(cp.politicaSeguridad?.pausaAutomatica).toBe(false);
    // Y su ingesta sigue siendo elegible (hoy ingiere y debe seguir ingiriendo).
    expect([...(await elegiblesPorCapacidad(pool, 'INGESTA_GROWTH'))]).toContain('org-cp-odontologia');
    // El monitor de seguridad cubre exactamente a quien lo tenía.
    expect([...(await elegiblesPorCapacidad(pool, 'MONITOR_SEGURIDAD'))]).toEqual(['org-smileflow']);
  });

  it('una empresa sin perfil persistido no rompe el arranque: se omite con su motivo', async () => {
    // Sin correr la migración de Fase A no hay perfiles: la de conexiones lo dice y no lanza.
    const r = await migrarConexionesDelRegistro(pool);
    expect(r.conexiones).toEqual([]);
    expect(r.omitidas.length).toBeGreaterThan(0);
    expect(r.omitidas.join(' ')).toContain('sin perfil persistido');
  });
});
