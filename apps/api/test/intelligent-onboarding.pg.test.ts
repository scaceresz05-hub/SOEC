/**
 * Autonomy Fase D · ONBOARDING INTELIGENTE — aceptación sobre PostgreSQL REAL.
 *
 * Demuestra la afirmación que define la fase: una persona que no sabe marketing digital incorpora y prepara
 * su empresa contestando preguntas en lenguaje de negocio, **por las mismas APIs que usa la interfaz**, sin
 * Claude, sin desarrollador, sin TypeScript, sin SQL, sin variables por empresa y sin desplegar.
 *
 * Y demuestra los límites: terminar el asistente no enciende escrituras externas ni gasto, y las empresas que
 * ya existían encuentran sus respuestas precargadas en lugar de un formulario vacío.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@soec/event-store/pg';
import { crearMembresia, crearOrganizacion, identityMigrations, usuarioPorEmail } from '@soec/identity/pg';
import { InMemoryEventStore } from '@soec/event-store';
import { DeterministicIntelligenceProvider } from '@soec/intelligence';
import { makeTestPool, ejecutarDestructivoDePrueba } from '@soec/event-store/test-db';
import { buildApp } from '../src/app';
import { negocioMigrations, RepositorioNegocios } from '../src/negocio/negocio-pg';
import { migrarNegociosDelRegistro } from '../src/negocio/migracion-registro';
import { conexionMigrations, PgConexionCiphertextStore, RepositorioConexiones } from '../src/conexion/conexion-pg';
import { migrarConexionesDelRegistro } from '../src/conexion/migracion-conexiones';
import { ConexionService } from '../src/conexion/conexion-service';
import { EnvelopeSecretBackend, KmsFake } from '../src/acquisition/meta-secret-backend';
import type { DepositoSecretosConexion } from '../src/conexion/secreto-conexion';
import { politicaMigrations, RepositorioPolitica } from '../src/politica/politica-pg';
import { migrarPoliticasDelRegistro } from '../src/politica/migracion-politica';
import { onboardingMigrations, RepositorioOnboarding } from '../src/onboarding/onboarding-pg';
import { restablecerNegociosDelRuntime } from '../src/plataforma';

const H = { 'content-type': 'application/json' };
const pool = makeTestPool();
const NOMBRE_QA = 'Empresa QA Onboarding';

beforeEach(async () => {
  await runMigrations(pool);
  await runMigrations(pool, identityMigrations);
  await runMigrations(pool, negocioMigrations);
  await runMigrations(pool, conexionMigrations);
  await runMigrations(pool, politicaMigrations);
  await runMigrations(pool, onboardingMigrations);
  await ejecutarDestructivoDePrueba(pool, 'truncate business_budget_intent, business_website_insight, business_onboarding_answer, business_onboarding, business_channel_rule, business_autonomy_limits, business_evaluation_rule, business_conversion_event, business_kpi, business_evaluation_policy, business_connection_ciphertext, business_capability, business_connection, business_audit, business_restriction, business_geo_scope, business_offering, business_objective, business_governance, business_profile restart identity cascade');
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

async function crearEmpresa(a: App, cookie: string, nombre = NOMBRE_QA): Promise<string> {
  const res = await a.inject({
    method: 'POST', url: '/negocios', headers: { ...H, cookie },
    payload: { displayName: nombre, businessType: 'SERVICIOS', country: 'CL', currency: 'CLP', timezone: 'America/Santiago' },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().perfil.organizationId as string;
}

function depositoDePrueba(): DepositoSecretosConexion {
  const backend = new EnvelopeSecretBackend(new KmsFake(), new PgConexionCiphertextStore(pool));
  return {
    esProductivo: backend.esProductivo,
    almacenar: (org, nombre, valor) => backend.almacenar(org, nombre, valor),
    resolver: (ctx, ref) => backend.resolver(ctx, ref),
    revocar: (ref) => backend.revocar(ref),
  };
}

/**
 * Monta la pertenencia de una persona a una empresa HISTÓRICA. En producción esas organizaciones ya existen en
 * el plano de identidad; en la base de prueba se crean aquí para poder abrir su asistente. No toca sus datos.
 */
async function duenaDeEmpresaHistorica(a: App, email: string, slugIdentidad: string): Promise<string> {
  const cookie = await usuario(a, email);
  const org = await crearOrganizacion(pool, slugIdentidad, slugIdentidad);
  const u = await usuarioPorEmail(pool, email);
  await crearMembresia(pool, u!.id, org.id, 'OWNER', 'ACTIVE');
  return cookie;
}

