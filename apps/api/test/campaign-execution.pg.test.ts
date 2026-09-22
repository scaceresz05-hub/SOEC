/**
 * Autonomy Fase F · EJECUCIÓN DE CAMPAÑAS — aceptación sobre PostgreSQL REAL.
 *
 * Recorre lo que hace una persona: contesta el asistente, investiga, prepara el plan, escribe sus anuncios,
 * prepara la medición, firma un presupuesto, aprueba… y SOEC crea la campaña **en pausa**. Todo por las mismas
 * APIs que usa la interfaz, con un Google simulado y determinista.
 *
 * Y demuestra las ocho formas de no crearla: plan viejo, mandato vencido, conflicto de afirmaciones, medición
 * sin verificar, interruptor cerrado, sin permiso de escritura, otra empresa… y la novena, que es la más
 * importante: reintentar NO crea una segunda campaña.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@soec/event-store/pg';
import { identityMigrations } from '@soec/identity/pg';
import { InMemoryEventStore } from '@soec/event-store';
import { DeterministicIntelligenceProvider } from '@soec/intelligence';
import { makeTestPool, ejecutarDestructivoDePrueba } from '@soec/event-store/test-db';
import { buildApp } from '../src/app';
import { negocioMigrations, RepositorioNegocios } from '../src/negocio/negocio-pg';
import { conexionMigrations, RepositorioConexiones } from '../src/conexion/conexion-pg';
import { politicaMigrations } from '../src/politica/politica-pg';
import { onboardingMigrations } from '../src/onboarding/onboarding-pg';
import { investigacionMigrations } from '../src/investigacion/investigacion-pg';
import { planMigrations } from '../src/investigacion/plan-pg';
import { ejecucionMigrations, RepositorioEjecucion } from '../src/ejecucion/ejecucion-pg';
import { accionMigrations } from '../src/accion/accion-pg';
import type { DepsInvestigacion } from '../src/investigacion/investigacion-service';
import type { AuditoriaSitio, GeoTargetResuelto, IdeaDeTermino, PaginaObservada } from '../src/investigacion/proveedores';
import { restablecerNegociosDelRuntime } from '../src/plataforma';

const H = { 'content-type': 'application/json' };
const pool = makeTestPool();
const AHORA = '2026-09-22T12:00:00.000Z';

beforeEach(async () => {
  await runMigrations(pool);
  await runMigrations(pool, identityMigrations);
  await runMigrations(pool, negocioMigrations);
  await runMigrations(pool, conexionMigrations);
  await runMigrations(pool, politicaMigrations);
  await runMigrations(pool, onboardingMigrations);
  await runMigrations(pool, investigacionMigrations);
  await runMigrations(pool, planMigrations);
  await runMigrations(pool, accionMigrations);
  await runMigrations(pool, ejecucionMigrations);
  await ejecutarDestructivoDePrueba(pool, 'truncate execution_reconciliation, creative_asset, tracking_state, conversion_action_mapping, campaign_execution_step, campaign_execution_request, accion_ledger, accion_mandato, campaign_plan_group, campaign_plan, research_competitor, research_landing, research_channel, research_geo_target, research_keyword, research_finding, research_evidence, research_run, business_budget_intent, business_website_insight, business_onboarding_answer, business_onboarding, business_channel_rule, business_autonomy_limits, business_evaluation_rule, business_conversion_event, business_kpi, business_evaluation_policy, business_connection_ciphertext, business_capability, business_connection, business_audit, business_restriction, business_geo_scope, business_offering, business_objective, business_governance, business_profile restart identity cascade');
  await ejecutarDestructivoDePrueba(pool, 'truncate identity_password_resets, identity_audit_events, identity_invitations, identity_sessions, identity_memberships, identity_organizations, identity_users cascade');
  restablecerNegociosDelRuntime();
});
afterAll(async () => {
  restablecerNegociosDelRuntime();
  await pool.end();
});

// ── GOOGLE SIMULADO ─────────────────────────────────────────────────────────────────────────────

interface EstadoGoogle {
  campania: { id: string; nombre: string; estado: string; presupuestoMicros: number } | null;
  grupos: { id: string; nombre: string; estado: string }[];
  palabras: { texto: string; concordancia: string }[];
  negativas: { texto: string }[];
  geo: string[];
  anuncios: number;
  conversiones: { id: string; nombre: string }[];
  escrituras: number;
  creaciones: number;
  fallarCreacion: boolean;
}

function googleSimulado(inicial: Partial<EstadoGoogle> = {}) {
  const s: EstadoGoogle = {
    campania: null, grupos: [], palabras: [], negativas: [], geo: [], anuncios: 0, conversiones: [],
    escrituras: 0, creaciones: 0, fallarCreacion: false, ...inicial,
  };
  const buscar = vi.fn(async (_cid: string, query: string) => {
    if (query.includes('from conversion_action')) {
      const m = /conversion_action.name = '([^']+)'/.exec(query);
      const encontrada = s.conversiones.find((c) => c.nombre === m?.[1]);
      return encontrada === undefined ? [] : [{ conversionAction: { id: encontrada.id, name: encontrada.nombre, resourceName: `customers/1/conversionActions/${encontrada.id}`, status: 'ENABLED', tagSnippets: [{ eventSnippet: `send_to: 'AW-123/${encontrada.id}L'` }] } }];
    }
    if (s.campania === null) return [];
    if (query.includes('from campaign ')) return [{ campaign: { id: s.campania.id, name: s.campania.nombre, status: s.campania.estado, advertisingChannelType: 'SEARCH' }, campaignBudget: { amountMicros: s.campania.presupuestoMicros } }];
    if (query.includes('from ad_group ')) return s.grupos.map((g) => ({ adGroup: { id: g.id, name: g.nombre, status: g.estado } }));
    if (query.includes('from ad_group_criterion')) return s.palabras.map((k) => ({ adGroupCriterion: { keyword: { text: k.texto, matchType: k.concordancia } } }));
    if (query.includes("campaign_criterion.type = 'KEYWORD'")) return s.negativas.map((n) => ({ campaignCriterion: { keyword: { text: n.texto } } }));
    if (query.includes("campaign_criterion.type = 'LOCATION'")) return s.geo.map((g) => ({ campaignCriterion: { location: { geoTargetConstant: `geoTargetConstants/${g}` } } }));
    if (query.includes('from ad_group_ad')) return Array.from({ length: s.anuncios }, () => ({ adGroupAd: { ad: { id: '1' } } }));
    return [];
  });

  const mutarGrafo = vi.fn(async (_cid: string, request: { mutateOperations: Array<Record<string, unknown>> }) => {
    s.escrituras += 1;
    if (s.fallarCreacion) {
      return { ok: false, httpStatus: 400, requestId: 'req-fail', validateOnly: false, operationCount: request.mutateOperations.length, resultsCount: 0, errorStatus: 'INVALID_ARGUMENT', errorCode: 'CampaignError.DUPLICATE_CAMPAIGN_NAME', errorMessage: 'nombre duplicado', googleErrors: [], results: [], partialFailure: false as const };
    }
    s.creaciones += 1;
    // Se «crea» lo que pide la request, tal cual: así la reconciliación compara contra algo real.
    const results: { resourceName: string }[] = [];
    let idGrupo = 100;
    for (const op of request.mutateOperations) {
      if ('campaignBudgetOperation' in op) {
        const c = (op.campaignBudgetOperation as { create: Record<string, unknown> }).create;
        s.campania = { id: '111', nombre: '', estado: 'PAUSED', presupuestoMicros: Number(c.amountMicros) };
        results.push({ resourceName: 'customers/1/campaignBudgets/1' });
      } else if ('campaignOperation' in op) {
        const c = (op.campaignOperation as { create: Record<string, unknown> }).create;
        s.campania = { id: '111', nombre: String(c.name), estado: String(c.status), presupuestoMicros: s.campania?.presupuestoMicros ?? 0 };
        results.push({ resourceName: 'customers/1/campaigns/111' });
      } else if ('adGroupOperation' in op) {
        const c = (op.adGroupOperation as { create: Record<string, unknown> }).create;
        const id = String((idGrupo += 1));
        s.grupos.push({ id, nombre: String(c.name), estado: String(c.status) });
        results.push({ resourceName: `customers/1/adGroups/${id}` });
      } else if ('adGroupAdOperation' in op) {
        s.anuncios += 1;
        results.push({ resourceName: `customers/1/adGroupAds/1~${s.anuncios}` });
      } else if ('adGroupCriterionOperation' in op) {
        const k = ((op.adGroupCriterionOperation as { create: { keyword?: Record<string, unknown> } }).create.keyword) ?? {};
        s.palabras.push({ texto: String(k.text), concordancia: String(k.matchType) });
        results.push({ resourceName: `customers/1/adGroupCriteria/1~${s.palabras.length}` });
      } else if ('campaignCriterionOperation' in op) {
        const c = (op.campaignCriterionOperation as { create: Record<string, unknown> }).create;
        if (c.negative === true) s.negativas.push({ texto: String((c.keyword as { text?: string })?.text ?? '') });
        else if (c.location !== undefined) s.geo.push(String((c.location as { geoTargetConstant?: string }).geoTargetConstant ?? '').replace('geoTargetConstants/', ''));
        results.push({ resourceName: `customers/1/campaignCriteria/1~${results.length}` });
      }
    }
    return { ok: true, httpStatus: 200, requestId: 'req-ok', validateOnly: false, operationCount: request.mutateOperations.length, resultsCount: results.length, errorStatus: null, errorCode: null, errorMessage: null, googleErrors: [], results, partialFailure: false as const };
  });

  const crearAccionDeConversion = vi.fn(async (_cid: string, spec: { nombre: string }) => {
    s.escrituras += 1;
    const id = String(500 + s.conversiones.length);
    s.conversiones.push({ id, nombre: spec.nombre });
    return { resourceName: `customers/1/conversionActions/${id}`, requestId: 'req-conv' };
  });

  return { estado: s, cliente: { buscar, mutarGrafo, crearAccionDeConversion } as never, buscar, mutarGrafo, crearAccionDeConversion };
}

// ── PROVEEDORES DE INVESTIGACIÓN SIMULADOS ──────────────────────────────────────────────────────

const IDEAS: readonly IdeaDeTermino[] = [
  { termino: 'implante dental curico', semilla: null, metricas: { avgMonthlySearches: 320, competition: 'MEDIUM', competitionIndex: 45, lowTopOfPageBidMicros: 800_000_000, highTopOfPageBidMicros: 2_000_000_000 } },
  { termino: 'precio implante dental', semilla: null, metricas: { avgMonthlySearches: 210, competition: 'MEDIUM', competitionIndex: 40, lowTopOfPageBidMicros: 700_000_000, highTopOfPageBidMicros: 1_800_000_000 } },
  { termino: 'trabajo dentista curico', semilla: null, metricas: { avgMonthlySearches: 40, competition: 'LOW', competitionIndex: 10, lowTopOfPageBidMicros: null, highTopOfPageBidMicros: null } },
];

const GEOS: Record<string, GeoTargetResuelto> = {
  'Curicó': { solicitado: 'Curicó', disponible: true, targetId: '1000341', targetTipo: 'CITY', nombreCanonico: 'Curicó, Chile', aproximacion: false, riesgoDerrame: 'NONE' },
};

const pagina = (over: Partial<PaginaObservada>): PaginaObservada => ({
  ruta: '/', httpStatus: 200, titulo: 'Clínica QA Execution', metaDescription: 'dental', h1: ['Clínica QA'], h2: [],
  ctas: ['agendar'], enlacesInternos: 3, canonical: null, indexable: true, tieneDatosEstructurados: true,
  viasDeContacto: ['whatsapp'], ...over,
});

function proveedoresInvestigacion(): (org: string) => Promise<DepsInvestigacion> {
  return async () => ({
    ahora: () => AHORA,
    sitio: {
      nombre: 'sitio-simulado', fuente: 'WEBSITE_AUDIT',
      auditar: async (url: string): Promise<AuditoriaSitio> => ({
        url, alcanzable: true,
        paginas: [pagina({}), pagina({ ruta: '/implantes-dentales', titulo: 'Implantes dentales', h1: ['Implantes dentales'] })],
        paginasVisitadas: 2, paginasOmitidas: 0, error: null, observadoEn: AHORA,
      }),
    },
    geo: {
      nombre: 'geo-simulado', fuente: 'GOOGLE_ADS_GEO_TARGETS',
      resolver: async (nombres: readonly string[]) => nombres.map((n) => GEOS[n] ?? { solicitado: n, disponible: false, targetId: null, targetTipo: null, nombreCanonico: null, aproximacion: false, riesgoDerrame: 'UNKNOWN' as const }),
    },
    demanda: {
      nombre: 'demanda-simulada', fuente: 'GOOGLE_ADS_KEYWORD_DATA',
      demanda: async () => ({ ideas: IDEAS, fuente: 'GOOGLE_ADS_KEYWORD_DATA' as const, observadoEn: AHORA, periodo: 'promedio mensual de los últimos 12 meses' }),
    },
  });
}

// ── APP Y SESIÓN ────────────────────────────────────────────────────────────────────────────────

function app(google: ReturnType<typeof googleSimulado> | null, opciones: { readonly eventosObservados?: number; readonly env?: Record<string, string> } = {}) {
  if (opciones.env) for (const [k, v] of Object.entries(opciones.env)) process.env[k] = v;
  return buildApp({
    store: new InMemoryEventStore(), intelligence: new DeterministicIntelligenceProvider(), pool, legacyDemoAccess: false,
    proveedoresInvestigacion: proveedoresInvestigacion(),
    ejecucionGoogle: async () => (google === null ? null : google.cliente),
    ejecucionObservarEventos: async () => ({ observados: opciones.eventosObservados ?? 3, desde: AHORA }),
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
  const res = await a.inject({ method: 'POST', url: '/negocios', headers: { ...H, cookie }, payload: { displayName: nombre, businessType: 'CLINICA', country: 'CL', currency: 'CLP', timezone: 'America/Santiago' } });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().perfil.organizationId as string;
}

const PASOS = [
  { paso: 'negocio', respuestas: { 'negocio.aQueSeDedica': 'Clínica dental en Curicó', 'negocio.tipo': 'CLINICA', 'negocio.tipoCliente': 'B2C', 'negocio.sitio': 'https://qa-execution.example', 'negocio.pais': 'CL' } },
  { paso: 'oferta', respuestas: { 'oferta.queVendes': 'implantes dentales' } },
  { paso: 'territorio', respuestas: { 'territorio.donde': 'Curicó' } },
  { paso: 'objetivo', respuestas: { 'objetivo.queQuieres': 'nuevos-clientes', 'objetivo.enCuantoTiempo': 30 } },
  { paso: 'contacto', respuestas: { 'contacto.como': ['whatsapp'], 'contacto.principal': 'whatsapp' } },
  { paso: 'medicion', respuestas: { 'medicion.indicador': 'cantidad-contactos', 'medicion.conoceMeta': false, 'medicion.evidencia': 'prudente' } },
  { paso: 'presupuesto', respuestas: { 'presupuesto.modalidad': 'MONTHLY', 'presupuesto.monto': 300_000 } },
  { paso: 'autonomia', respuestas: { 'autonomia.preferencia': 'PEDIR_APROBACION' } },
];

const MATERIAL = {
  // El plan trabaja con el SLUG del servicio, que es como quedó persistido desde el asistente.
  ofertaSlug: 'implantes-dentales',
  titulares: ['Implantes dentales', 'Clínica en Curicó', 'Agenda tu evaluación'],
  descripciones: ['Rehabilitación oral con especialista.', 'Agenda tu hora por WhatsApp hoy mismo.'],
};

async function responder(a: App, cookie: string, org: string, paso: string, respuestas: Record<string, unknown>): Promise<void> {
  const res = await a.inject({ method: 'PATCH', url: '/onboarding', headers: { ...H, cookie, 'x-organization-slug': org }, payload: { paso, respuestas, avanzar: true } });
  expect(res.statusCode, res.body).toBe(200);
}

/** Deja la empresa con conexión, permiso de escritura, plan, material, medición verificada y mandato. */
async function empresaLista(a: App, google: ReturnType<typeof googleSimulado>, email: string, nombre: string, opciones: { readonly capacidadEscritura?: boolean; readonly conMandato?: boolean; readonly restriccionFonasa?: boolean } = {}): Promise<{ cookie: string; org: string }> {
  const cookie = await usuario(a, email);
  const org = await crearEmpresa(a, cookie, nombre);
  for (const p of PASOS) await responder(a, cookie, org, p.paso, p.respuestas);
  if (opciones.restriccionFonasa === true) {
    await responder(a, cookie, org, 'restricciones', { 'restricciones.noPodemosAfirmar': 'no atendemos Fonasa' });
  }

  // Conexión de Google Ads con cuenta declarada + permiso de ESCRITURA (dos decisiones distintas).
  const conexiones = new RepositorioConexiones(pool);
  await conexiones.guardar(pool, {
    organizationId: org, provider: 'GOOGLE_ADS', id: `${org}:GOOGLE_ADS`, estado: 'CONNECTED',
    configuracion: { customerId: '1234567890', loginCustomerId: '1234567890' },
    externalAccountId: '1234567890', loginAccountId: '1234567890', secretRef: null, validadaEn: AHORA,
    ultimoError: null, origen: 'UI',
  });
  await conexiones.fijarCapacidad(pool, { organizationId: org, capacidad: 'MEDICION_REAL', habilitada: true, origen: 'UI', nota: null, actor: 'prueba' });
  if (opciones.capacidadEscritura !== false) {
    await conexiones.fijarCapacidad(pool, { organizationId: org, capacidad: 'ESCRITURA_ADS', habilitada: true, origen: 'UI', nota: 'autorizado en la prueba', actor: 'prueba' });
  }

  // Modo supervisado (la vía gobernada de identidad).
  const modo = await a.inject({ method: 'PATCH', url: `/organizations/${org}/operational-mode`, headers: { ...H, cookie }, payload: { mode: 'SUPERVISED_REAL' } });
  expect([200, 204], modo.body).toContain(modo.statusCode);

  // POSTURA DE GOBIERNO: la dueña autoriza que SOEC opere en sus cuentas y cree campañas. Dos casillas que
  // nacen apagadas; el gasto autónomo NO se puede encender por aquí.
  const g = await a.inject({
    method: 'PATCH', url: `/negocios/${org}/gobierno`, headers: { ...H, cookie, 'x-organization-slug': org },
    payload: { externalMutations: true, campaignExecution: true },
  });
  expect(g.statusCode, g.body).toBe(200);
  expect(g.json().gobierno.autonomousSpend).toBe(false);

  // Investigación y plan.
  expect((await a.inject({ method: 'POST', url: '/investigacion', headers: { ...H, cookie, 'x-organization-slug': org }, payload: {} })).statusCode).toBe(200);
  expect((await a.inject({ method: 'POST', url: '/plan', headers: { ...H, cookie, 'x-organization-slug': org }, payload: {} })).statusCode).toBe(200);

  // Material de anuncios aprobado por la persona.
  expect((await a.inject({ method: 'POST', url: '/campana/material', headers: { ...H, cookie, 'x-organization-slug': org }, payload: MATERIAL })).statusCode).toBe(200);

  // Medición: crear la acción y verificarla contra la señal observada. Preparar la medición ES una escritura
  // externa, así que sin permiso de escritura ni siquiera se intenta (y el requisito lo explicará).
  if (opciones.capacidadEscritura !== false) {
    expect((await a.inject({ method: 'POST', url: '/campana/medicion', headers: { ...H, cookie, 'x-organization-slug': org }, payload: {} })).statusCode).toBe(200);
    expect((await a.inject({ method: 'PATCH', url: '/campana/medicion', headers: { ...H, cookie, 'x-organization-slug': org }, payload: { eventKey: 'whatsapp_intent', accion: 'VERIFICAR' } })).statusCode).toBe(200);
  }

  // Mandato financiero firmado por una persona.
  if (opciones.conMandato !== false) {
    const m = await a.inject({
      method: 'POST', url: '/acquisition/action/mandate', headers: { ...H, cookie, 'x-organization-slug': org },
      payload: { objective: 'captar pacientes', currency: 'CLP', authorizedBudgetMinor: 300_000, periodStart: '2026-09-01T00:00:00.000Z', periodEnd: '2026-12-01T00:00:00.000Z', allowedMetaAssets: [], allowedActionTypes: ['CREATE_CAMPAIGN'] },
    });
    expect(m.statusCode, m.body).toBe(201);
  }
  void google;
  return { cookie, org };
}

