/**
 * MANDATO FINANCIERO — superficie humana sobre PostgreSQL REAL.
 *
 * Lo que se demuestra aquí es la frase entera de la fase: una persona puede autorizar un presupuesto, el
 * sistema lo guarda tal cual, lo muestra en su moneda… y no se enciende NADA. Ni escritura, ni autonomía, ni
 * campaña. Y a la vez, ese presupuesto manda: sin él no se materializa ningún sobre de ejecución.
 *
 * Ninguna prueba toca CP ni ninguna empresa real: todo ocurre en una empresa QA creada por las mismas APIs
 * que usa la interfaz.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@soec/event-store/pg';
import { identityMigrations } from '@soec/identity/pg';
import { InMemoryEventStore } from '@soec/event-store';
import { DeterministicIntelligenceProvider } from '@soec/intelligence';
import { makeTestPool, ejecutarDestructivoDePrueba } from '@soec/event-store/test-db';
import { buildApp } from '../src/app';
import { negocioMigrations } from '../src/negocio/negocio-pg';
import { conexionMigrations, RepositorioConexiones } from '../src/conexion/conexion-pg';
import { refrescarNegociosDelRuntime } from '../src/conexion/snapshot';
import { accionMigrations } from '../src/accion/accion-pg';
import { politicaMigrations } from '../src/politica/politica-pg';
import { onboardingMigrations } from '../src/onboarding/onboarding-pg';
import { restablecerNegociosDelRuntime } from '../src/plataforma';

const H = { 'content-type': 'application/json' };
const pool = makeTestPool();

beforeEach(async () => {
  await runMigrations(pool);
  await runMigrations(pool, identityMigrations);
  await runMigrations(pool, negocioMigrations);
  await runMigrations(pool, conexionMigrations);
  await runMigrations(pool, accionMigrations);
  await runMigrations(pool, politicaMigrations);
  await runMigrations(pool, onboardingMigrations);
  await ejecutarDestructivoDePrueba(pool, 'truncate accion_ledger, accion_mandato, business_onboarding_answer, business_onboarding, business_channel_rule, business_autonomy_limits, business_evaluation_rule, business_conversion_event, business_kpi, business_evaluation_policy, business_capability, business_connection, business_audit, business_restriction, business_geo_scope, business_offering, business_objective, business_governance, business_profile restart identity cascade');
  await ejecutarDestructivoDePrueba(pool, 'truncate identity_password_resets, identity_audit_events, identity_invitations, identity_sessions, identity_memberships, identity_organizations, identity_users cascade');
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

async function crearEmpresa(a: App, cookie: string, nombre: string): Promise<string> {
  const res = await a.inject({
    method: 'POST', url: '/negocios', headers: { ...H, cookie },
    payload: { displayName: nombre, businessType: 'CLINICA', country: 'CL', currency: 'CLP', timezone: 'America/Santiago', website: 'https://qa-mandato.example' },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().perfil.organizationId as string;
}

/**
 * ALTA MÍNIMA de la empresa QA: sin estas respuestas el planificador no tiene perfil de evaluación y no
 * produce plan. No es decoración del test: es el mismo camino que recorre una persona en la interfaz.
 */
const PASOS: Array<{ paso: string; respuestas: Record<string, unknown> }> = [
  { paso: 'oferta', respuestas: { 'oferta.queVendes': 'implantes dentales' } },
  { paso: 'territorio', respuestas: { 'territorio.donde': 'Curicó' } },
  { paso: 'objetivo', respuestas: { 'objetivo.queQuieres': 'nuevos-clientes', 'objetivo.enCuantoTiempo': 30 } },
  { paso: 'contacto', respuestas: { 'contacto.como': ['whatsapp'], 'contacto.principal': 'whatsapp' } },
  { paso: 'medicion', respuestas: { 'medicion.indicador': 'cantidad-contactos', 'medicion.conoceMeta': false, 'medicion.evidencia': 'prudente' } },
  { paso: 'presupuesto', respuestas: { 'presupuesto.modalidad': 'MONTHLY', 'presupuesto.monto': 300_000 } },
];

const h = (cookie: string, org: string) => ({ ...H, cookie, 'x-organization-slug': org });

/** La autorización REAL que se va a registrar para CP: 30.000 CLP en total, 2.500 al día, en Google Ads. */
const AUTORIZACION = { moneda: 'CLP', totalMaximo: 30_000, maximoDiario: 2_500, canal: 'GOOGLE_ADS' };

async function negocio(a: App, email: string, nombre: string): Promise<{ cookie: string; org: string }> {
  const cookie = await usuario(a, email);
  return { cookie, org: await crearEmpresa(a, cookie, nombre) };
}