/** Respuestas de una dueña de clínica que no sabe nada de marketing digital. */
const RESPUESTAS: ReadonlyArray<{ paso: string; respuestas: Record<string, unknown> }> = [
  { paso: 'negocio', respuestas: { 'negocio.aQueSeDedica': 'Somos una clínica dental en Curicó', 'negocio.tipo': 'CLINICA', 'negocio.tipoCliente': 'B2C', 'negocio.sitio': 'https://qa-onboarding.example', 'negocio.pais': 'CL' } },
  { paso: 'oferta', respuestas: { 'oferta.queVendes': 'hacemos implantes, prótesis y odontología general' } },
  { paso: 'territorio', respuestas: { 'territorio.donde': 'Curicó, Rauco y Sagrada Familia', 'territorio.region': 'Provincia de Curicó' } },
  { paso: 'objetivo', respuestas: { 'objetivo.queQuieres': 'nuevos-clientes', 'objetivo.enCuantoTiempo': 30 } },
  { paso: 'contacto', respuestas: { 'contacto.como': ['whatsapp', 'llama'], 'contacto.principal': 'whatsapp', 'contacto.agenda': true } },
  { paso: 'restricciones', respuestas: { 'restricciones.noOfrecemos': 'no atendemos urgencias', 'restricciones.noPodemosAfirmar': 'no atendemos Fonasa' } },
  { paso: 'medicion', respuestas: { 'medicion.indicador': 'cantidad-contactos', 'medicion.conoceMeta': false, 'medicion.evidencia': 'prudente' } },
  { paso: 'conexiones', respuestas: { 'conexiones.usaGoogleAds': false, 'conexiones.usaMeta': false } },
  { paso: 'presupuesto', respuestas: { 'presupuesto.modalidad': 'DAILY', 'presupuesto.monto': 5000 } },
  { paso: 'autonomia', respuestas: { 'autonomia.preferencia': 'PEDIR_APROBACION' } },
];