type Vista = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const estado = async (a: App, cookie: string, org: string): Promise<Vista> => {
  const r = await a.inject({ method: 'GET', url: '/campana/ejecucion', headers: { cookie, 'x-organization-slug': org } });
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as Vista;
};

const preparar = async (a: App, cookie: string, org: string): Promise<Vista> => {
  const r = await a.inject({ method: 'POST', url: '/campana/ejecucion/preparar', headers: { ...H, cookie, 'x-organization-slug': org }, payload: {} });
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as Vista;
};

const requisito = (v: Vista, id: string): Vista => (v.prerrequisitos as Vista[]).find((r) => r.requisito === id)!;

// ── 1. EL CAMINO COMPLETO ───────────────────────────────────────────────────────────────────────

describe('Empresa QA Execution · del plan a una campaña real EN PAUSA', () => {
  it('prepara, autoriza, crea y verifica — y la campaña queda pausada, sin gasto', async () => {
    const google = googleSimulado();
    const a = app(google);
    const { cookie, org } = await empresaLista(a, google, 'duena-exec@soec.cl', 'Empresa QA Execution');

    // 1) Todos los requisitos en regla.
    const v0 = await preparar(a, cookie, org);
    expect(v0.puedeEjecutar, JSON.stringify((v0.prerrequisitos as Vista[]).filter((r) => r.veredicto !== 'PASS'))).toBe(true);
    expect((v0.prerrequisitos as Vista[])).toHaveLength(12);
    expect(v0.peticion.estado).toBe('READY');

    // 2) EL RESUMEN QUE APRUEBA LA PERSONA: comercial, sin JSON ni enums.
    const r = v0.resumen as Vista;
    expect(r.aviso).toBe('La campaña se creará pausada y no generará gasto.');
    expect(r.cuenta).toBe('1234567890');
    expect(r.presupuestoDiario).toContain('al día');
    expect(r.ubicaciones).toContain('Curicó');
    expect((r.grupos as Vista[])[0]!.titulares).toEqual(MATERIAL.titulares);
    expect(JSON.stringify(r)).not.toContain('resourceName');
    expect(JSON.stringify(r)).not.toContain('MAXIMIZE_CLICKS');

    // 3) Sin aprobación humana NO se ejecuta.
    const sinAprobar = await a.inject({ method: 'POST', url: `/campana/ejecucion/${v0.peticion.id}/ejecutar`, headers: { ...H, cookie, 'x-organization-slug': org }, payload: {} });
    expect(sinAprobar.statusCode).toBe(400);
    expect(google.mutarGrafo).not.toHaveBeenCalled();

    // 4) Aprobación humana explícita: queda firmada.
    const autorizada = await a.inject({ method: 'POST', url: `/campana/ejecucion/${v0.peticion.id}/autorizar`, headers: { ...H, cookie, 'x-organization-slug': org }, payload: {} });
    expect(autorizada.statusCode, autorizada.body).toBe(200);
    const auth = autorizada.json().peticion.autorizacion as Vista;
    // El actor es la identidad autenticada (id de usuario), nunca el sistema.
    expect(String(auth.actor).length).toBeGreaterThan(10);
    expect(['soec', 'director', 'sistema']).not.toContain(String(auth.actor));
    expect(auth.accion).toBe('CREAR_CAMPANA_EN_PAUSA');
    expect(auth.mandatoId).toBeTruthy();
    expect(auth.modoOperativo).toBe('SUPERVISED_REAL');

    // 5) EJECUCIÓN: una sola escritura atómica.
    const ejecutada = await a.inject({ method: 'POST', url: `/campana/ejecucion/${v0.peticion.id}/ejecutar`, headers: { ...H, cookie, 'x-organization-slug': org }, payload: {} });
    expect(ejecutada.statusCode, ejecutada.body).toBe(200);
    const vista = ejecutada.json() as Vista;
    expect(vista.peticion.estado).toBe('CREATED_PAUSED');
    expect(google.mutarGrafo).toHaveBeenCalledTimes(1);

    // 6) LA CAMPAÑA EXISTE Y ESTÁ EN PAUSA (igual que sus grupos).
    expect(google.estado.campania?.estado).toBe('PAUSED');
    expect(google.estado.grupos.every((g) => g.estado === 'PAUSED')).toBe(true);
    expect(google.estado.palabras.map((k) => k.texto)).toEqual(expect.arrayContaining(['implante dental curico']));
    expect(google.estado.negativas.map((n) => n.texto)).toContain('trabajo dentista curico');
    expect(google.estado.geo).toEqual(['1000341']);
    expect(google.estado.anuncios).toBe(1);
    // El presupuesto materializado respeta el mandato (300.000 en 91 días ⇒ 3.296/día).
    expect(google.estado.campania!.presupuestoMicros).toBeLessThanOrEqual(300_000 * 1_000_000);

    // 7) RECONCILIACIÓN: se verificó contra la plataforma.
    expect(vista.peticion.reconciliacion.coincide).toBe(true);
    const { rows: reconciliaciones } = await pool.query('select count(*)::int as n from execution_reconciliation where organization_id = $1', [org]);
    expect(reconciliaciones[0].n).toBeGreaterThan(0);

    // 8) LIBRO DE EJECUCIÓN con identificadores externos y sin secretos.
    const libro = await a.inject({ method: 'GET', url: `/campana/ejecucion/${v0.peticion.id}/libro`, headers: { cookie, 'x-organization-slug': org } });
    const pasos = libro.json().pasos as Vista[];
    expect(pasos.map((p) => p.paso)).toEqual(expect.arrayContaining(['VERIFY_REMOTE_STATE', 'BUDGET_CREATE', 'CAMPAIGN_CREATE', 'AD_GROUP_CREATE', 'KEYWORD_CREATE', 'NEGATIVE_CREATE']));
    expect(JSON.stringify(pasos)).not.toMatch(/token|secret|password/i);

    // 9) AUDITORÍA: quién autorizó y qué se creó.
    const { rows: auditoria } = await pool.query("select action from business_audit where organization_id = $1 and action like 'CAMPAIGN%' order by id", [org]);
    const acciones = auditoria.map((x: { action: string }) => x.action);
    expect(acciones).toEqual(expect.arrayContaining(['CAMPAIGN_CREATIVE_APPROVED', 'CAMPAIGN_EXECUTION_PREPARED', 'CAMPAIGN_EXECUTION_AUTHORIZED', 'CAMPAIGN_CREATED_PAUSED']));

    // 10) NINGUNA campaña encendida, ningún gasto autorizado por SOEC.
    expect(google.estado.campania?.estado).not.toBe('ENABLED');
    const gobierno = await new RepositorioNegocios(pool).gobierno(org);
    expect(gobierno).toEqual(expect.objectContaining({ autonomousSpend: false }));
    await a.close();
  });

  it('REINTENTAR no crea una segunda campaña', async () => {
    const google = googleSimulado();
    const a = app(google);
    const { cookie, org } = await empresaLista(a, google, 'duena-retry@soec.cl', 'Empresa QA Execution Retry');
    const v = await preparar(a, cookie, org);
    const h = { ...H, cookie, 'x-organization-slug': org };
    await a.inject({ method: 'POST', url: `/campana/ejecucion/${v.peticion.id}/autorizar`, headers: h, payload: {} });
    await a.inject({ method: 'POST', url: `/campana/ejecucion/${v.peticion.id}/ejecutar`, headers: h, payload: {} });
    expect(google.estado.creaciones).toBe(1);

    // Segunda ejecución de la MISMA petición: no toca la plataforma.
    const otra = await a.inject({ method: 'POST', url: `/campana/ejecucion/${v.peticion.id}/ejecutar`, headers: h, payload: {} });
    expect(otra.statusCode).toBe(200);
    expect(google.estado.creaciones).toBe(1);

    // Y preparar otra vez REUTILIZA la petición: el mismo paquete no genera dos.
    const repetida = await preparar(a, cookie, org);
    expect(repetida.peticion.id).toBe(v.peticion.id);
    const { rows } = await pool.query('select count(*)::int as n from campaign_execution_request where organization_id = $1', [org]);
    expect(rows[0].n).toBe(1);
    await a.close();
  });

  it('si el proceso se cae tras crear en Google, el reintento ADOPTA en lugar de duplicar', async () => {
    const google = googleSimulado();
    const a = app(google);
    const { cookie, org } = await empresaLista(a, google, 'duena-resume@soec.cl', 'Empresa QA Execution Resume');
    const v = await preparar(a, cookie, org);
    const h = { ...H, cookie, 'x-organization-slug': org };
    await a.inject({ method: 'POST', url: `/campana/ejecucion/${v.peticion.id}/autorizar`, headers: h, payload: {} });
    await a.inject({ method: 'POST', url: `/campana/ejecucion/${v.peticion.id}/ejecutar`, headers: h, payload: {} });
    expect(google.estado.creaciones).toBe(1);

    // Se simula la caída: la petición vuelve a EXECUTING y se borra su libro, pero Google YA tiene la campaña.
    await pool.query("update campaign_execution_request set estado = 'EXECUTING', reconciliacion = null where organization_id = $1", [org]);
    await pool.query('delete from campaign_execution_step where organization_id = $1', [org]);

    const reanudada = await a.inject({ method: 'POST', url: `/campana/ejecucion/${v.peticion.id}/ejecutar`, headers: h, payload: {} });
    expect(reanudada.statusCode, reanudada.body).toBe(200);
    expect(google.estado.creaciones).toBe(1); // NO se creó una segunda
    const vista = reanudada.json() as Vista;
    expect(vista.peticion.estado).toBe('CREATED_PAUSED');
    const pasos = await new RepositorioEjecucion(pool).pasos(org, v.peticion.id as string);
    expect(pasos.find((p) => p.paso === 'CAMPAIGN_CREATE')?.resultado).toBe('SKIPPED_IDEMPOTENT');
    await a.close();
  });

  it('si la plataforma rechaza la creación, no queda nada a medias y se dice por qué', async () => {
    const google = googleSimulado({ fallarCreacion: true });
    const a = app(google);
    const { cookie, org } = await empresaLista(a, google, 'duena-fallo@soec.cl', 'Empresa QA Execution Fallo');
    const v = await preparar(a, cookie, org);
    const h = { ...H, cookie, 'x-organization-slug': org };
    await a.inject({ method: 'POST', url: `/campana/ejecucion/${v.peticion.id}/autorizar`, headers: h, payload: {} });
    const r = await a.inject({ method: 'POST', url: `/campana/ejecucion/${v.peticion.id}/ejecutar`, headers: h, payload: {} });
    expect(r.statusCode).toBe(200);
    const vista = r.json() as Vista;
    expect(vista.peticion.estado).toBe('FAILED');
    expect(String(vista.peticion.motivo)).toContain('DUPLICATE_CAMPAIGN_NAME');
    expect(google.estado.campania).toBeNull();
    await a.close();
  });
});

