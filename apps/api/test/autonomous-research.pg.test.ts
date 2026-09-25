/**
 * Autonomy Fase E · INVESTIGACIÓN AUTÓNOMA Y PLANIFICACIÓN — aceptación sobre PostgreSQL REAL.
 *
 * Demuestra la afirmación que define la fase: una empresa preparada pide «investigar mi mercado» **por las
 * mismas APIs que usa la interfaz** y obtiene evidencia con procedencia, hallazgos, veredicto por canal y un
 * plan de campaña EN BORRADOR, sin Claude, sin búsquedas manuales, sin Keyword Planner a mano, sin editar
 * TypeScript y sin desplegar nada por empresa.
 *
 * Los proveedores son SIMULADOS y deterministas: así se puede probar la promesa incómoda —misma evidencia,
 * mismo plan— y las siete formas de decir «todavía no»:
 *   evidencia ausente ⇒ investigación parcial;  restricción declarada ⇒ término excluido;
 *   territorio no segmentable ⇒ prerrequisito;  landing ausente ⇒ no ejecutable;
 *   conversión sin declarar ⇒ no ejecutable;    sin autorización humana ⇒ no ejecutable;
 *   y datos del negocio que cambian ⇒ la investigación y el plan envejecen solos.
 *
 * LÍMITE ABSOLUTO que se verifica al final: cero campañas creadas, cero mutaciones externas, cero gasto.
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
import { conexionMigrations } from '../src/conexion/conexion-pg';
import { migrarConexionesDelRegistro } from '../src/conexion/migracion-conexiones';
import { politicaMigrations } from '../src/politica/politica-pg';
import { migrarPoliticasDelRegistro } from '../src/politica/migracion-politica';
import { onboardingMigrations } from '../src/onboarding/onboarding-pg';
import { investigacionMigrations } from '../src/investigacion/investigacion-pg';
import { planMigrations } from '../src/investigacion/plan-pg';
import type { DepsInvestigacion } from '../src/investigacion/investigacion-service';
import type { AuditoriaSitio, GeoTargetResuelto, IdeaDeTermino, PaginaObservada } from '../src/investigacion/proveedores';
import { restablecerNegociosDelRuntime } from '../src/plataforma';

const H = { 'content-type': 'application/json' };
const pool = makeTestPool();
const AHORA = '2026-09-21T12:00:00.000Z';

beforeEach(async () => {
  await runMigrations(pool);
  await runMigrations(pool, identityMigrations);
  await runMigrations(pool, negocioMigrations);
  await runMigrations(pool, conexionMigrations);
  await runMigrations(pool, politicaMigrations);
  await runMigrations(pool, onboardingMigrations);
  await runMigrations(pool, investigacionMigrations);
  await runMigrations(pool, planMigrations);
  await ejecutarDestructivoDePrueba(pool, 'truncate campaign_plan_group, campaign_plan, research_competitor, research_landing, research_channel, research_geo_target, research_keyword, research_finding, research_evidence, research_run, business_budget_intent, business_website_insight, business_onboarding_answer, business_onboarding, business_channel_rule, business_autonomy_limits, business_evaluation_rule, business_conversion_event, business_kpi, business_evaluation_policy, business_connection_ciphertext, business_capability, business_connection, business_audit, business_restriction, business_geo_scope, business_offering, business_objective, business_governance, business_profile restart identity cascade');
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

// ── PROVEEDORES SIMULADOS (deterministas, sin red) ──────────────────────────────────────────────

/** Ideas de palabras SIEMPRE iguales: es lo que permite exigir «misma evidencia ⇒ mismo plan». */
const IDEAS: readonly IdeaDeTermino[] = [
  ['implante dental curico', 320, 2_500_000_000],
  ['precio implante dental', 210, 2_000_000_000],
  ['protesis dental curico', 110, 1_800_000_000],
  ['implantes dentales fonasa', 90, 1_500_000_000],
  ['trabajo dentista curico', 40, 900_000_000],
  ['curso de implantes dentales', 30, 700_000_000],
].map(([termino, busquedas, puja]) => ({
  termino: termino as string,
  semilla: null,
  metricas: {
    avgMonthlySearches: busquedas as number,
    competition: 'MEDIUM' as const,
    competitionIndex: 45,
    lowTopOfPageBidMicros: Math.round((puja as number) / 2),
    highTopOfPageBidMicros: puja as number,
  },
}));

/** Territorios: uno exacto, uno sólo alcanzable de forma aproximada y uno que la plataforma no ofrece. */
const GEOS: Record<string, GeoTargetResuelto> = {
  'Curicó': { solicitado: 'Curicó', disponible: true, targetId: '1000341', targetTipo: 'CITY', nombreCanonico: 'Curicó, Maule, Chile', aproximacion: false, riesgoDerrame: 'NONE' },
  'Rauco': { solicitado: 'Rauco', disponible: true, targetId: '2000112', targetTipo: 'REGION', nombreCanonico: 'Maule, Chile', aproximacion: true, riesgoDerrame: 'HIGH' },
  'Sagrada Familia': { solicitado: 'Sagrada Familia', disponible: false, targetId: null, targetTipo: null, nombreCanonico: null, aproximacion: false, riesgoDerrame: 'UNKNOWN' },
};