describe('una persona autoriza un presupuesto', () => {
  it('antes de autorizar nada, no hay presupuesto: se dice que no hay, no cero', async () => {
    const a = app();
    const { cookie, org } = await negocio(a, 'qa-mandato-1@soec.cl', 'QA Mandato Uno');
    const r = await a.inject({ method: 'GET', url: '/mandato-financiero', headers: h(cookie, org) });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().presupuesto).toBeNull();
  });

  it('se guarda tal como se escribió y se lee en pesos, sin micros ni jerga del mecanismo', async () => {
    const a = app();
    const { cookie, org } = await negocio(a, 'qa-mandato-2@soec.cl', 'QA Mandato Dos');
    const post = await a.inject({ method: 'POST', url: '/mandato-financiero', headers: h(cookie, org), payload: AUTORIZACION });
    expect(post.statusCode, post.body).toBe(201);
    const creado = post.json();
    expect(creado.presupuesto.totalMaximo).toBe(30_000);
    expect(creado.presupuesto.maximoDiario).toBe(2_500);
    expect(creado.presupuesto.moneda).toBe('CLP');
    expect(creado.canal).toBe('GOOGLE_ADS');

    const get = await a.inject({ method: 'GET', url: '/mandato-financiero', headers: h(cookie, org) });
    expect(get.json().presupuesto.totalMaximo).toBe(30_000);
    expect(get.json().presupuesto.maximoDiario).toBe(2_500);
    expect(get.json().presupuesto.vigente).toBe(true);
    expect(get.body).not.toMatch(/micros|MCC|envelope|customerId/i);

    // AUTORÍA: quien autorizó es la sesión, no algo que el cliente pudiera declarar.
    const fila = await pool.query('select authorized_by, daily_cap_minor, authorized_budget_minor, provider, currency from accion_mandato where organization_id=$1', [org]);
    expect(fila.rows).toHaveLength(1);
    // Quien autoriza es el ACTOR de la sesión (el id del usuario), y nunca la maquinaria del sistema.
    const usuarios = await pool.query('select id from identity_users where email = $1', ['qa-mandato-2@soec.cl']);
    expect(fila.rows[0].authorized_by).toBe(String(usuarios.rows[0].id));
    expect(Number(fila.rows[0].daily_cap_minor)).toBe(2_500);
    expect(Number(fila.rows[0].authorized_budget_minor)).toBe(30_000);
    expect(fila.rows[0].provider).toBe('GOOGLE_ADS');
    expect(fila.rows[0].currency).toBe('CLP');
  });

  it('AUTORIZAR DINERO NO ENCIENDE NADA: ninguna capacidad queda habilitada', async () => {
    const a = app();
    const { cookie, org } = await negocio(a, 'qa-mandato-3@soec.cl', 'QA Mandato Tres');
    await a.inject({ method: 'POST', url: '/mandato-financiero', headers: h(cookie, org), payload: AUTORIZACION });
    const caps = await pool.query('select capacidad, habilitada from business_capability where organization_id=$1 and habilitada = true', [org]);
    expect(caps.rows).toEqual([]);
    const estado = await a.inject({ method: 'GET', url: '/conexiones', headers: h(cookie, org) });
    if (estado.statusCode === 200) {
      const cs = estado.json().capacidades as Array<{ capacidad: string; habilitada: boolean }>;
      expect(cs.filter((c) => c.habilitada)).toEqual([]);
    }
  });

  it('pulsar dos veces no crea dos presupuestos (idempotente por lo autorizado)', async () => {
    const a = app();
    const { cookie, org } = await negocio(a, 'qa-mandato-4@soec.cl', 'QA Mandato Cuatro');
    const p1 = await a.inject({ method: 'POST', url: '/mandato-financiero', headers: h(cookie, org), payload: AUTORIZACION });
    const p2 = await a.inject({ method: 'POST', url: '/mandato-financiero', headers: h(cookie, org), payload: AUTORIZACION });
    expect(p1.statusCode).toBe(201);
    expect(p2.statusCode).toBe(200);
    expect(p2.json().creado).toBe(false);
    const filas = await pool.query('select id, version from accion_mandato where organization_id=$1', [org]);
    expect(filas.rows).toHaveLength(1);
    expect(Number(filas.rows[0].version)).toBe(1);
  });

  it('cambiar una cifra es otra autorización, y se guarda aparte', async () => {
    const a = app();
    const { cookie, org } = await negocio(a, 'qa-mandato-5@soec.cl', 'QA Mandato Cinco');
    await a.inject({ method: 'POST', url: '/mandato-financiero', headers: h(cookie, org), payload: AUTORIZACION });
    const otra = await a.inject({ method: 'POST', url: '/mandato-financiero', headers: h(cookie, org), payload: { ...AUTORIZACION, maximoDiario: 3_000 } });
    expect(otra.statusCode).toBe(201);
    const filas = await pool.query('select count(*)::int as n from accion_mandato where organization_id=$1', [org]);
    expect(filas.rows[0].n).toBe(2);
  });

  it('el presupuesto de una empresa no se ve desde otra', async () => {
    const a = app();
    const uno = await negocio(a, 'qa-mandato-6a@soec.cl', 'QA Mandato Seis A');
    const dos = await negocio(a, 'qa-mandato-6b@soec.cl', 'QA Mandato Seis B');
    await a.inject({ method: 'POST', url: '/mandato-financiero', headers: h(uno.cookie, uno.org), payload: AUTORIZACION });
    const ajeno = await a.inject({ method: 'GET', url: '/mandato-financiero', headers: h(dos.cookie, dos.org) });
    expect(ajeno.json().presupuesto).toBeNull();
    // Y tampoco se alcanza declarando la organización de otra persona en la cabecera.
    const suplantado = await a.inject({ method: 'GET', url: '/mandato-financiero', headers: h(dos.cookie, uno.org) });
    expect([401, 403, 404]).toContain(suplantado.statusCode);
  });
});