// ── 2. LAS FORMAS DE NO CREARLA ─────────────────────────────────────────────────────────────────

describe('puertas de seguridad', () => {
  it('sin permiso de ESCRITURA no se crea nada, aunque la cuenta esté conectada', async () => {
    const google = googleSimulado();
    const a = app(google);
    const { cookie, org } = await empresaLista(a, google, 'duena-sinpermiso@soec.cl', 'Empresa QA Sin Permiso', { capacidadEscritura: false });
    const v = await preparar(a, cookie, org);
    expect(v.puedeEjecutar).toBe(false);
    expect(requisito(v, 'WRITE_CAPABILITY_ENABLED').veredicto).toBe('ACTION_REQUIRED');
    expect(v.peticion.estado).toBe('BLOCKED');
    const r = await a.inject({ method: 'POST', url: `/campana/ejecucion/${v.peticion.id}/autorizar`, headers: { ...H, cookie, 'x-organization-slug': org }, payload: {} });
    expect(r.statusCode).toBe(409);
    expect(google.mutarGrafo).not.toHaveBeenCalled();
    await a.close();
  });

  it('sin mandato financiero no se ejecuta, aunque la campaña vaya a nacer pausada', async () => {
    const google = googleSimulado();
    const a = app(google);
    const { cookie, org } = await empresaLista(a, google, 'duena-sinmandato@soec.cl', 'Empresa QA Sin Mandato', { conMandato: false });
    const v = await preparar(a, cookie, org);
    expect(requisito(v, 'FINANCIAL_MANDATE_VALID').veredicto).toBe('ACTION_REQUIRED');
    expect(v.puedeEjecutar).toBe(false);
    expect(v.resumen).toBeNull(); // sin mandato ni siquiera se congela un paquete
    await a.close();
  });

  it('con el mandato vencido se bloquea', async () => {
    const google = googleSimulado();
    const a = app(google);
    const { cookie, org } = await empresaLista(a, google, 'duena-vencido@soec.cl', 'Empresa QA Mandato Vencido');
    await preparar(a, cookie, org);
    await pool.query("update accion_mandato set period_end = '2026-09-02T00:00:00.000Z' where organization_id = $1", [org]);
    const v = await estado(a, cookie, org);
    expect(requisito(v, 'FINANCIAL_MANDATE_VALID').veredicto).toBe('ACTION_REQUIRED');
    expect(v.puedeEjecutar).toBe(false);
    await a.close();
  });

  it('un texto que contradice lo declarado bloquea ANTES de crear nada', async () => {
    const google = googleSimulado();
    const a = app(google);
    const { cookie, org } = await empresaLista(a, google, 'duena-claim@soec.cl', 'Empresa QA Claim', { restriccionFonasa: true });
    const h = { ...H, cookie, 'x-organization-slug': org };
    await a.inject({ method: 'POST', url: '/campana/material', headers: h, payload: { ...MATERIAL, titulares: ['Implantes con Fonasa', 'Clínica en Curicó', 'Agenda hoy'] } });
    const v = await preparar(a, cookie, org);
    expect(requisito(v, 'CREATIVE_READY').veredicto).toBe('BLOCKED');
    expect((v.claims as Vista).ok).toBe(false);
    const r = await a.inject({ method: 'POST', url: `/campana/ejecucion/${v.peticion.id}/autorizar`, headers: h, payload: {} });
    expect(r.statusCode).toBe(409);
    expect(google.mutarGrafo).not.toHaveBeenCalled();
    await a.close();
  });

  it('una acción de conversión creada pero SIN verificar no habilita la ejecución', async () => {
    const google = googleSimulado();
    const a = app(google, { eventosObservados: 0 }); // no llega ninguna señal
    const { cookie, org } = await empresaLista(a, google, 'duena-sinsenal@soec.cl', 'Empresa QA Sin Señal');
    const v = await preparar(a, cookie, org);
    expect(requisito(v, 'CONVERSION_READY').veredicto).toBe('ACTION_REQUIRED');
    expect(v.puedeEjecutar).toBe(false);
    // La acción SÍ existe en la plataforma: es la medición la que falta.
    expect(google.estado.conversiones).toHaveLength(1);
    expect((v.medicion as Vista[])[0]!.estado).toBe('TRACKING_MISSING');
    expect((v.medicion as Vista[])[0]!.instrucciones[0].fragmento).toContain('gtag');
    await a.close();
  });

  it('un plan que quedó viejo bloquea la ejecución ya autorizada', async () => {
    const google = googleSimulado();
    const a = app(google);
    const { cookie, org } = await empresaLista(a, google, 'duena-stale@soec.cl', 'Empresa QA Stale');
    const v = await preparar(a, cookie, org);
    const h = { ...H, cookie, 'x-organization-slug': org };
    await a.inject({ method: 'POST', url: `/campana/ejecucion/${v.peticion.id}/autorizar`, headers: h, payload: {} });
    // El dueño cambia el territorio: la investigación y el plan envejecen.
    await responder(a, cookie, org, 'territorio', { 'territorio.donde': 'Curicó y Molina' });
    const r = await a.inject({ method: 'POST', url: `/campana/ejecucion/${v.peticion.id}/ejecutar`, headers: h, payload: {} });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe('EJECUCION_BLOQUEADA');
    expect(google.mutarGrafo).not.toHaveBeenCalled();
    await a.close();
  });

  it('con el interruptor de seguridad cerrado no se toca la plataforma', async () => {
    const google = googleSimulado();
    const a = app(google);
    const { cookie, org } = await empresaLista(a, google, 'duena-killswitch@soec.cl', 'Empresa QA Kill Switch');
    // El operador del despliegue cierra el interruptor: da igual lo que diga la empresa.
    process.env.SOEC_EXTERNAL_MUTATIONS = 'off';
    try {
      const v = await preparar(a, cookie, org);
      expect(requisito(v, 'KILL_SWITCH_ALLOWED').veredicto).toBe('BLOCKED');
      expect(v.puedeEjecutar).toBe(false);
      await a.close();
    } finally {
      delete process.env.SOEC_EXTERNAL_MUTATIONS;
    }
  });
});