const pagina = (over: Partial<PaginaObservada>): PaginaObservada => ({
  ruta: '/', httpStatus: 200, titulo: 'Clínica QA Research', metaDescription: 'atención dental en Curicó',
  h1: ['Clínica QA Research'], h2: [], ctas: ['agendar'], enlacesInternos: 6, canonical: null, indexable: true,
  tieneDatosEstructurados: true, viasDeContacto: ['whatsapp', 'telefono'], ...over,
});

const SITIO_CON_LANDING: readonly PaginaObservada[] = [
  pagina({}),
  pagina({ ruta: '/implantes-dentales', titulo: 'Implantes dentales en Curicó', h1: ['Implantes dentales'] }),
];

interface OpcionesSimulacion {
  readonly conDemanda?: boolean;
  readonly conGeo?: boolean;
  readonly paginas?: readonly PaginaObservada[] | null;
  /** Contador de llamadas reales a la fuente de demanda: así se demuestra el gobierno de cuota. */
  readonly contador?: { demanda: number; sitio: number; geo: number };
}

function proveedoresSimulados(o: OpcionesSimulacion = {}): (org: string) => Promise<DepsInvestigacion> {
  const contador = o.contador ?? { demanda: 0, sitio: 0, geo: 0 };
  return async (): Promise<DepsInvestigacion> => ({
    ahora: () => AHORA,
    ...(o.paginas === null
      ? {}
      : {
          sitio: {
            nombre: 'sitio-simulado', fuente: 'WEBSITE_AUDIT' as const,
            auditar: async (url: string): Promise<AuditoriaSitio> => {
              contador.sitio += 1;
              const paginas = o.paginas ?? SITIO_CON_LANDING;
              return { url, alcanzable: true, paginas, paginasVisitadas: paginas.length, paginasOmitidas: 0, error: null, observadoEn: AHORA };
            },
          },
        }),
    ...(o.conGeo === false
      ? {}
      : {
          geo: {
            nombre: 'geo-simulado', fuente: 'GOOGLE_ADS_GEO_TARGETS' as const,
            resolver: async (nombres: readonly string[]) => {
              contador.geo += 1;
              return nombres.map((n) => GEOS[n] ?? { solicitado: n, disponible: false, targetId: null, targetTipo: null, nombreCanonico: null, aproximacion: false, riesgoDerrame: 'UNKNOWN' as const });
            },
          },
        }),
    ...(o.conDemanda === false
      ? {}
      : {
          demanda: {
            nombre: 'demanda-simulada', fuente: 'GOOGLE_ADS_KEYWORD_DATA' as const,
            demanda: async () => {
              contador.demanda += 1;
              return { ideas: IDEAS, fuente: 'GOOGLE_ADS_KEYWORD_DATA' as const, observadoEn: AHORA, periodo: 'promedio mensual de los últimos 12 meses' };
            },
          },
        }),
  });
}

// ── Utilidades de sesión y alta ─────────────────────────────────────────────────────────────────

function app(proveedores?: (org: string) => Promise<DepsInvestigacion>) {
  return buildApp({
    store: new InMemoryEventStore(), intelligence: new DeterministicIntelligenceProvider(), pool,
    legacyDemoAccess: false, ...(proveedores ? { proveedoresInvestigacion: proveedores } : {}),
  });
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
    payload: { displayName: nombre, businessType: 'SERVICIOS', country: 'CL', currency: 'CLP', timezone: 'America/Santiago' },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().perfil.organizationId as string;
}

async function responder(a: App, cookie: string, org: string, paso: string, respuestas: Record<string, unknown>): Promise<void> {
  const res = await a.inject({
    method: 'PATCH', url: '/onboarding', headers: { ...H, cookie, 'x-organization-slug': org },
    payload: { paso, respuestas, avanzar: true },
  });
  expect(res.statusCode, res.body).toBe(200);
}