describe('lo que no se acepta como autorización', () => {
  const casos: Array<{ nombre: string; payload: Record<string, unknown>; error: string }> = [
    { nombre: 'un diario mayor que el total', payload: { ...AUTORIZACION, maximoDiario: 50_000 }, error: 'AUTORIZACION_INVALIDA' },
    { nombre: 'un total de cero', payload: { ...AUTORIZACION, totalMaximo: 0 }, error: 'TOTAL_INVALIDO' },
    { nombre: 'un total negativo', payload: { ...AUTORIZACION, totalMaximo: -30_000 }, error: 'TOTAL_INVALIDO' },
    { nombre: 'un diario de cero', payload: { ...AUTORIZACION, maximoDiario: 0 }, error: 'DIARIO_INVALIDO' },
    { nombre: 'una moneda que no es ISO 4217', payload: { ...AUTORIZACION, moneda: 'pesos' }, error: 'MONEDA_INVALIDA' },
    { nombre: 'ninguna moneda', payload: { totalMaximo: 30_000, canal: 'GOOGLE_ADS' }, error: 'MONEDA_INVALIDA' },
    { nombre: 'un canal desconocido', payload: { ...AUTORIZACION, canal: 'TIKTOK' }, error: 'CANAL_INVALIDO' },
    { nombre: 'ningún canal', payload: { moneda: 'CLP', totalMaximo: 30_000 }, error: 'CANAL_INVALIDO' },
  ];

  it.each(casos)('$nombre se rechaza y no guarda nada', async ({ payload, error }) => {
    const a = app();
    const { cookie, org } = await negocio(a, `qa-mandato-mal-${error}-${String(payload.totalMaximo)}-${String(payload.maximoDiario)}@soec.cl`.toLowerCase(), 'QA Mandato Rechazo');
    const r = await a.inject({ method: 'POST', url: '/mandato-financiero', headers: h(cookie, org), payload });
    expect(r.statusCode, r.body).toBe(400);
    expect(r.json().error).toBe(error);
    const filas = await pool.query('select count(*)::int as n from accion_mandato where organization_id=$1', [org]);
    expect(filas.rows[0].n).toBe(0);
  });

  it('sin sesión no se autoriza dinero', async () => {
    const a = app();
    const r = await a.inject({ method: 'POST', url: '/mandato-financiero', headers: H, payload: AUTORIZACION });
    expect([401, 403]).toContain(r.statusCode);
  });
});