// ── 3. AISLAMIENTO ──────────────────────────────────────────────────────────────────────────────

describe('aislamiento entre empresas', () => {
  it('una empresa no prepara, no autoriza y no ejecuta la campaña de otra', async () => {
    const google = googleSimulado();
    const a = app(google);
    const { cookie: cookieA, org: orgA } = await empresaLista(a, google, 'duena-iso-a@soec.cl', 'Empresa QA Exec A');
    const v = await preparar(a, cookieA, orgA);

    const cookieB = await usuario(a, 'dueno-iso-b@soec.cl');
    await crearEmpresa(a, cookieB, 'Empresa QA Exec B');
    const hB = { ...H, cookie: cookieB, 'x-organization-slug': orgA };
    for (const url of ['/campana/ejecucion', '/campana/ejecucion/preparar', `/campana/ejecucion/${v.peticion.id}/autorizar`, `/campana/ejecucion/${v.peticion.id}/ejecutar`]) {
      const r = await a.inject({ method: url === '/campana/ejecucion' ? 'GET' : 'POST', url, headers: hB, payload: {} });
      expect([403, 404], `${url} → ${r.statusCode}`).toContain(r.statusCode);
    }
    expect(google.mutarGrafo).not.toHaveBeenCalled();
    const { rows } = await pool.query('select count(*)::int as n from campaign_execution_request where organization_id <> $1', [orgA]);
    expect(rows[0].n).toBe(0);
    await a.close();
  });
});