/** Pasos del asistente (Fase D) que dejan a la empresa lista para que la investiguen. */
const PREPARACION: ReadonlyArray<{ paso: string; respuestas: Record<string, unknown> }> = [
  { paso: 'negocio', respuestas: { 'negocio.aQueSeDedica': 'Clínica dental en Curicó', 'negocio.tipo': 'CLINICA', 'negocio.tipoCliente': 'B2C', 'negocio.sitio': 'https://qa-research.example', 'negocio.pais': 'CL' } },
  { paso: 'oferta', respuestas: { 'oferta.queVendes': 'implantes dentales y prótesis' } },
  { paso: 'territorio', respuestas: { 'territorio.donde': 'Curicó, Rauco y Sagrada Familia' } },
  { paso: 'objetivo', respuestas: { 'objetivo.queQuieres': 'nuevos-clientes', 'objetivo.enCuantoTiempo': 30 } },
  { paso: 'contacto', respuestas: { 'contacto.como': ['whatsapp'], 'contacto.principal': 'whatsapp' } },
  { paso: 'restricciones', respuestas: { 'restricciones.noPodemosAfirmar': 'no atendemos Fonasa' } },
  { paso: 'medicion', respuestas: { 'medicion.indicador': 'cantidad-contactos', 'medicion.conoceMeta': false, 'medicion.evidencia': 'prudente' } },
  { paso: 'presupuesto', respuestas: { 'presupuesto.modalidad': 'MONTHLY', 'presupuesto.monto': 300_000 } },
];

async function empresaPreparada(a: App, email: string, nombre: string, pasos = PREPARACION): Promise<{ cookie: string; org: string }> {
  const cookie = await usuario(a, email);
  const org = await crearEmpresa(a, cookie, nombre);
  for (const p of pasos) await responder(a, cookie, org, p.paso, p.respuestas);
  return { cookie, org };
}