describe('el presupuesto manda sobre el sobre de ejecución', () => {
  /** Deja la empresa con la capacidad técnica encendida y un plan simulado, pero SIN autorización financiera. */
  async function conPlan(a: App, email: string, nombre: string, presupuestoTotal: number): Promise<{ cookie: string; org: string }> {
    const { cookie, org } = await negocio(a, email, nombre);
    for (const p of PASOS) {
      const r = await a.inject({ method: 'PATCH', url: '/onboarding', headers: h(cookie, org), payload: { paso: p.paso, respuestas: p.respuestas, avanzar: true } });
      expect(r.statusCode, r.body).toBe(200);
    }
    const conexiones = new RepositorioConexiones(pool);
    // Cuenta conectada (simulada) y permiso técnico encendido: se deja el camino técnico DESPEJADO a propósito,
    // para que lo único que pueda frenar el sobre sea la falta de autorización financiera.
    await conexiones.guardar(pool, {
      organizationId: org, provider: 'GOOGLE_ADS', id: `${org}:GOOGLE_ADS`, estado: 'CONNECTED',
      configuracion: { customerId: '1234567890', loginCustomerId: '1234567890', campaignId: '111' }, externalAccountId: '1234567890',
      loginAccountId: '1234567890', secretRef: null, validadaEn: new Date().toISOString(), ultimoError: null, origen: 'UI',
    });
    await conexiones.fijarCapacidad(pool, { organizationId: org, capacidad: 'AUTONOMIA_ADS', habilitada: true, origen: 'UI', nota: null, actor: 'prueba' });
    // Criterios del negocio: sin umbral de éxito declarado el planificador no tiene con qué evaluar nada.
    const pol = await a.inject({
      method: 'PATCH', url: '/politica', headers: h(cookie, org),
      payload: {
        objetivoText: 'captar pacientes nuevos de implantes en Curicó',
        eventos: [{ eventKey: 'whatsapp_intent', rol: 'PRIMARY', orden: 1 }],
        kpis: [{ clave: 'contactos', rol: 'PRIMARY', tipo: 'EVENT_COUNT', direccion: 'HIGHER_IS_BETTER', eventKey: 'whatsapp_intent', targetValue: 10 }],
        reglas: [
          { tipo: 'PAUSE', metrica: 'SPEND', comparador: 'GTE', valor: 30_000, procedencia: 'USER_DEFINED' },
          { tipo: 'SUCCESS', metrica: 'COST_PER_CONVERSION', comparador: 'LTE', valor: 25_000, procedencia: 'USER_DEFINED' },
          { tipo: 'EVIDENCE_MINIMUM', metrica: 'CLICKS', comparador: 'GTE', valor: 100, procedencia: 'USER_DEFINED' },
        ],
      },
    });
    expect(pol.statusCode, pol.body).toBe(200);
    await refrescarNegociosDelRuntime(pool);
    const plan = await a.inject({
      method: 'POST', url: '/medicion/campaign-operator-plan', headers: h(cookie, org),
      payload: { objetivo: 'captar pacientes', presupuestoTotal, periodoDias: 30 },
    });
    expect(plan.statusCode, plan.body).toBe(201);
    return { cookie, org };
  }

  it('sin presupuesto autorizado no se materializa ningún sobre, aunque el permiso técnico esté encendido', async () => {
    const a = app();
    const { cookie, org } = await conPlan(a, 'qa-mandato-7@soec.cl', 'QA Mandato Siete', 30_000);
    const r = await a.inject({ method: 'POST', url: '/medicion/envelope', headers: h(cookie, org), payload: {} });
    expect(r.statusCode, r.body).toBe(409);
    expect(r.json().error).toBe('PRESUPUESTO_NO_AUTORIZADO');
    expect(r.json().motivo).toBe('SIN_MANDATO');
  });

  it('un plan que pide más de lo autorizado no consigue sobre, y se dice por qué', async () => {
    const a = app();
    const { cookie, org } = await conPlan(a, 'qa-mandato-8@soec.cl', 'QA Mandato Ocho', 500_000);
    await a.inject({ method: 'POST', url: '/mandato-financiero', headers: h(cookie, org), payload: AUTORIZACION });
    const r = await a.inject({ method: 'POST', url: '/medicion/envelope', headers: h(cookie, org), payload: {} });
    expect(r.statusCode, r.body).toBe(409);
    expect(r.json().motivo).toBe('TOTAL_SUPERA_EL_MANDATO');
  });

  it('con el presupuesto autorizado y un plan que cabe, el sobre se crea — y sigue sin ejecutar nada', async () => {
    const a = app();
    const { cookie, org } = await conPlan(a, 'qa-mandato-9@soec.cl', 'QA Mandato Nueve', 30_000);
    await a.inject({ method: 'POST', url: '/mandato-financiero', headers: h(cookie, org), payload: AUTORIZACION });
    const r = await a.inject({ method: 'POST', url: '/medicion/envelope', headers: h(cookie, org), payload: {} });
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json().envelope.totalCap).toBe(30_000);
    // El sobre nace en borrador/pendiente de aprobación humana: nada aprobado, nada activo, nada gastado.
    expect(['DRAFT', 'READY_FOR_HUMAN_APPROVAL']).toContain(r.json().envelope.status);
    expect(r.json().envelope.approvedBy).toBeNull();
    expect(r.json().envelope.activatedAt).toBeNull();
  });
});