async function responder(a: App, cookie: string, org: string, paso: string, respuestas: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await a.inject({
    method: 'PATCH', url: '/onboarding', headers: { ...H, cookie, 'x-organization-slug': org },
    payload: { paso, respuestas, avanzar: true },
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as Record<string, unknown>;
}

describe('Empresa QA Onboarding · de cero a preparada, sólo contestando preguntas', () => {
  it('recorre el asistente completo y deja cada dato en su tabla canónica', async () => {
    const a = app();
    const cookie = await usuario(a, 'duena-clinica@soec.cl');
    const org = await crearEmpresa(a, cookie);
    const h = { cookie, 'x-organization-slug': org };

    // 1) Al abrirlo, el asistente propone empezar por el negocio y no sabe casi nada.
    const inicial = await a.inject({ method: 'GET', url: '/onboarding', headers: h });
    expect(inicial.statusCode, inicial.body).toBe(200);
    const v0 = inicial.json();
    expect(v0.estado).toBe('NOT_STARTED');
    expect(v0.siguientePaso).toBe('negocio');
    expect(v0.progreso).toBeLessThan(50);
    // El país ya se sabe del alta: se muestra resuelto en lugar de volver a preguntarlo.
    const pais = v0.pasos.find((p: { id: string }) => p.id === 'negocio').preguntas.find((q: { id: string }) => q.id === 'negocio.pais');
    expect(pais.yaSabemos).toBe(true);

    // 2) Contesta paso por paso, en lenguaje de negocio.
    let ultima: Record<string, unknown> = {};
    for (const r of RESPUESTAS) ultima = await responder(a, cookie, org, r.paso, r.respuestas);
    expect((ultima as { progreso: number }).progreso).toBe(100);

    // 3) PERFIL: descripción, tipo y sitio quedaron en `business_profile`.
    const negocios = new RepositorioNegocios(pool);
    const perfil = await negocios.perfil(org);
    expect(perfil?.description).toBe('Somos una clínica dental en Curicó');
    expect(perfil?.businessType).toBe('CLINICA');
    expect(perfil?.website).toBe('https://qa-onboarding.example/');
    expect(perfil?.primaryObjective).toBe('conseguir nuevos clientes');

    // 4) OFERTA: «hacemos implantes, prótesis y odontología general» son tres servicios, sin slugs a la vista.
    // La oferta es un CONJUNTO, no una secuencia: se lista por prioridad y nombre, no por orden de escritura.
    const oferta = await negocios.oferta(org);
    expect([...oferta.map((o) => o.name)].sort()).toEqual(['implantes', 'odontología general', 'prótesis']);
    expect(oferta.every((o) => o.status === 'ACTIVE')).toBe(true);

    // 5) TERRITORIO: las comunas en su tabla, con la provincia declarada.
    const territorios = await negocios.territorios(org);
    const comercial = territorios.find((t) => t.ambito === 'BUSINESS')!;
    expect(comercial.localities).toEqual(['Curicó', 'Rauco', 'Sagrada Familia']);
    expect(comercial.region).toBe('Provincia de Curicó');

    // 6) CONVERSIONES: la acción principal y la secundaria, traducidas a eventos.
    const politica = new RepositorioPolitica(pool);
    const eventos = await politica.eventos(org);
    expect(eventos.find((e) => e.rol === 'PRIMARY')?.eventKey).toBe('whatsapp_intent');
    expect(eventos.filter((e) => e.rol === 'SECONDARY').map((e) => e.eventKey)).toEqual(['phone_intent']);

    // 7) RESTRICCIONES: cada pregunta va a su clase, sin que nadie escriba «PROHIBITED_CLAIM».
    const restricciones = await negocios.restricciones(org);
    expect(restricciones.find((r) => r.tipo === 'RESTRICTION')?.texto).toBe('no atendemos urgencias');
    expect(restricciones.find((r) => r.tipo === 'PROHIBITED_CLAIM')?.texto).toBe('no atendemos Fonasa');

    // 8) MEDICIÓN: sin meta conocida NO se inventa una; queda por aprender, y la evidencia es un punto de
    //    partida del sistema DECLARADO como tal.
    const kpis = await politica.kpis(org);
    const principal = kpis.find((k) => k.rol === 'PRIMARY')!;
    expect(principal.clave).toBe('contactos');
    expect(principal.targetValue).toBeNull();
    expect(principal.estado).toBe('UNKNOWN');
    expect(principal.procedencia).toBe('TO_BE_LEARNED');
    const evidencia = (await politica.reglas(org)).find((r) => r.tipo === 'EVIDENCE_MINIMUM')!;
    expect(evidencia.valor).toBe(1000);
    expect(evidencia.procedencia).toBe('SYSTEM_DEFAULT');

    // 9) PRESUPUESTO: el techo declarado + el tope operativo en su tabla canónica. Ningún mandato financiero.
    const intencion = await new RepositorioOnboarding(pool).intencionPresupuesto(org);
    expect(intencion?.modalidad).toBe('DAILY');
    expect(intencion?.montoClp).toBe(5000);
    expect((await politica.limites(org))?.maxDailyBudgetClp).toBe(5000);
    const { rows: mandatos } = await pool.query('select count(*)::int as n from accion_mandato where organization_id = $1', [org]).catch(() => ({ rows: [{ n: 0 }] }));
    expect(mandatos[0].n).toBe(0);

    // 10) AUTONOMÍA: la preferencia se aplicó por la vía gobernada de identidad.
    const me = await a.inject({ method: 'GET', url: `/organizations/${org}`, headers: { cookie } });
    expect(me.json().operationalMode).toBe('SUPERVISED_REAL');

    // 11) COMPLETAR: se puede terminar, pero como falta conectar una fuente el estado lo dice.
    const fin = await a.inject({ method: 'POST', url: '/onboarding/completar', headers: { ...H, ...h }, payload: {} });
    expect(fin.statusCode, fin.body).toBe(200);
    const vFin = fin.json();
    expect(vFin.estado).toBe('NEEDS_ACTION');
    expect(vFin.readiness.resumen).toBe('REQUIERE_TU_ACCION');
    expect(vFin.readiness.niveles.find((n: { nivel: string }) => n.nivel === 'BUSINESS_READY').listo).toBe(true);
    expect(vFin.readiness.niveles.find((n: { nivel: string }) => n.nivel === 'MEASUREMENT_READY').listo).toBe(false);

    // 12) Sin conexión no se deriva ninguna capacidad.
    const conexiones = new RepositorioConexiones(pool);
    expect(await conexiones.capacidades(org)).toEqual([]);

    // 13) Al conectar la fuente del sitio, se derivan SÓLO capacidades de lectura.
    const svcConexiones = new ConexionService(pool, { deposito: depositoDePrueba(), env: {} });
    await svcConexiones.guardarGrowth(org, 'duena', { baseUrl: 'https://qa-onboarding.example', provider: 'qa-onboarding-growth', token: 'tok_qa_onb_1' });
    await responder(a, cookie, org, 'conexiones', { 'conexiones.usaGoogleAds': false, 'conexiones.usaMeta': false, 'conexiones.sistemaPropio': true });
    const caps = new Map((await conexiones.capacidades(org)).map((c) => [c.capacidad, c]));
    expect(caps.get('INGESTA_GROWTH')?.habilitada).toBe(true);
    expect(caps.get('MEDICION_REAL')?.habilitada).toBe(true);
    expect(caps.get('MEDICION_REAL')?.origen).toBe('SISTEMA');
    for (const prohibida of ['AUTONOMIA_ADS', 'MONITOR_SEGURIDAD', 'CICLO_DIRECTOR', 'PILOTO_DECISION'] as const) {
      expect(caps.has(prohibida)).toBe(false);
    }

    // 14) EJECUCIÓN Y GASTO siguen apagados: completar el asistente no autoriza nada.
    const gobierno = await negocios.gobierno(org);
    expect(gobierno).toEqual(expect.objectContaining({ externalMutations: false, autonomousSpend: false, campaignExecution: false }));
    const trasConectar = await a.inject({ method: 'GET', url: '/onboarding', headers: h });
    const niveles = new Map(trasConectar.json().readiness.niveles.map((n: { nivel: string; listo: boolean; bloqueos: string[] }) => [n.nivel, n]));
    expect((niveles.get('MEASUREMENT_READY') as { listo: boolean }).listo).toBe(true);
    expect((niveles.get('CAMPAIGN_EXECUTION_READY') as { listo: boolean }).listo).toBe(false);
    expect((niveles.get('CAMPAIGN_EXECUTION_READY') as { bloqueos: string[] }).bloqueos).toContain('falta una autorización de presupuesto firmada por una persona');

    // 15) AUDITORÍA: hitos, no pulsaciones. Y sin secretos.
    const { rows } = await pool.query("select action, changed_fields from business_audit where organization_id = $1 and action like 'ONBOARDING%' order by id", [org]);
    const acciones = rows.map((r: { action: string }) => r.action);
    expect(acciones[0]).toBe('ONBOARDING_STARTED');
    expect(acciones).toContain('ONBOARDING_PROGRESS_UPDATED');
    expect(JSON.stringify(rows)).not.toContain('tok_qa_onb_1');
    await a.close();
  });

  it('pedir que SOEC opere solo no lo activa: se explica que todavía no está disponible', async () => {
    const a = app();
    const cookie = await usuario(a, 'duena-autonomia@soec.cl');
    const org = await crearEmpresa(a, cookie);
    const v = await responder(a, cookie, org, 'autonomia', { 'autonomia.preferencia': 'OPERAR_DENTRO_DE_LIMITES' });

    // El modo NO cambia…
    const me = await a.inject({ method: 'GET', url: `/organizations/${org}`, headers: { cookie } });
    expect(me.json().operationalMode).toBe('PILOT');
    // …y se le dice por qué, en lugar de dejarlo suponiendo que sí.
    const avisos = (v as { avisos: string[] }).avisos;
    expect(avisos.length).toBe(1);
    expect(avisos[0]).toContain('no se pudo aplicar');
    expect(avisos[0]).toContain('NOT_AVAILABLE');
    const autonomia = (v as { readiness: { niveles: { nivel: string; listo: boolean }[] } }).readiness.niveles.find((n) => n.nivel === 'AUTONOMY_READY')!;
    expect(autonomia.listo).toBe(false);
    await a.close();
  });

  it('lo que se lee del sitio web se propone, no se da por dicho por el dueño', async () => {
    const a = app();
    const cookie = await usuario(a, 'duena-sitio@soec.cl');
    const org = await crearEmpresa(a, cookie);
    const h = { ...H, cookie, 'x-organization-slug': org };

    // El sitio no existe: eso es información del onboarding, no un error.
    const res = await a.inject({ method: 'POST', url: '/onboarding/sitio', headers: h, payload: { url: 'https://sitio-que-no-existe-qa.example' } });
    expect(res.statusCode, res.body).toBe(200);
    const v = res.json();
    expect(['UNREACHABLE', 'REJECTED', 'ERROR']).toContain(v.sitio.estado);

    // Y la descripción del negocio sigue sin escribirse: nada entra al perfil sin confirmación.
    expect((await new RepositorioNegocios(pool).perfil(org))?.description).toBeNull();
    await a.close();
  });
});

describe('reanudar y corregir', () => {
  it('se completa el 40 %, se cierra, se vuelve y se sigue en el mismo punto sin duplicar nada', async () => {
    const primera = app();
    const cookie = await usuario(primera, 'duena-reanuda@soec.cl');
    const org = await crearEmpresa(primera, cookie);
    for (const r of RESPUESTAS.slice(0, 4)) await responder(primera, cookie, org, r.paso, r.respuestas);
    const parcial = await primera.inject({ method: 'GET', url: '/onboarding', headers: { cookie, 'x-organization-slug': org } });
    const vParcial = parcial.json();
    expect(vParcial.progreso).toBeGreaterThanOrEqual(40);
    expect(vParcial.progreso).toBeLessThan(100);
    expect(vParcial.estado).toBe('IN_PROGRESS');
    await primera.close();

    // SESIÓN NUEVA: otro proceso, otra cookie. El asistente recuerda por dónde iba y qué se respondió.
    const segunda = app();
    const cookie2 = cookieDe(await segunda.inject({ method: 'POST', url: '/auth/login', headers: H, payload: { email: 'duena-reanuda@soec.cl', password: 'Password123' } }));
    const vuelta = await segunda.inject({ method: 'GET', url: '/onboarding', headers: { cookie: cookie2, 'x-organization-slug': org } });
    const vVuelta = vuelta.json();
    expect(vVuelta.estado).toBe('IN_PROGRESS');
    expect(vVuelta.pasoActual).toBe(vParcial.pasoActual);
    expect(vVuelta.siguientePaso).toBe('contacto');
    const oferta = vVuelta.pasos.find((p: { id: string }) => p.id === 'oferta').preguntas.find((q: { id: string }) => q.id === 'oferta.queVendes');
    expect(String(oferta.valorActual)).toContain('implantes');

    // Repetir el mismo paso NO duplica la oferta.
    await responder(segunda, cookie2, org, 'oferta', { 'oferta.queVendes': 'hacemos implantes, prótesis y odontología general' });
    const nombres = (await new RepositorioNegocios(pool).oferta(org)).map((o) => o.name);
    expect([...nombres].sort()).toEqual(['implantes', 'odontología general', 'prótesis']);
    await segunda.close();
  });

  it('corregir una respuesta actualiza el dato y recalcula la preparación, sin reconstruir la empresa', async () => {
    const a = app();
    const cookie = await usuario(a, 'duena-corrige@soec.cl');
    const org = await crearEmpresa(a, cookie);
    for (const r of RESPUESTAS) await responder(a, cookie, org, r.paso, r.respuestas);
    const negocios = new RepositorioNegocios(pool);
    const antes = await negocios.perfil(org);

    // Cambia el objetivo y quita un servicio.
    await responder(a, cookie, org, 'objetivo', { 'objetivo.queQuieres': 'reservas', 'objetivo.enCuantoTiempo': 45 });
    await responder(a, cookie, org, 'oferta', { 'oferta.queVendes': 'implantes y prótesis' });

    const despues = await negocios.perfil(org);
    expect(despues?.primaryObjective).toBe('conseguir reservas o citas');
    expect(despues?.businessKey).toBe(antes?.businessKey); // la identidad NO cambia
    expect((await new RepositorioPolitica(pool).politica(org))?.objectiveText).toBe('conseguir reservas o citas');
    expect((await new RepositorioPolitica(pool).politica(org))?.evaluationHorizonDays).toBe(45);

    // El servicio retirado no se borra: queda fuera de lo activo pero su historia se conserva.
    const oferta = await negocios.oferta(org);
    expect([...oferta.filter((o) => o.status === 'ACTIVE').map((o) => o.name)].sort()).toEqual(['implantes', 'prótesis']);
    expect(oferta.find((o) => o.name === 'odontología general')?.status).toBe('RETIRED');

    // Y la preparación se recalcula sola.
    const v = (await a.inject({ method: 'GET', url: '/onboarding', headers: { cookie, 'x-organization-slug': org } })).json();
    expect(v.resumen.objetivo).toBe('conseguir reservas o citas');
    expect(v.readiness.niveles.find((n: { nivel: string }) => n.nivel === 'BUSINESS_READY').listo).toBe(true);
    await a.close();
  });
});

describe('aislamiento entre empresas', () => {
  it('una empresa no lee, no modifica y no completa el onboarding de otra', async () => {
    const a = app();
    const cookieA = await usuario(a, 'duena-a@soec.cl');
    const orgA = await crearEmpresa(a, cookieA, 'Empresa QA Onboarding A');
    await responder(a, cookieA, orgA, 'negocio', RESPUESTAS[0]!.respuestas);

    const cookieB = await usuario(a, 'dueno-b@soec.cl');
    await crearEmpresa(a, cookieB, 'Empresa QA Onboarding B');

    const leer = await a.inject({ method: 'GET', url: '/onboarding', headers: { cookie: cookieB, 'x-organization-slug': orgA } });
    expect([403, 404]).toContain(leer.statusCode);
    const editar = await a.inject({ method: 'PATCH', url: '/onboarding', headers: { ...H, cookie: cookieB, 'x-organization-slug': orgA }, payload: { paso: 'negocio', respuestas: { 'negocio.aQueSeDedica': 'secuestrada' } } });
    expect([403, 404]).toContain(editar.statusCode);
    const completar = await a.inject({ method: 'POST', url: '/onboarding/completar', headers: { ...H, cookie: cookieB, 'x-organization-slug': orgA }, payload: {} });
    expect([403, 404]).toContain(completar.statusCode);
    expect((await new RepositorioNegocios(pool).perfil(orgA))?.description).toBe('Somos una clínica dental en Curicó');
    await a.close();
  });
});

/**
 * REGRESIÓN DE LA FASE H · «pasar por una pantalla no es responderla».
 *
 * El caso real: una empresa histórica abre el asistente, vuelve atrás para corregir SÓLO su sitio web, y de
 * paso cruza los pasos de oferta y territorio. La interfaz precarga cada pregunta con lo que SOEC ya sabe; si
 * eso se devuelve tal cual al guardar, el sistema lo tomaba por una decisión del dueño: marcaba todo como
 * `USER_CONFIRMED` y lo reescribía en el negocio — llegando a pisar la REGIÓN con el nombre de la PROVINCIA y
 * a cambiar las prioridades de una oferta que nadie tocó.
 */
/**
 * REGLA DE LA FASE D · nadie tiene que inventar una meta para que su empresa quede preparada.
 *
 * Quien responde «todavía no sé qué número sería un buen resultado» elige igual QUÉ mirar, usa el punto de
 * partida del sistema para la evidencia, y su perfil de evaluación queda COMPLETO — en modo aprendizaje. Lo
 * que no puede pasar es que ese estado se convierta en «cualquier resultado vale».
 */
describe('no saber la meta todavía no bloquea la preparación', () => {
  it('el asistente termina completo, sin un solo número inventado, y lo dice', async () => {
    const a = app();
    const cookie = await usuario(a, 'duena-sinmeta@soec.cl');
    const org = await crearEmpresa(a, cookie, 'Empresa QA Sin Meta');
    for (const r of RESPUESTAS) await responder(a, cookie, org, r.paso, r.respuestas); // medicion.conoceMeta = false

    const politica = new RepositorioPolitica(pool);
    const kpis = await politica.kpis(org);
    const principal = kpis.find((k) => k.rol === 'PRIMARY')!;
    // Se eligió el indicador; la meta queda declarada como POR APRENDER, no como cero ni como suposición.
    expect(principal.clave).toBe('contactos');
    expect(principal.targetValue).toBeNull();
    expect(principal.procedencia).toBe('TO_BE_LEARNED');
    const evidencia = (await politica.reglas(org)).find((r) => r.tipo === 'EVIDENCE_MINIMUM')!;
    expect(evidencia.procedencia).toBe('SYSTEM_DEFAULT'); // recomendación del sistema, no decisión del negocio
    expect(evidencia.nota ?? '').toContain('v1');

    // La preparación del negocio deja de exigir un número: el dominio de evaluación queda resuelto.
    const v = (await a.inject({ method: 'GET', url: '/onboarding', headers: { cookie, 'x-organization-slug': org } })).json();
    const evaluacion = v.readiness.dominios.find((d: { dominio: string }) => d.dominio === 'EVALUATION');
    expect(evaluacion.estado, JSON.stringify(evaluacion.motivos)).toBe('COMPLETE');

    // Y el estado de la META se dice en voz alta, en lugar de esconderse detrás de un «completo».
    const pol = (await a.inject({ method: 'GET', url: '/politica', headers: { cookie, 'x-organization-slug': org } })).json();
    expect(pol.completitud.estado).toBe('EVALUATION_PROFILE_COMPLETE');
    expect(pol.completitud.lineaBase).toBe('LEARNING_BASELINE');
    await a.close();
  });

  it('declarar la meta después confirma la línea base, sin rehacer nada', async () => {
    const a = app();
    const cookie = await usuario(a, 'duena-conmeta@soec.cl');
    const org = await crearEmpresa(a, cookie, 'Empresa QA Con Meta');
    for (const r of RESPUESTAS) await responder(a, cookie, org, r.paso, r.respuestas);
    await responder(a, cookie, org, 'medicion', { 'medicion.indicador': 'cantidad-contactos', 'medicion.conoceMeta': true, 'medicion.meta': 15, 'medicion.evidencia': 'prudente' });

    const principal = (await new RepositorioPolitica(pool).kpis(org)).find((k) => k.rol === 'PRIMARY')!;
    expect(principal.targetValue).toBe(15);
    expect(principal.procedencia).toBe('USER_DEFINED');
    const pol = (await a.inject({ method: 'GET', url: '/politica', headers: { cookie, 'x-organization-slug': org } })).json();
    expect(pol.completitud.lineaBase).toBe('CONFIRMED');
    await a.close();
  });
});

describe('navegar por el asistente no confirma ni reescribe datos', () => {
  beforeEach(async () => {
    await migrarNegociosDelRegistro(pool);
    await migrarConexionesDelRegistro(pool);
    await migrarPoliticasDelRegistro(pool);
  });

  const ORG = 'org-cp-odontologia';
  const estadoOferta = async (): Promise<readonly string[]> =>
    [...(await new RepositorioNegocios(pool).oferta(ORG))].map((o) => `${o.slug}:${o.priority}:${o.status}`).sort();
  const territorioDe = async () =>
    (await new RepositorioNegocios(pool).territorios(ORG)).find((t) => t.ambito === 'BUSINESS');
  const dominiosDe = async (a: App, cookie: string): Promise<readonly string[]> =>
    (await a.inject({ method: 'GET', url: '/onboarding', headers: { cookie, 'x-organization-slug': ORG } }))
      .json().readiness.dominios.map((d: { dominio: string; estado: string }) => `${d.dominio}:${d.estado}`);
  const preparacionDe = async (a: App, cookie: string): Promise<readonly string[]> =>
    (await a.inject({ method: 'GET', url: '/aceptacion/preparacion', headers: { cookie, 'x-organization-slug': ORG } }))
      .json().preparacion.items.map((i: { item: string; estado: string }) => `${i.item}:${i.estado}`);

  /** Lo que hacía la interfaz antigua: devolver TODO lo precargado del paso, sin que nadie tocara nada. */
  async function devolverLoPrecargado(a: App, cookie: string, paso: string): Promise<void> {
    const v = (await a.inject({ method: 'GET', url: '/onboarding', headers: { cookie, 'x-organization-slug': ORG } })).json();
    const preguntas = v.pasos.find((p: { id: string }) => p.id === paso).preguntas as ReadonlyArray<{ id: string; valorActual: unknown }>;
    const respuestas: Record<string, unknown> = {};
    for (const q of preguntas) {
      const vacio = q.valorActual === null || q.valorActual === '' || (Array.isArray(q.valorActual) && q.valorActual.length === 0);
      if (!vacio) respuestas[q.id] = q.valorActual;
    }
    const res = await a.inject({
      method: 'PATCH', url: '/onboarding', headers: { ...H, cookie, 'x-organization-slug': ORG },
      payload: { paso, respuestas, avanzar: true },
    });
    expect(res.statusCode, res.body).toBe(200);
  }

  it('cruzar los pasos precargados no cambia ni un dato ni una procedencia', async () => {
    const a = app();
    const cookie = await duenaDeEmpresaHistorica(a, 'duena-navega@soec.cl', ORG);

    const territorioAntes = await territorioDe();
    const ofertaAntes = await estadoOferta();
    const dominiosAntes = await dominiosDe(a, cookie);
    // La región migrada es la ADMINISTRATIVA, distinta de la provincia: es justo lo que el fallo pisaba.
    expect(territorioAntes?.region).toBe('Región del Maule');
    expect(territorioAntes?.province).toBe('Provincia de Curicó');

    for (const paso of ['negocio', 'oferta', 'territorio']) await devolverLoPrecargado(a, cookie, paso);

    expect(await territorioDe()).toEqual(territorioAntes);
    expect(await estadoOferta()).toEqual(ofertaAntes);

    // Y ninguna respuesta precargada quedó como decisión de una persona.
    const respuestas = await new RepositorioOnboarding(pool).respuestas(ORG);
    const confirmadas = respuestas.filter((r) => r.confirmacion === 'USER_CONFIRMED').map((r) => r.pregunta);
    expect(confirmadas, `no las confirmó nadie: ${confirmadas.join(', ')}`).toEqual([]);
    expect(await dominiosDe(a, cookie)).toEqual(dominiosAntes);
    await a.close();
  });

  it('corregir SÓLO el sitio web cambia el sitio web, y nada más', async () => {
    const a = app();
    const cookie = await duenaDeEmpresaHistorica(a, 'duena-sitio@soec.cl', ORG);
    const negocios = new RepositorioNegocios(pool);

    const territorioAntes = await territorioDe();
    const ofertaAntes = await estadoOferta();
    const perfilAntes = (await negocios.perfil(ORG))!;
    const prepAntes = await preparacionDe(a, cookie);
    expect(perfilAntes.website).toBeNull();

    // Va hacia atrás, cruza pasos precargados y escribe ÚNICAMENTE el sitio.
    for (const paso of ['territorio', 'oferta']) await devolverLoPrecargado(a, cookie, paso);
    const res = await a.inject({
      method: 'PATCH', url: '/onboarding', headers: { ...H, cookie, 'x-organization-slug': ORG },
      payload: { paso: 'negocio', respuestas: { 'negocio.sitio': 'https://www.ejemplo-clinica.cl' }, avanzar: false },
    });
    expect(res.statusCode, res.body).toBe(200);

    const perfilDespues = (await negocios.perfil(ORG))!;
    expect(perfilDespues.website).toBe('https://www.ejemplo-clinica.cl/'); // normalizado por `sitioValido`
    expect({ ...perfilDespues, website: null, updatedAt: perfilAntes.updatedAt }).toEqual({ ...perfilAntes, website: null });
    expect(await territorioDe()).toEqual(territorioAntes);
    expect(await estadoOferta()).toEqual(ofertaAntes);

    // Sólo el sitio confirmado por la persona queda como suyo.
    const respuestas = await new RepositorioOnboarding(pool).respuestas(ORG);
    expect(respuestas.filter((r) => r.confirmacion === 'USER_CONFIRMED').map((r) => r.pregunta)).toEqual(['negocio.sitio']);

    // La preparación cambia SÓLO donde el sitio es la dependencia.
    const prepDespues = await preparacionDe(a, cookie);
    const cambios = prepDespues.filter((x, i) => x !== prepAntes[i]);
    expect(cambios).toEqual(['SITIO_WEB_OBSERVADO:SYSTEM_ACTION_REQUIRED']);
    await a.close();
  });

  it('una corrección de verdad sí manda: escribir otra región la cambia', async () => {
    const a = app();
    const cookie = await duenaDeEmpresaHistorica(a, 'duena-region@soec.cl', ORG);
    await a.inject({
      method: 'PATCH', url: '/onboarding', headers: { ...H, cookie, 'x-organization-slug': ORG },
      payload: { paso: 'territorio', respuestas: { 'territorio.region': 'Región de Ñuble' }, avanzar: false },
    });
    expect((await territorioDe())?.region).toBe('Región de Ñuble');
    const respuestas = await new RepositorioOnboarding(pool).respuestas(ORG);
    expect(respuestas.find((r) => r.pregunta === 'territorio.region')?.confirmacion).toBe('USER_CONFIRMED');
    await a.close();
  });
});

describe('empresas que ya existían', () => {
  beforeEach(async () => {
    await migrarNegociosDelRegistro(pool);
    await migrarConexionesDelRegistro(pool);
    await migrarPoliticasDelRegistro(pool);
  });

  it('CP Odontología abre el asistente con lo que SOEC ya sabe, no con un formulario vacío', async () => {
    const a = app();
    const cookie = await duenaDeEmpresaHistorica(a, 'duena-cp@soec.cl', 'org-cp-odontologia');

    const res = await a.inject({ method: 'GET', url: '/onboarding', headers: { cookie, 'x-organization-slug': 'org-cp-odontologia' } });
    expect(res.statusCode, res.body).toBe(200);
    const v = res.json();
    const pregunta = (paso: string, id: string): { valorActual: unknown; yaSabemos: boolean } =>
      v.pasos.find((p: { id: string }) => p.id === paso).preguntas.find((q: { id: string }) => q.id === id);

    // Lo que ya está persistido llega precargado y marcado como sabido.
    expect(pregunta('negocio', 'negocio.tipo').valorActual).toBe('CLINICA');
    expect(String(pregunta('oferta', 'oferta.queVendes').valorActual)).toContain('rehabilitación oral');
    expect(String(pregunta('oferta', 'oferta.queVendes').valorActual)).toContain('odontología general');
    expect(String(pregunta('territorio', 'territorio.donde').valorActual)).toContain('Curicó');
    expect(pregunta('objetivo', 'objetivo.queQuieres').yaSabemos).toBe(false); // su objetivo no calza con las opciones: se pregunta
    expect(v.resumen.objetivo).toBe('captar pacientes / evaluaciones odontológicas');
    expect(v.resumen.conversiones.join(' ')).toContain('WhatsApp');
    expect(v.resumen.conexiones.map((c: { nombre: string }) => c.nombre)).toContain('Datos de tu sitio');

    // «No atendemos Fonasa» se puede escribir desde el flujo normal y se persiste como claim prohibido.
    await responder(a, cookie, 'org-cp-odontologia', 'restricciones', { 'restricciones.noPodemosAfirmar': 'no atendemos Fonasa' });
    const restricciones = await new RepositorioNegocios(pool).restricciones('org-cp-odontologia');
    expect(restricciones.some((r) => r.tipo === 'PROHIBITED_CLAIM' && r.texto === 'no atendemos Fonasa')).toBe(true);
    // Y no se tocó nada de lo que ya tenía.
    expect(restricciones.some((r) => r.id.startsWith('pendiente-'))).toBe(true);
    await a.close();
  });

  it('SmileFlow conserva su política y su configuración: el asistente no la reemplaza', async () => {
    const politica = new RepositorioPolitica(pool);
    const antesKpis = await politica.kpis('org-smileflow');
    const antesReglas = await politica.reglas('org-smileflow');
    const antesCaps = await new RepositorioConexiones(pool).capacidades('org-smileflow');

    const a = app();
    // El slug histórico de identidad de SmileFlow es el alias `smileflow`; el gateway lo canoniza.
    const cookie = await duenaDeEmpresaHistorica(a, 'duena-sf@soec.cl', 'smileflow');
    const res = await a.inject({ method: 'GET', url: '/onboarding', headers: { cookie, 'x-organization-slug': 'smileflow' } });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().organizationId).toBe('org-smileflow');

    // Abrir el asistente NO cambia su política ni sus capacidades.
    expect(await politica.kpis('org-smileflow')).toEqual(antesKpis);
    expect(await politica.reglas('org-smileflow')).toEqual(antesReglas);
    expect(await new RepositorioConexiones(pool).capacidades('org-smileflow')).toEqual(antesCaps);
    await a.close();
  });
});