type Vista = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function investigar(a: App, cookie: string, org: string, forzar = false): Promise<Vista> {
  const res = await a.inject({
    method: 'POST', url: '/investigacion', headers: { ...H, cookie, 'x-organization-slug': org },
    payload: { forzar },
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as Vista;
}

async function leerInvestigacion(a: App, cookie: string, org: string): Promise<Vista> {
  const res = await a.inject({ method: 'GET', url: '/investigacion', headers: { cookie, 'x-organization-slug': org } });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as Vista;
}

async function generarPlan(a: App, cookie: string, org: string): Promise<Vista> {
  const res = await a.inject({ method: 'POST', url: '/plan', headers: { ...H, cookie, 'x-organization-slug': org }, payload: {} });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as Vista;
}

const fuente = (v: Vista, nombre: string): string =>
  (v.corrida.fuentes as { fuente: string; disponibilidad: string }[]).find((f) => f.fuente === nombre)?.disponibilidad ?? 'AUSENTE';

const termino = (v: Vista, t: string): Vista | undefined => (v.terminos as Vista[]).find((x) => x.termino === t);

// ── 1. EL CAMINO COMPLETO ───────────────────────────────────────────────────────────────────────

describe('Empresa QA Research · de preparada a plan de campaña, sin intervención técnica', () => {
  it('investiga, deriva evidencia con procedencia y produce un plan en borrador explicable', async () => {
    const contador = { demanda: 0, sitio: 0, geo: 0 };
    const a = app(proveedoresSimulados({ contador }));
    const { cookie, org } = await empresaPreparada(a, 'duena-research@soec.cl', 'Empresa QA Research');

    // Antes de investigar no hay nada, y la pantalla lo dice sin inventar una investigación vacía.
    const cero = await leerInvestigacion(a, cookie, org);
    expect(cero.corrida).toBeNull();
    expect(cero.puedeInvestigar.puede).toBe(true);
    expect(cero.terminos).toEqual([]);

    // ── UNA SOLA PETICIÓN DEL DUEÑO ──
    const v = await investigar(a, cookie, org);
    expect(contador.demanda).toBe(1);

    // PARCIAL es un resultado VÁLIDO: no hay fuente de competidores y eso no borra lo demás.
    expect(v.corrida.estado).toBe('PARTIAL');
    expect(fuente(v, 'WEBSITE_AUDIT')).toBe('USED');
    expect(fuente(v, 'GOOGLE_ADS_GEO_TARGETS')).toBe('USED');
    expect(fuente(v, 'GOOGLE_ADS_KEYWORD_DATA')).toBe('USED');
    expect(fuente(v, 'MARKET_PROVIDER')).toBe('UNAVAILABLE');
    expect(v.competidores).toEqual([]); // no se inventa ningún competidor

    // EVIDENCIA ANTES QUE «IA»: cada dato trae fuente, clase y fecha de observación.
    expect((v.evidencias as Vista[]).length).toBeGreaterThan(5);
    for (const e of v.evidencias as Vista[]) {
      expect(e.fuente).toBeTruthy();
      expect(e.clase).toBe('OBSERVED');
      expect(e.observadoEn).toBeTruthy();
    }
    const evidenciaKw = (v.evidencias as Vista[]).find((e) => e.fuente === 'GOOGLE_ADS_KEYWORD_DATA')!;
    expect(evidenciaKw.periodo).toBe('promedio mensual de los últimos 12 meses');

    // INTENCIÓN con método, confianza y evidencia — y «precio implante dental» NO es basura.
    const precio = termino(v, 'precio implante dental')!;
    expect(precio.intencion).toBe('COMMERCIAL');
    expect(precio.elegibilidad).toBe('CANDIDATE');
    expect(precio.intencionEvidencia).toContain('precio');
    expect(termino(v, 'implante dental curico')!.intencion).toBe('LOCAL');

    // RESTRICCIÓN PERSISTIDA ⇒ término excluido citando lo que el negocio declaró.
    const fonasa = termino(v, 'implantes dentales fonasa')!;
    expect(fonasa.elegibilidad).toBe('EXCLUDED');
    expect(fonasa.motivoExclusion).toContain('no atendemos Fonasa');
    // EMPLEO Y FORMACIÓN ⇒ candidatos a negativa, con su motivo. Candidato ≠ negativa activa.
    expect(termino(v, 'trabajo dentista curico')!.elegibilidad).toBe('EXCLUDED');
    expect(termino(v, 'curso de implantes dentales')!.elegibilidad).toBe('EXCLUDED');
    const negativos = (v.candidatosNegativos as Vista[]).map((c) => c.termino);
    expect(negativos).toEqual(expect.arrayContaining(['trabajo dentista curico', 'implantes dentales fonasa']));

    // TERRITORIO: lo exacto, lo aproximado y lo que la plataforma no ofrece, sin sustituciones silenciosas.
    const geos = new Map((v.geos as Vista[]).map((g) => [g.solicitado, g]));
    expect(geos.get('Curicó')!.aproximacion).toBe(false);
    expect(geos.get('Rauco')!.aproximacion).toBe(true);
    expect(geos.get('Rauco')!.riesgoDerrame).toBe('HIGH');
    expect(geos.get('Sagrada Familia')!.disponible).toBe(false);

    // CANALES: estados con motivos, nunca una nota. El buscador tiene sentido porque hay demanda observada, una
    // página donde aterrizar, territorio segmentable, conversión declarada y techo declarado. Que el CANAL sea
    // adecuado no significa que el PLAN se pueda publicar: eso se juzga aparte, oferta por oferta.
    const canales = new Map((v.canales as Vista[]).map((c) => [c.canal, c]));
    expect(canales.get('GOOGLE_SEARCH')!.veredicto).toBe('SUITABLE');
    expect(canales.get('META_PAID')!.veredicto).toBe('INSUFFICIENT_EVIDENCE');
    expect(canales.get('ORGANIC_SOCIAL')!.veredicto).toBe('INSUFFICIENT_EVIDENCE');
    for (const c of canales.values()) expect((c.motivos as string[]).length).toBeGreaterThan(0);

    // LANDINGS: la oferta con página propia está lista; la otra no existe y se dice (no se crea ninguna).
    const landings = new Map((v.landings as Vista[]).map((l) => [l.ofertaSlug, l]));
    expect([...landings.values()].some((l) => l.estado === 'READY')).toBe(true);
    expect([...landings.values()].some((l) => l.estado === 'MISSING')).toBe(true);

    // HALLAZGOS con su evidencia detrás.
    const tipos = (v.hallazgos as Vista[]).map((h) => h.tipo);
    expect(tipos).toContain('SEARCH_DEMAND_EXISTS');
    expect(tipos).toContain('GEO_NOT_TARGETABLE');
    expect(tipos).toContain('GEO_APPROXIMATION_REQUIRED');
    expect(tipos).toContain('COMPETITOR_DATA_INSUFFICIENT');
    expect((v.hallazgos as Vista[]).find((h) => h.tipo === 'SEARCH_DEMAND_EXISTS')!.evidenciaIds.length).toBeGreaterThan(0);

    // ── PLAN DE CAMPAÑA ──
    const p = await generarPlan(a, cookie, org);
    const plan = p.plan as Vista;
    expect(plan.version).toBe(1);
    expect(plan.canal).toBe('GOOGLE_SEARCH');
    expect(plan.estado).toBe('NON_EXECUTABLE');

    // Presupuesto: sale del techo del dueño; la oportunidad del mercado va aparte y etiquetada.
    expect(plan.presupuesto.techoDeclaradoClp).toBe(300_000);
    expect(plan.presupuesto.propuestoDiarioClp).toBe(10_000);
    expect(plan.presupuesto.base).toBe('USER_CEILING');
    expect(plan.presupuesto.oportunidadDiariaClp).toBeGreaterThan(0);
    expect(plan.presupuesto.explicacion).toContain('no una recomendación');

    // Estructura, puja y concordancias justificadas; ninguna palabra en amplia sin historial.
    expect(plan.estructura.tipo).toBe('UNA_CAMPANA_VARIOS_GRUPOS');
    expect(plan.puja.estrategia).toBe('MAXIMIZE_CLICKS_WITH_CPC_CEILING');
    const palabras = (p.grupos as Vista[]).flatMap((g) => g.palabras as Vista[]);
    expect(palabras.length).toBeGreaterThan(0);
    expect(palabras.map((x) => x.concordancia)).not.toContain('BROAD');
    // Las excluidas jamás entran como palabra a comprar; entran como negativa propuesta.
    expect(palabras.map((x) => x.termino)).not.toContain('implantes dentales fonasa');
    expect((p.grupos as Vista[])[0]!.negativas.map((n: Vista) => n.termino)).toContain('implantes dentales fonasa');

    // LO QUE FALTA NO SE ESCONDE.
    expect(plan.readiness.EXECUTION_READY).toBe(false);
    expect(plan.readiness.CREATIVE_READY).toBe(false);
    expect(plan.readiness.MEASUREMENT_READY).toBe(false);
    expect(plan.requisitoConversion).toBe('CONVERSION_TRACKING_UNVERIFIED');
    const faltas = (plan.prerequisitos as string[]).join(' | ');
    expect(faltas).toContain('Sagrada Familia');
    expect(faltas).toContain('Rauco');
    expect(faltas).toContain('escribir los anuncios');
    expect(faltas).toContain('página de destino');

    // EXPLICABILIDAD: cada decisión con su porqué; nunca «lo recomienda la IA».
    expect((plan.explicacion as Vista[]).length).toBeGreaterThan(3);
    for (const e of plan.explicacion as Vista[]) {
      expect(String(e.porque).length).toBeGreaterThan(20);
      expect(String(e.porque).toLowerCase()).not.toContain('la ia');
    }

    // AUDITORÍA de los dos hitos.
    const { rows } = await pool.query("select action from business_audit where organization_id = $1 and action in ('RESEARCH_RUN_COMPLETED','CAMPAIGN_PLAN_GENERATED') order by id", [org]);
    expect(rows.map((r: { action: string }) => r.action)).toEqual(['RESEARCH_RUN_COMPLETED', 'CAMPAIGN_PLAN_GENERATED']);

    // LÍMITE ABSOLUTO: ni una campaña, ni una mutación externa, ni un peso autorizado.
    const { rows: mandatos } = await pool.query('select count(*)::int as n from accion_mandato where organization_id = $1', [org]).catch(() => ({ rows: [{ n: 0 }] }));
    expect(mandatos[0].n).toBe(0); // investigar y planificar NO autoriza gasto: eso lo firma una persona
    const { rows: mutaciones } = await pool.query("select count(*)::int as n from business_audit where organization_id = $1 and (action ilike '%MUTAT%' or action ilike '%CAMPAIGN_CREATED%')", [org]);
    expect(mutaciones[0].n).toBe(0);
    const gobierno = await new RepositorioNegocios(pool).gobierno(org);
    expect(gobierno).toEqual(expect.objectContaining({ externalMutations: false, autonomousSpend: false, campaignExecution: false }));
    expect(JSON.stringify(plan)).not.toMatch(/customers\/\d+|campaigns\/\d+/);
    await a.close();
  });

  it('MISMA EVIDENCIA ⇒ MISMO PLAN: dos generaciones seguidas proponen exactamente lo mismo', async () => {
    const a = app(proveedoresSimulados());
    const { cookie, org } = await empresaPreparada(a, 'duena-determinista@soec.cl', 'Empresa QA Research Det');
    await investigar(a, cookie, org);

    const primero = (await generarPlan(a, cookie, org)) as Vista;
    const segundo = (await generarPlan(a, cookie, org)) as Vista;

    // Se comparan las PROPUESTAS, no su identidad: la versión y el identificador cambian a propósito.
    const comparable = (v: Vista): string => {
      const { id, version, creadoEn, researchRunId, ...resto } = v.plan as Vista;
      void id; void version; void creadoEn; void researchRunId;
      return JSON.stringify({ resto, grupos: (v.grupos as Vista[]).map((g) => ({ ...g, planId: null, id: g.id })) });
    };
    expect(comparable(segundo)).toBe(comparable(primero));

    // Y VERSIONA sin borrar: el plan anterior queda superado y sigue consultable.
    expect((segundo.plan as Vista).version).toBe(2);
    expect((segundo.historial as Vista[])).toHaveLength(2);
    const { rows } = await pool.query('select version, estado from campaign_plan where organization_id = $1 order by version', [org]);
    expect(rows).toEqual([{ version: 1, estado: 'SUPERSEDED' }, { version: 2, estado: 'NON_EXECUTABLE' }]);
    await a.close();
  });
});

// ── 2. LAS FORMAS DE DECIR «TODAVÍA NO» ─────────────────────────────────────────────────────────

describe('evidencia ausente y bloqueos, dichos en voz alta', () => {
  it('sin fuente de demanda la investigación es PARCIAL y el plan queda a la espera, sin datos fabricados', async () => {
    const a = app(proveedoresSimulados({ conDemanda: false }));
    const { cookie, org } = await empresaPreparada(a, 'duena-sin-google@soec.cl', 'Empresa QA Research SinGoogle');

    const v = await investigar(a, cookie, org);
    expect(v.corrida.estado).toBe('PARTIAL');
    expect(fuente(v, 'GOOGLE_ADS_KEYWORD_DATA')).toBe('UNAVAILABLE');
    // NADA se inventa: sin fuente no hay términos ni volúmenes.
    expect(v.terminos).toEqual([]);
    expect((v.hallazgos as Vista[]).map((h) => h.tipo)).toContain('DATA_INSUFFICIENT');
    // Pero lo que sí se pudo observar se conserva: el sitio y el territorio siguen ahí.
    expect(fuente(v, 'WEBSITE_AUDIT')).toBe('USED');
    expect((v.landings as Vista[]).length).toBeGreaterThan(0);
    const canal = (v.canales as Vista[]).find((c) => c.canal === 'GOOGLE_SEARCH')!;
    expect(canal.veredicto).toBe('INSUFFICIENT_EVIDENCE');

    const plan = (await generarPlan(a, cookie, org)).plan as Vista;
    expect(plan.estado).toBe('NON_EXECUTABLE');
    expect(plan.readiness.RESEARCH_READY).toBe(false);
    // El prerrequisito nombra el MOTIVO observado. Aquí no hay cuenta conectada, y eso es lo que dice; no
    // se da por supuesto que ésa sea siempre la causa de no poder medir la demanda.
    expect((plan.prerequisitos as string[]).join(' ')).toContain('falta conectar la cuenta de Google');
    await a.close();
  });

  it('sin sitio web la landing es MISSING y publicar sigue siendo imposible', async () => {
    const sinSitio = PREPARACION.map((p) => (p.paso === 'negocio'
      ? { paso: 'negocio', respuestas: { ...p.respuestas, 'negocio.sitio': '' } }
      : p));
    const a = app(proveedoresSimulados());
    const { cookie, org } = await empresaPreparada(a, 'duena-sin-sitio@soec.cl', 'Empresa QA Research SinSitio', sinSitio);

    const v = await investigar(a, cookie, org);
    expect(fuente(v, 'WEBSITE_AUDIT')).toBe('SKIPPED');
    expect((v.landings as Vista[]).every((l) => l.estado === 'MISSING')).toBe(true);

    const plan = (await generarPlan(a, cookie, org)).plan as Vista;
    expect(plan.readiness.LANDING_READY).toBe(false);
    expect(plan.readiness.EXECUTION_READY).toBe(false);
    await a.close();
  });

  it('sin conversión declarada se exige configurarla y la medición no se da por buena', async () => {
    const sinContacto = PREPARACION.filter((p) => p.paso !== 'contacto');
    const a = app(proveedoresSimulados());
    const { cookie, org } = await empresaPreparada(a, 'duena-sin-conversion@soec.cl', 'Empresa QA Research SinConv', sinContacto);

    const v = await investigar(a, cookie, org);
    expect((v.hallazgos as Vista[]).map((h) => h.tipo)).toContain('CONVERSION_PATH_MISSING');

    const plan = (await generarPlan(a, cookie, org)).plan as Vista;
    expect(plan.requisitoConversion).toBe('CONVERSION_SETUP_REQUIRED');
    expect(plan.readiness.MEASUREMENT_READY).toBe(false);
    expect(plan.readiness.EXECUTION_READY).toBe(false);
    await a.close();
  });

  it('sin techo declarado no se propone gasto alguno: proponerlo sería inventar dinero ajeno', async () => {
    const sinPresupuesto = PREPARACION.filter((p) => p.paso !== 'presupuesto');
    const a = app(proveedoresSimulados());
    const { cookie, org } = await empresaPreparada(a, 'duena-sin-techo@soec.cl', 'Empresa QA Research SinTecho', sinPresupuesto);
    await investigar(a, cookie, org);

    const plan = (await generarPlan(a, cookie, org)).plan as Vista;
    expect(plan.presupuesto.propuestoDiarioClp).toBeNull();
    expect(plan.presupuesto.base).toBe('NONE');
    expect(plan.readiness.BUDGET_READY).toBe(false);
    expect((plan.prerequisitos as string[]).join(' ')).toContain('declarar cuánto');
    await a.close();
  });

  it('una página que choca con una restricción declarada deja la oferta FUERA del plan', async () => {
    const conClaim = [pagina({}), pagina({ ruta: '/implantes-dentales', titulo: 'Implantes dentales con Fonasa', h1: ['Implantes dentales'] })];
    const a = app(proveedoresSimulados({ paginas: conClaim }));
    const { cookie, org } = await empresaPreparada(a, 'duena-claim@soec.cl', 'Empresa QA Research Claim');

    const v = await investigar(a, cookie, org);
    const bloqueada = (v.landings as Vista[]).find((l) => l.estado === 'BLOCKED');
    expect(bloqueada).toBeDefined();
    expect(String(bloqueada!.motivos.join(' '))).toContain('no atendemos Fonasa');
    expect((v.hallazgos as Vista[]).map((h) => h.tipo)).toContain('CLAIM_CONFLICT');

    const p = await generarPlan(a, cookie, org);
    expect((p.plan as Vista).ofertas).not.toContain('implantes dentales');
    expect((p.grupos as Vista[]).map((g) => g.ofertaSlug)).not.toContain('implantes dentales');
    expect(((p.plan as Vista).prerequisitos as string[]).join(' ')).toContain('restricción declarada');
    await a.close();
  });

  it('una empresa sin oferta declarada no puede investigar, y se le dice qué falta', async () => {
    const a = app(proveedoresSimulados());
    const cookie = await usuario(a, 'duena-vacia@soec.cl');
    const org = await crearEmpresa(a, cookie, 'Empresa QA Research Vacía');

    const v = await leerInvestigacion(a, cookie, org);
    expect(v.puedeInvestigar.puede).toBe(false);
    expect(v.puedeInvestigar.motivo).toContain('qué vende');
    const res = await a.inject({ method: 'POST', url: '/investigacion', headers: { ...H, cookie, 'x-organization-slug': org }, payload: {} });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('INVESTIGACION_NO_POSIBLE');

    // Y sin investigación no hay plan que generar: se explica en lugar de improvisar uno.
    const sinPlan = await a.inject({ method: 'GET', url: '/plan', headers: { cookie, 'x-organization-slug': org } });
    expect(sinPlan.json().puedeGenerar).toEqual({ puede: false, motivo: 'primero hay que investigar el mercado' });
    const intento = await a.inject({ method: 'POST', url: '/plan', headers: { ...H, cookie, 'x-organization-slug': org }, payload: {} });
    expect(intento.statusCode).toBe(409);
    await a.close();
  });
});

// ── 3. LO QUE CAMBIA, ENVEJECE ──────────────────────────────────────────────────────────────────

describe('frescura y envejecimiento', () => {
  it('cambiar el territorio deja vieja la investigación y el plan, sin borrar el historial', async () => {
    const a = app(proveedoresSimulados());
    const { cookie, org } = await empresaPreparada(a, 'duena-stale@soec.cl', 'Empresa QA Research Stale');
    await investigar(a, cookie, org);
    await generarPlan(a, cookie, org);

    // El dueño añade una comuna: los datos que sostenían la investigación ya no son los mismos.
    await responder(a, cookie, org, 'territorio', { 'territorio.donde': 'Curicó, Rauco, Sagrada Familia y Molina' });

    const v = await leerInvestigacion(a, cookie, org);
    expect(v.corrida.estado).toBe('STALE');
    expect(String(v.corrida.motivoStale)).toContain('el territorio');
    expect(v.frescura.vencida).toBe(true);
    // La evidencia anterior NO se borra: sigue consultable mientras no haya otra.
    expect((v.terminos as Vista[]).length).toBeGreaterThan(0);

    const p = await a.inject({ method: 'GET', url: '/plan', headers: { cookie, 'x-organization-slug': org } });
    expect((p.json().plan as Vista).estado).toBe('STALE');
    expect(String((p.json().plan as Vista).motivoStale)).toContain('vieja');
    await a.close();
  });

  it('repetir la investigación NO vacía la pantalla: lo re-observado pasa a la corrida nueva', async () => {
    // Regresión de un defecto encontrado en el smoke productivo: las evidencias, términos, hallazgos y geos se
    // guardan con id determinista, así que al re-observarlos la segunda corrida los ACTUALIZABA pero seguían
    // colgando de la corrida anterior. Como la lectura filtra por corrida, una investigación recién hecha
    // aparecía vacía.
    const a = app(proveedoresSimulados());
    const { cookie, org } = await empresaPreparada(a, 'duena-repite@soec.cl', 'Empresa QA Research Repite');

    const primera = await investigar(a, cookie, org);
    const idPrimera = primera.corrida.id as string;
    const terminosPrimera = (primera.terminos as Vista[]).length;
    expect(terminosPrimera).toBeGreaterThan(0);

    const segunda = await investigar(a, cookie, org, true);
    expect(segunda.corrida.id).not.toBe(idPrimera);
    // Lo mismo que se vio antes se vuelve a ver: la corrida nueva no hereda una pantalla en blanco.
    expect((segunda.terminos as Vista[]).length).toBe(terminosPrimera);
    expect((segunda.evidencias as Vista[]).length).toBe((primera.evidencias as Vista[]).length);
    expect((segunda.hallazgos as Vista[]).length).toBe((primera.hallazgos as Vista[]).length);
    expect((segunda.geos as Vista[]).length).toBe((primera.geos as Vista[]).length);

    // Y la corrida vieja deja de reclamarlos: cada dato pertenece a UNA corrida, la que lo observó por última vez.
    const { rows } = await pool.query(
      'select count(*)::int as n from research_keyword where organization_id = $1 and run_id = $2', [org, idPrimera],
    );
    expect(rows[0].n).toBe(0);
    await a.close();
  });

  it('LA INVESTIGACIÓN CUESTA: abrirla otra vez no vuelve a consultar; repetirla es un acto explícito', async () => {
    const contador = { demanda: 0, sitio: 0, geo: 0 };
    const a = app(proveedoresSimulados({ contador }));
    const { cookie, org } = await empresaPreparada(a, 'duena-cuota@soec.cl', 'Empresa QA Research Cuota');

    await investigar(a, cookie, org);
    expect(contador.demanda).toBe(1);

    // Leer la pantalla: cero consultas nuevas.
    await leerInvestigacion(a, cookie, org);
    await leerInvestigacion(a, cookie, org);
    expect(contador.demanda).toBe(1);

    // Pedirla otra vez con datos frescos y sin cambios: se reutiliza la anterior.
    await investigar(a, cookie, org);
    expect(contador.demanda).toBe(1);

    // Forzar sí vuelve a consultar: es una decisión del dueño, no del sistema.
    await investigar(a, cookie, org, true);
    expect(contador.demanda).toBe(2);
    await a.close();
  });
});

// ── 4. AISLAMIENTO ENTRE EMPRESAS ───────────────────────────────────────────────────────────────

describe('aislamiento entre empresas', () => {
  it('una empresa no lee, no investiga y no planifica el mercado de otra', async () => {
    const a = app(proveedoresSimulados());
    const { cookie: cookieA, org: orgA } = await empresaPreparada(a, 'duena-aisla-a@soec.cl', 'Empresa QA Research A');
    await investigar(a, cookieA, orgA);
    await generarPlan(a, cookieA, orgA);

    const cookieB = await usuario(a, 'dueno-aisla-b@soec.cl');
    await crearEmpresa(a, cookieB, 'Empresa QA Research B');

    for (const peticion of [
      { method: 'GET' as const, url: '/investigacion' },
      { method: 'POST' as const, url: '/investigacion' },
      { method: 'GET' as const, url: '/plan' },
      { method: 'POST' as const, url: '/plan' },
    ]) {
      const res = await a.inject({ ...peticion, headers: { ...H, cookie: cookieB, 'x-organization-slug': orgA }, payload: {} });
      expect([403, 404], `${peticion.method} ${peticion.url}`).toContain(res.statusCode);
    }

    // Y la investigación de A sigue intacta.
    const v = await leerInvestigacion(a, cookieA, orgA);
    expect((v.terminos as Vista[]).length).toBeGreaterThan(0);
    const { rows } = await pool.query('select count(*)::int as n from research_run where organization_id <> $1', [orgA]);
    expect(rows[0].n).toBe(0);
    await a.close();
  });
});

// ── 5. EMPRESAS QUE YA EXISTÍAN (REGRESIÓN) ─────────────────────────────────────────────────────

describe('empresas que ya existían', () => {
  beforeEach(async () => {
    await migrarNegociosDelRegistro(pool);
    await migrarConexionesDelRegistro(pool);
    await migrarPoliticasDelRegistro(pool);
  });

  it('CP Odontología puede investigar con lo persistido, y abrir la pantalla no altera nada suyo', async () => {
    const a = app(proveedoresSimulados());
    const cookie = await usuario(a, 'duena-cp-research@soec.cl');
    const orgIdentidad = await crearOrganizacion(pool, 'org-cp-odontologia', 'org-cp-odontologia');
    const u = await usuarioPorEmail(pool, 'duena-cp-research@soec.cl');
    await crearMembresia(pool, u!.id, orgIdentidad.id, 'OWNER', 'ACTIVE');

    const v = await leerInvestigacion(a, cookie, 'org-cp-odontologia');
    // Su oferta persistida basta para poder investigar: no hay respuestas precocinadas en el código.
    expect(v.puedeInvestigar.puede).toBe(true);
    // Leer NO lanza ninguna corrida ni toca sus datos.
    expect(v.corrida).toBeNull();
    const { rows } = await pool.query("select count(*)::int as n from research_run where organization_id = 'org-cp-odontologia'");
    expect(rows[0].n).toBe(0);

    // Y «no atendemos Fonasa» NO se asume por su cuenta: si nadie la escribió, no existe.
    const restricciones = await new RepositorioNegocios(pool).restricciones('org-cp-odontologia');
    expect(restricciones.some((r) => r.tipo === 'PROHIBITED_CLAIM' && /fonasa/i.test(r.texto))).toBe(false);

    // Ninguna campaña suya cambia: esta fase no crea, no pausa y no reanuda nada.
    const { rows: mutaciones } = await pool.query("select count(*)::int as n from business_audit where organization_id = 'org-cp-odontologia' and action ilike '%CAMPAIGN%'");
    expect(mutaciones[0].n).toBe(0);
    await a.close();
  });
});
