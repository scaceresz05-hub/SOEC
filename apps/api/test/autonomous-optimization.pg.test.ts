/**
 * Autonomy Fase G · OPTIMIZACIÓN AUTÓNOMA — aceptación sobre PostgreSQL REAL.
 *
 * «Empresa QA Optimizer» recorre el ciclo completo por las mismas APIs que usa la interfaz, con un Google
 * simulado y determinista: observar → evaluar → decidir → gobernar → ejecutar → verificar → aprender.
 *
 * Y demuestra las siete formas de no tocar nada: poca evidencia, medición enferma, sin permiso, fuera del
 * mandato, en modo sombra, en modo observación y al reintentar lo ya aplicado. Más las tres reglas de
 * activación: encender exige aprobación humana, o un permiso automático EXPLÍCITO, y siempre mandato vigente.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@soec/event-store/pg';
import { identityMigrations } from '@soec/identity/pg';
import { InMemoryEventStore } from '@soec/event-store';
import { DeterministicIntelligenceProvider } from '@soec/intelligence';
import { makeTestPool, ejecutarDestructivoDePrueba } from '@soec/event-store/test-db';
import { buildApp } from '../src/app';
import { negocioMigrations } from '../src/negocio/negocio-pg';
import { conexionMigrations, RepositorioConexiones } from '../src/conexion/conexion-pg';
import { politicaMigrations } from '../src/politica/politica-pg';
import { onboardingMigrations } from '../src/onboarding/onboarding-pg';
import { investigacionMigrations } from '../src/investigacion/investigacion-pg';
import { planMigrations } from '../src/investigacion/plan-pg';
import { ejecucionMigrations } from '../src/ejecucion/ejecucion-pg';
import { accionMigrations } from '../src/accion/accion-pg';
import { optimizacionMigrations } from '../src/optimizacion/optimizacion-pg';
import type { DepsInvestigacion } from '../src/investigacion/investigacion-service';
import type { AuditoriaSitio, GeoTargetResuelto, IdeaDeTermino, PaginaObservada } from '../src/investigacion/proveedores';
import { restablecerNegociosDelRuntime } from '../src/plataforma';

const H = { 'content-type': 'application/json' };
const pool = makeTestPool();
/**
 * TIEMPO DEL FIXTURE. Ninguna fecha de esta prueba se escribe a mano: todas se derivan del reloj real, de modo
 * que el mundo simulado guarda siempre la MISMA DISTANCIA con «ahora». Antes no: las métricas decían «hasta el
 * 21 de septiembre de 2026» y, al cruzar la medianoche UTC, esos datos pasaron a tener 49 horas y la evidencia
 * cayó a `STALE`. Un test cuyo veredicto depende del día en que se ejecuta no prueba nada.
 *
 * No se toca la regla productiva —48 h de antigüedad máxima—: se arregla el fixture, que era el que mentía.
 * Tampoco se congela el reloj del dominio: se probó, y un «ahora» en el pasado discrepa de las filas que
 * PostgreSQL sella con `now()`, lo que rompía la detección de cambios recientes. La distancia constante es la
 * única forma de que ambas mitades del mundo cuenten la misma historia.
 */
const DIA_MS = 86_400_000;
const iso = (ms: number): string => new Date(ms).toISOString();
const AHORA_MS = Date.now();
/** «Ahora» del mundo observado (investigación, auditoría de sitio, demanda). */
const AHORA = iso(AHORA_MS);
/**
 * Día de las métricas de la plataforma: el mismo que la ventana de observación toma como cierre (ayer; los
 * datos de hoy todavía se consolidan). Se calcula en CADA consulta para que cruzar la medianoche a mitad del
 * suite no cambie el veredicto.
 */
const fechaDeMetricas = (): string => iso(Date.now() - DIA_MS).slice(0, 10);
/** Mandato vigente: empezó la semana pasada y termina en dos meses, siempre relativo a hoy. */
const MANDATO_DESDE = iso(AHORA_MS - 7 * DIA_MS);
const MANDATO_HASTA = iso(AHORA_MS + 60 * DIA_MS);
/** Mandato ya vencido, para probar el rechazo por fuera de ventana. */
const MANDATO_VENCIDO = iso(AHORA_MS - DIA_MS);

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
  await runMigrations(pool, optimizacionMigrations);
  await ejecutarDestructivoDePrueba(pool, 'truncate learning_outcome, optimization_action_log, pending_marketing_action, optimization_decision, observation_snapshot, optimization_cycle, autonomy_policy, execution_reconciliation, creative_asset, tracking_state, conversion_action_mapping, campaign_execution_step, campaign_execution_request, accion_ledger, accion_mandato, campaign_plan_group, campaign_plan, research_competitor, research_landing, research_channel, research_geo_target, research_keyword, research_finding, research_evidence, research_run, business_budget_intent, business_website_insight, business_onboarding_answer, business_onboarding, business_channel_rule, business_autonomy_limits, business_evaluation_rule, business_conversion_event, business_kpi, business_evaluation_policy, business_connection_ciphertext, business_capability, business_connection, business_audit, business_restriction, business_geo_scope, business_offering, business_objective, business_governance, business_profile restart identity cascade');
  await ejecutarDestructivoDePrueba(pool, 'truncate identity_password_resets, identity_audit_events, identity_invitations, identity_sessions, identity_memberships, identity_organizations, identity_users cascade');
  restablecerNegociosDelRuntime();
});
afterAll(async () => {
  restablecerNegociosDelRuntime();
  await pool.end();
});

// ── GOOGLE SIMULADO, con métricas ───────────────────────────────────────────────────────────────

interface Metricas { costMicros: number; impressions: number; clicks: number; conversions: number }

interface MundoGoogle {
  campania: { id: string; nombre: string; estado: string; presupuestoMicros: number; estrategia: string };
  metricas: Metricas;
  grupos: { id: string; nombre: string; estado: string }[];
  palabras: { criterionId: string; adGroupId: string; texto: string; estado: string; metricas: Metricas }[];
  terminos: { termino: string; metricas: Metricas }[];
  negativas: string[];
  conversiones: { id: string; nombre: string }[];
  escrituras: number;
}

function googleSimulado(over: Partial<MundoGoogle> = {}) {
  const w: MundoGoogle = {
    campania: { id: '111', nombre: '', estado: 'PAUSED', presupuestoMicros: 10_000_000_000, estrategia: 'TARGET_SPEND' },
    metricas: { costMicros: 0, impressions: 0, clicks: 0, conversions: 0 },
    grupos: [], palabras: [], terminos: [], negativas: [], conversiones: [], escrituras: 0, ...over,
  };
  const met = (m: Metricas) => ({ costMicros: String(m.costMicros), impressions: String(m.impressions), clicks: String(m.clicks), conversions: m.conversions });

  const buscar = vi.fn(async (_cid: string, consulta: string) => {
    // El motor escribe GAQL con mayúsculas o minúsculas según el módulo: el simulado no puede ser quisquilloso.
    const q = consulta.toLowerCase();
    if (q.includes('from conversion_action')) {
      const m = /conversion_action.name = '([^']+)'/.exec(consulta);
      const c = w.conversiones.find((x) => x.nombre === m?.[1]);
      return c === undefined ? [] : [{ conversionAction: { id: c.id, name: c.nombre, resourceName: `customers/1/conversionActions/${c.id}`, status: 'ENABLED', tagSnippets: [{ eventSnippet: `send_to: 'AW-1/${c.id}'` }] } }];
    }
    if (q.includes('from keyword_view') || q.includes('from ad_group_criterion')) {
      const t = /ad_group_criterion\.keyword\.text = '([^']+)'/.exec(consulta);
      const fuente = t === null ? w.palabras : w.palabras.filter((k) => k.texto === t[1]);
      return fuente.map((k) => ({
        adGroup: { id: k.adGroupId },
        adGroupCriterion: { criterionId: k.criterionId, keyword: { text: k.texto, matchType: 'PHRASE' }, status: k.estado, cpcBidMicros: '2000000000' },
        metrics: met(k.metricas),
      }));
    }
    if (q.includes('from search_term_view')) {
      return w.terminos.map((t) => ({ searchTermView: { searchTerm: t.termino }, segments: { keyword: { info: { text: 'implante dental' } } }, metrics: met(t.metricas) }));
    }
    if (q.includes('from ad_group ')) return w.grupos.map((gr) => ({ adGroup: { id: gr.id, name: gr.nombre, status: gr.estado }, metrics: met(w.metricas) }));
    if (q.includes('from ad_group_ad')) return w.grupos.flatMap(() => [{ adGroupAd: { ad: { id: '333' }, status: 'ENABLED' }, metrics: met(w.metricas) }]);
    if (q.includes('bidding_strategy_type')) return [{ campaign: { biddingStrategyType: w.campania.estrategia } }];
    if (q.includes('from campaign ')) {
      // La campaña no EXISTE hasta que alguien la crea: una búsqueda por nombre no puede encontrar un fantasma.
      const porNombre = /campaign\.name = '([^']+)'/.exec(consulta);
      if (porNombre !== null && w.campania.nombre !== porNombre[1]) return [];
      if (w.campania.nombre === '' && porNombre === null && !q.includes('metrics.')) return [];
      const base = { campaign: { id: w.campania.id, name: w.campania.nombre, status: w.campania.estado, advertisingChannelType: 'SEARCH' }, campaignBudget: { resourceName: 'customers/1/campaignBudgets/1', amountMicros: String(w.campania.presupuestoMicros) } };
      return q.includes('metrics.') ? [{ ...base, metrics: met(w.metricas), segments: { date: fechaDeMetricas() } }] : [base];
    }
    if (q.includes('from campaign_criterion')) {
      if (q.includes("type = 'location'")) return [{ campaignCriterion: { location: { geoTargetConstant: 'geoTargetConstants/1000341' } } }];
      return w.negativas.map((t) => ({ campaignCriterion: { keyword: { text: t } } }));
    }
    return [];
  });

  const mutarGrafo = vi.fn(async (_cid: string, request: { mutateOperations: Array<Record<string, unknown>> }) => {
    w.escrituras += 1;
    const results: { resourceName: string }[] = [];
    for (const op of request.mutateOperations) {
      if ('campaignBudgetOperation' in op) {
        const o = op.campaignBudgetOperation as { create?: Record<string, unknown>; update?: Record<string, unknown> };
        if (o.create) w.campania.presupuestoMicros = Number(o.create.amountMicros);
        if (o.update) w.campania.presupuestoMicros = Number(o.update.amountMicros);
        results.push({ resourceName: 'customers/1/campaignBudgets/1' });
      } else if ('campaignOperation' in op) {
        const o = op.campaignOperation as { create?: Record<string, unknown>; update?: Record<string, unknown> };
        if (o.create) w.campania = { ...w.campania, nombre: String(o.create.name), estado: String(o.create.status) };
        if (o.update?.status) w.campania.estado = String(o.update.status);
        results.push({ resourceName: 'customers/1/campaigns/111' });
      } else if ('adGroupOperation' in op) {
        const o = op.adGroupOperation as { create?: Record<string, unknown> };
        if (o.create) w.grupos.push({ id: '222', nombre: String(o.create.name), estado: String(o.create.status) });
        results.push({ resourceName: 'customers/1/adGroups/222' });
      } else if ('adGroupAdOperation' in op) {
        results.push({ resourceName: 'customers/1/adGroupAds/222~1' });
      } else if ('adGroupCriterionOperation' in op) {
        const o = op.adGroupCriterionOperation as { create?: { keyword?: { text?: string } }; update?: { resourceName?: string; status?: string } };
        if (o.create?.keyword?.text) w.palabras.push({ criterionId: `c${w.palabras.length + 1}`, adGroupId: '222', texto: o.create.keyword.text, estado: 'ENABLED', metricas: { costMicros: 0, impressions: 0, clicks: 0, conversions: 0 } });
        if (o.update?.resourceName) {
          const id = o.update.resourceName.split('/').pop()?.split('~')[1];
          const k = w.palabras.find((x) => x.criterionId === id);
          if (k && o.update.status) k.estado = o.update.status;
        }
        results.push({ resourceName: 'customers/1/adGroupCriteria/222~1' });
      } else if ('campaignCriterionOperation' in op) {
        const o = op.campaignCriterionOperation as { create?: { negative?: boolean; keyword?: { text?: string } } };
        if (o.create?.negative === true && o.create.keyword?.text) w.negativas.push(o.create.keyword.text);
        results.push({ resourceName: 'customers/1/campaignCriteria/111~1' });
      }
    }
    return { ok: true, httpStatus: 200, requestId: 'req-ok', validateOnly: false, operationCount: request.mutateOperations.length, resultsCount: results.length, errorStatus: null, errorCode: null, errorMessage: null, googleErrors: [], results, partialFailure: false as const };
  });

  const crearAccionDeConversion = vi.fn(async (_cid: string, spec: { nombre: string }) => {
    const id = String(500 + w.conversiones.length);
    w.conversiones.push({ id, nombre: spec.nombre });
    return { resourceName: `customers/1/conversionActions/${id}`, requestId: 'req-conv' };
  });

  return { mundo: w, cliente: { buscar, mutarGrafo, crearAccionDeConversion } as never, buscar, mutarGrafo };
}

// ── INVESTIGACIÓN SIMULADA (para llegar a tener una campaña) ────────────────────────────────────

const IDEAS: readonly IdeaDeTermino[] = [
  { termino: 'implante dental curico', semilla: null, metricas: { avgMonthlySearches: 320, competition: 'MEDIUM', competitionIndex: 45, lowTopOfPageBidMicros: 800_000_000, highTopOfPageBidMicros: 2_000_000_000 } },
  { termino: 'precio implante dental', semilla: null, metricas: { avgMonthlySearches: 210, competition: 'MEDIUM', competitionIndex: 40, lowTopOfPageBidMicros: 700_000_000, highTopOfPageBidMicros: 1_800_000_000 } },
];
const GEOS: Record<string, GeoTargetResuelto> = {
  'Curicó': { solicitado: 'Curicó', disponible: true, targetId: '1000341', targetTipo: 'CITY', nombreCanonico: 'Curicó, Chile', aproximacion: false, riesgoDerrame: 'NONE' },
};
const pagina = (over: Partial<PaginaObservada>): PaginaObservada => ({
  ruta: '/', httpStatus: 200, titulo: 'Clínica QA', metaDescription: 'dental', h1: ['Clínica QA'], h2: [],
  ctas: ['agendar'], enlacesInternos: 3, canonical: null, indexable: true, tieneDatosEstructurados: true,
  viasDeContacto: ['whatsapp'], ...over,
});

const proveedores = (): ((org: string) => Promise<DepsInvestigacion>) => async () => ({
  ahora: () => AHORA,
  sitio: {
    nombre: 's', fuente: 'WEBSITE_AUDIT',
    auditar: async (url: string): Promise<AuditoriaSitio> => ({
      url, alcanzable: true,
      paginas: [pagina({}), pagina({ ruta: '/implantes-dentales', titulo: 'Implantes dentales', h1: ['Implantes dentales'] })],
      paginasVisitadas: 2, paginasOmitidas: 0, error: null, observadoEn: AHORA,
    }),
  },
  geo: {
    nombre: 'g', fuente: 'GOOGLE_ADS_GEO_TARGETS',
    resolver: async (nombres: readonly string[]) => nombres.map((n) => GEOS[n] ?? { solicitado: n, disponible: false, targetId: null, targetTipo: null, nombreCanonico: null, aproximacion: false, riesgoDerrame: 'UNKNOWN' as const }),
  },
  demanda: {
    nombre: 'd', fuente: 'GOOGLE_ADS_KEYWORD_DATA',
    demanda: async () => ({ ideas: IDEAS, fuente: 'GOOGLE_ADS_KEYWORD_DATA' as const, observadoEn: AHORA, periodo: '12 meses' }),
  },
});

// ── APP Y SETUP ─────────────────────────────────────────────────────────────────────────────────

function app(google: ReturnType<typeof googleSimulado>, opciones: { readonly eventosObservados?: number } = {}) {
  return buildApp({
    store: new InMemoryEventStore(), intelligence: new DeterministicIntelligenceProvider(), pool, legacyDemoAccess: false,
    proveedoresInvestigacion: proveedores(),
    ejecucionGoogle: async () => google.cliente,
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
  const r = await a.inject({ method: 'POST', url: '/negocios', headers: { ...H, cookie }, payload: { displayName: nombre, businessType: 'CLINICA', country: 'CL', currency: 'CLP', timezone: 'America/Santiago' } });
  expect(r.statusCode, r.body).toBe(201);
  return r.json().perfil.organizationId as string;
}

const PASOS = [
  { paso: 'negocio', respuestas: { 'negocio.aQueSeDedica': 'Clínica dental en Curicó', 'negocio.tipo': 'CLINICA', 'negocio.tipoCliente': 'B2C', 'negocio.sitio': 'https://qa-optimizer.example', 'negocio.pais': 'CL' } },
  { paso: 'oferta', respuestas: { 'oferta.queVendes': 'implantes dentales' } },
  { paso: 'territorio', respuestas: { 'territorio.donde': 'Curicó' } },
  { paso: 'objetivo', respuestas: { 'objetivo.queQuieres': 'nuevos-clientes', 'objetivo.enCuantoTiempo': 30 } },
  { paso: 'contacto', respuestas: { 'contacto.como': ['whatsapp'], 'contacto.principal': 'whatsapp' } },
  { paso: 'medicion', respuestas: { 'medicion.indicador': 'cantidad-contactos', 'medicion.conoceMeta': false, 'medicion.evidencia': 'prudente' } },
  { paso: 'presupuesto', respuestas: { 'presupuesto.modalidad': 'MONTHLY', 'presupuesto.monto': 300_000 } },
];
const MATERIAL = {
  ofertaSlug: 'implantes-dentales',
  titulares: ['Implantes dentales', 'Clínica en Curicó', 'Agenda tu evaluación'],
  descripciones: ['Rehabilitación oral con especialista.', 'Agenda tu hora por WhatsApp hoy mismo.'],
};

type Vista = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Deja la empresa con campaña creada EN PAUSA, medición verificada y mandato vigente. */
async function empresaConCampania(a: App, email: string, nombre: string, opciones: { readonly modo?: string; readonly mandato?: boolean } = {}): Promise<{ cookie: string; org: string }> {
  const cookie = await usuario(a, email);
  const org = await crearEmpresa(a, cookie, nombre);
  const h = { ...H, cookie, 'x-organization-slug': org };
  for (const p of PASOS) {
    const r = await a.inject({ method: 'PATCH', url: '/onboarding', headers: h, payload: { paso: p.paso, respuestas: p.respuestas, avanzar: true } });
    expect(r.statusCode, r.body).toBe(200);
  }
  const conexiones = new RepositorioConexiones(pool);
  await conexiones.guardar(pool, {
    organizationId: org, provider: 'GOOGLE_ADS', id: `${org}:GOOGLE_ADS`, estado: 'CONNECTED',
    configuracion: { customerId: '1234567890', loginCustomerId: '1234567890' }, externalAccountId: '1234567890',
    loginAccountId: '1234567890', secretRef: null, validadaEn: AHORA, ultimoError: null, origen: 'UI',
  });
  await conexiones.fijarCapacidad(pool, { organizationId: org, capacidad: 'ESCRITURA_ADS', habilitada: true, origen: 'UI', nota: null, actor: 'prueba' });
  await a.inject({ method: 'PATCH', url: `/organizations/${org}/operational-mode`, headers: { ...H, cookie }, payload: { mode: 'SUPERVISED_REAL' } });
  await a.inject({ method: 'PATCH', url: `/negocios/${org}/gobierno`, headers: h, payload: { externalMutations: true, campaignExecution: true } });
  // CRITERIOS DE LA EMPRESA (Fase C): cuánto gasto sin resultados tolera y qué costo por resultado acepta.
  // Sin estos umbrales declarados, el optimizador no tiene con qué decidir — y no se los inventa.
  const pol = await a.inject({
    method: 'PATCH', url: '/politica', headers: h,
    payload: {
      reglas: [
        { tipo: 'PAUSE', metrica: 'SPEND', comparador: 'GTE', valor: 30_000, procedencia: 'USER_DEFINED' },
        { tipo: 'SUCCESS', metrica: 'COST_PER_CONVERSION', comparador: 'LTE', valor: 25_000, procedencia: 'USER_DEFINED' },
      ],
    },
  });
  expect(pol.statusCode, pol.body).toBe(200);
  await a.inject({ method: 'POST', url: '/investigacion', headers: h, payload: {} });
  await a.inject({ method: 'POST', url: '/plan', headers: h, payload: {} });
  await a.inject({ method: 'POST', url: '/campana/material', headers: h, payload: MATERIAL });
  await a.inject({ method: 'POST', url: '/campana/medicion', headers: h, payload: {} });
  await a.inject({ method: 'PATCH', url: '/campana/medicion', headers: h, payload: { eventKey: 'whatsapp_intent', accion: 'VERIFICAR' } });
  if (opciones.mandato !== false) {
    const m = await a.inject({
      method: 'POST', url: '/acquisition/action/mandate', headers: h,
      payload: { objective: 'captar', currency: 'CLP', authorizedBudgetMinor: 900_000, periodStart: MANDATO_DESDE, periodEnd: MANDATO_HASTA, allowedMetaAssets: [], allowedActionTypes: ['CREATE_CAMPAIGN'] },
    });
    expect(m.statusCode, m.body).toBe(201);
  }
  const prep = await a.inject({ method: 'POST', url: '/campana/ejecucion/preparar', headers: h, payload: {} });
  const peticion = (prep.json() as Vista).peticion;
  if (peticion !== null) {
    await a.inject({ method: 'POST', url: `/campana/ejecucion/${peticion.id}/autorizar`, headers: h, payload: {} });
    const ej = await a.inject({ method: 'POST', url: `/campana/ejecucion/${peticion.id}/ejecutar`, headers: h, payload: {} });
    expect((ej.json() as Vista).peticion.estado).toBe('CREATED_PAUSED');
  }
  if (opciones.modo !== undefined && opciones.modo !== 'SUPERVISED_REAL') {
    await pool.query('update identity_organizations set operational_mode = $2 where slug = $1', [org, opciones.modo]);
  }
  return { cookie, org };
}

const h = (cookie: string, org: string) => ({ ...H, cookie, 'x-organization-slug': org });

const correrCiclo = async (a: App, cookie: string, org: string, cuerpo: Record<string, unknown> = {}): Promise<Vista> => {
  const r = await a.inject({ method: 'POST', url: '/optimizacion/ciclo', headers: h(cookie, org), payload: cuerpo });
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as Vista;
};

const fijarPolitica = async (a: App, cookie: string, org: string, politica: Record<string, unknown>): Promise<Vista> => {
  const r = await a.inject({ method: 'PATCH', url: '/optimizacion/politica', headers: h(cookie, org), payload: politica });
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as Vista;
};

/** Métricas de una campaña que gastó sin resultados (dispara la pausa de seguridad). */
const GASTO_SIN_RESULTADOS = { costMicros: 80_000_000_000, impressions: 9_000, clicks: 300, conversions: 0 };
/** Métricas de una campaña que funciona bien (habilita subir presupuesto). */
const BUENOS_RESULTADOS = { costMicros: 48_000_000_000, impressions: 9_000, clicks: 300, conversions: 6 };

// ── 1. EL CICLO COMPLETO ────────────────────────────────────────────────────────────────────────

describe('Empresa QA Optimizer · el ciclo observar → decidir → gobernar → ejecutar', () => {
  it('CASO A · con poca evidencia no se hace nada', async () => {
    const g = googleSimulado({ metricas: { costMicros: 2_000_000_000, impressions: 120, clicks: 6, conversions: 0 } });
    const a = app(g);
    const { cookie, org } = await empresaConCampania(a, 'duena-a@soec.cl', 'Empresa QA Optimizer A');
    const v = await correrCiclo(a, cookie, org);
    expect(v.ciclo.estado).toBe('WAITING_FOR_EVIDENCE');
    expect(String(v.ciclo.motivo)).toContain('1000');
    expect(v.decisiones).toHaveLength(0);
    expect(g.mutarGrafo).toHaveBeenCalledTimes(1); // sólo la creación de la campaña, ninguna optimización
    await a.close();
  });

  it('CASO B · un término irrelevante se propone como negativa, se aprueba y se aplica', async () => {
    const g = googleSimulado({
      metricas: { costMicros: 20_000_000_000, impressions: 5_000, clicks: 200, conversions: 2 },
      terminos: [
        { termino: 'trabajo dentista curico', metricas: { costMicros: 3_000_000_000, impressions: 200, clicks: 8, conversions: 0 } },
        { termino: 'precio implante dental', metricas: { costMicros: 5_000_000_000, impressions: 400, clicks: 20, conversions: 2 } },
      ],
    });
    const a = app(g);
    const { cookie, org } = await empresaConCampania(a, 'duena-b@soec.cl', 'Empresa QA Optimizer B');
    const escriturasAntes = g.mundo.escrituras;

    const v = await correrCiclo(a, cookie, org);
    expect(v.ciclo.estado).toBe('WAITING_FOR_APPROVAL');
    const decisiones = v.decisiones as Vista[];
    expect(decisiones.map((d) => d.accion)).toContain('ADD_NEGATIVE_KEYWORD');
    // «precio implante dental» NO se propone como negativa.
    expect(decisiones.map((d) => d.objetivo.nombre)).not.toContain('precio implante dental');
    // En modo supervisado NADA se aplicó todavía.
    expect(g.mundo.escrituras).toBe(escriturasAntes);

    const pendiente = (v.pendientes as Vista[])[0]!;
    expect(pendiente.decision.motivo).toContain('trabajo');
    expect(pendiente.decision.efectoEsperado).toBeTruthy();

    const r = await a.inject({ method: 'POST', url: `/optimizacion/pendientes/${pendiente.id}`, headers: h(cookie, org), payload: { decision: 'APROBAR' } });
    expect(r.statusCode, r.body).toBe(200);
    expect(g.mundo.negativas).toContain('trabajo dentista curico');
    const vista = r.json() as Vista;
    expect((vista.aplicadas as Vista[]).some((x) => x.accion === 'ADD_NEGATIVE_KEYWORD' && x.resultado === 'APPLIED' && x.verificacion === 'VERIFIED')).toBe(true);
    await a.close();
  });

  it('CASO C · una palabra con gasto improductivo y evidencia suficiente se propone pausar', async () => {
    const g = googleSimulado({
      metricas: { costMicros: 20_000_000_000, impressions: 5_000, clicks: 200, conversions: 1 },
      palabras: [{ criterionId: 'c1', adGroupId: '222', texto: 'implante dental curico', estado: 'ENABLED', metricas: { costMicros: 45_000_000_000, impressions: 3_000, clicks: 60, conversions: 0 } }],
    });
    const a = app(g);
    const { cookie, org } = await empresaConCampania(a, 'duena-c@soec.cl', 'Empresa QA Optimizer C');
    const v = await correrCiclo(a, cookie, org);
    const pausa = (v.decisiones as Vista[]).find((d) => d.accion === 'PAUSE_KEYWORD');
    expect(pausa, JSON.stringify(v.ciclo)).toBeDefined();
    expect(pausa!.objetivo.nombre).toBe('implante dental curico');
    expect(pausa!.reversible).toBe(true);

    const pendiente = (v.pendientes as Vista[]).find((p) => p.decision.accion === 'PAUSE_KEYWORD')!;
    await a.inject({ method: 'POST', url: `/optimizacion/pendientes/${pendiente.id}`, headers: h(cookie, org), payload: { decision: 'APROBAR' } });
    expect(g.mundo.palabras.find((k) => k.texto === 'implante dental curico')?.estado).toBe('PAUSED');
    await a.close();
  });

  it('CASO D · con buenos resultados se propone subir el presupuesto dentro del mandato', async () => {
    const g = googleSimulado({ metricas: BUENOS_RESULTADOS });
    const a = app(g);
    const { cookie, org } = await empresaConCampania(a, 'duena-d@soec.cl', 'Empresa QA Optimizer D');
    await fijarPolitica(a, cookie, org, { accionesPermitidas: ['ADJUST_DAILY_BUDGET'], maxCambioPresupuestoPct: 10, maxCambiosPorDia: 2, cooldownHoras: 1 });

    // El presupuesto de partida es el que fijó la Fase F: el MENOR entre el plan y el mandato.
    const partida = g.mundo.campania.presupuestoMicros / 1_000_000;
    const esperado = Math.round(partida * 1.1);
    const v = await correrCiclo(a, cookie, org);
    const subida = (v.decisiones as Vista[]).find((d) => d.accion === 'ADJUST_DAILY_BUDGET');
    expect(subida, JSON.stringify({ ciclo: v.ciclo, evidencia: v.evidencia })).toBeDefined();
    expect(subida!.estadoPropuesto).toBe(`${esperado} CLP/día`);
    expect(subida!.impactoMaximoClp).toBeGreaterThan(0);

    const pendiente = (v.pendientes as Vista[]).find((p) => p.decision.accion === 'ADJUST_DAILY_BUDGET')!;
    await a.inject({ method: 'POST', url: `/optimizacion/pendientes/${pendiente.id}`, headers: h(cookie, org), payload: { decision: 'APROBAR' } });
    expect(g.mundo.campania.presupuestoMicros).toBe(esperado * 1_000_000);
    // Y nunca por encima de lo que el mandato permite gastar por día.
    expect(esperado).toBeLessThanOrEqual(Math.floor(900_000 / 70));
    await a.close();
  });

  it('CASO E · una propuesta que supera el mandato queda bloqueada', async () => {
    const g = googleSimulado({ metricas: BUENOS_RESULTADOS });
    const a = app(g);
    // Sin mandato: cualquier cambio que comprometa gasto se bloquea.
    const { cookie, org } = await empresaConCampania(a, 'duena-e@soec.cl', 'Empresa QA Optimizer E', { mandato: false });
    await fijarPolitica(a, cookie, org, { accionesPermitidas: ['ADJUST_DAILY_BUDGET'], maxCambioPresupuestoPct: 10, cooldownHoras: 1 });
    const v = await correrCiclo(a, cookie, org);
    // Sin campaña creada (no hubo mandato para prepararla) el ciclo lo dice sin inventar nada.
    expect(['NO_ACTION', 'WAITING_FOR_EVIDENCE', 'DECIDED']).toContain(v.ciclo.estado);
    expect(g.mundo.campania.presupuestoMicros).toBe(10_000_000_000);
    await a.close();
  });

  it('CASO F · con la medición degradada no se decide por conversiones', async () => {
    const g = googleSimulado({ metricas: GASTO_SIN_RESULTADOS });
    const a = app(g);
    const { cookie, org } = await empresaConCampania(a, 'duena-f@soec.cl', 'Empresa QA Optimizer F');
    // La medición deja de registrar: la señal se degrada.
    await pool.query("update tracking_state set estado = 'DEGRADED' where organization_id = $1", [org]);
    const v = await correrCiclo(a, cookie, org);
    expect((v.decisiones as Vista[]).map((d) => d.accion)).not.toContain('PAUSE_CAMPAIGN');
    expect((v.decisiones as Vista[]).map((d) => d.accion)).not.toContain('PAUSE_KEYWORD');
    expect((v.decisiones as Vista[]).map((d) => d.accion)).not.toContain('ADJUST_DAILY_BUDGET');
    await a.close();
  });

  it('CASO G · reintentar una acción ya aplicada es un NOOP, no un segundo cambio', async () => {
    const g = googleSimulado({
      metricas: { costMicros: 20_000_000_000, impressions: 5_000, clicks: 200, conversions: 2 },
      terminos: [{ termino: 'curso de implantes dentales', metricas: { costMicros: 2_000_000_000, impressions: 150, clicks: 5, conversions: 0 } }],
    });
    const a = app(g);
    const { cookie, org } = await empresaConCampania(a, 'duena-g@soec.cl', 'Empresa QA Optimizer G');
    const v = await correrCiclo(a, cookie, org);
    const pendiente = (v.pendientes as Vista[])[0]!;
    await a.inject({ method: 'POST', url: `/optimizacion/pendientes/${pendiente.id}`, headers: h(cookie, org), payload: { decision: 'APROBAR' } });
    expect(g.mundo.negativas).toEqual(['curso de implantes dentales']);
    const escriturasTrasAplicar = g.mundo.escrituras;

    // Otro ciclo: el término sigue ahí, pero ya está excluido ⇒ no se vuelve a proponer ni a escribir.
    const v2 = await correrCiclo(a, cookie, org);
    expect((v2.decisiones as Vista[]).map((d) => d.objetivo.nombre)).not.toContain('curso de implantes dentales');
    expect(g.mundo.escrituras).toBe(escriturasTrasAplicar);
    expect(g.mundo.negativas).toHaveLength(1);
    await a.close();
  });
});

// ── 2. MODO SOMBRA ──────────────────────────────────────────────────────────────────────────────

describe('modo sombra', () => {
  it('decide y registra qué habría hecho, sin tocar nada', async () => {
    const g = googleSimulado({
      metricas: GASTO_SIN_RESULTADOS,
      terminos: [{ termino: 'trabajo dentista curico', metricas: { costMicros: 3_000_000_000, impressions: 200, clicks: 8, conversions: 0 } }],
    });
    const a = app(g);
    const { cookie, org } = await empresaConCampania(a, 'duena-shadow@soec.cl', 'Empresa QA Optimizer Shadow');
    const escriturasAntes = g.mundo.escrituras;

    const v = await correrCiclo(a, cookie, org, { modo: 'SHADOW' });
    expect(v.ciclo.modo).toBe('SHADOW');
    expect((v.decisiones as Vista[]).length).toBeGreaterThan(0);
    // Ni escrituras, ni cola de aprobación: sólo registro.
    expect(g.mundo.escrituras).toBe(escriturasAntes);
    expect(v.pendientes).toHaveLength(0);
    expect((v.ciclo.resumen as Vista).registradas).toBeGreaterThan(0);
    expect(g.mundo.campania.estado).toBe('PAUSED');
    await a.close();
  });
});

// ── 3. ACTIVACIÓN DE CAMPAÑA ────────────────────────────────────────────────────────────────────

describe('activación de campaña', () => {
  it('en modo supervisado, una persona la enciende y la plataforma lo confirma', async () => {
    const g = googleSimulado();
    const a = app(g);
    const { cookie, org } = await empresaConCampania(a, 'duena-act@soec.cl', 'Empresa QA Optimizer Act');
    expect(g.mundo.campania.estado).toBe('PAUSED');

    const r = await a.inject({ method: 'POST', url: '/optimizacion/activar', headers: h(cookie, org), payload: {} });
    expect(r.statusCode, r.body).toBe(200);
    expect(g.mundo.campania.estado).toBe('ENABLED');
    const v = r.json() as Vista;
    expect((v.aplicadas as Vista[]).some((x) => x.accion === 'ENABLE_CAMPAIGN' && x.verificacion === 'VERIFIED')).toBe(true);
    const { rows } = await pool.query("select count(*)::int as n from business_audit where organization_id = $1 and action = 'CAMPAIGN_ACTIVATED'", [org]);
    expect(rows[0].n).toBe(1);
    await a.close();
  });

  it('en modo automático SIN permiso explícito de activación, la campaña sigue en pausa', async () => {
    const g = googleSimulado();
    const a = app(g);
    const { cookie, org } = await empresaConCampania(a, 'duena-auto1@soec.cl', 'Empresa QA Optimizer Auto1');
    await fijarPolitica(a, cookie, org, { accionesPermitidas: ['PAUSE_CAMPAIGN'], activacionAutonomaPermitida: false });
    await pool.query("update identity_organizations set operational_mode = 'AUTONOMOUS_REAL' where slug = $1", [org]);

    const r = await a.inject({ method: 'POST', url: '/optimizacion/activar', headers: h(cookie, org), payload: {} });
    expect(r.statusCode).toBe(409);
    expect(r.json().message).toContain('explícitamente');
    expect(g.mundo.campania.estado).toBe('PAUSED');
    await a.close();
  });

  it('con permiso de activación automática pero mandato vencido, la campaña sigue en pausa', async () => {
    const g = googleSimulado();
    const a = app(g);
    const { cookie, org } = await empresaConCampania(a, 'duena-auto2@soec.cl', 'Empresa QA Optimizer Auto2');
    await fijarPolitica(a, cookie, org, { accionesPermitidas: ['PAUSE_CAMPAIGN'], activacionAutonomaPermitida: true });
    await pool.query("update identity_organizations set operational_mode = 'AUTONOMOUS_REAL' where slug = $1", [org]);
    await pool.query('update accion_mandato set period_end = $2 where organization_id = $1', [org, MANDATO_VENCIDO]);

    const r = await a.inject({ method: 'POST', url: '/optimizacion/activar', headers: h(cookie, org), payload: {} });
    expect(r.statusCode).toBe(409);
    expect(r.json().message).toContain('presupuesto');
    expect(g.mundo.campania.estado).toBe('PAUSED');
    await a.close();
  });
});

// ── 4. LÍMITES, APRENDIZAJE Y AISLAMIENTO ───────────────────────────────────────────────────────

describe('límites de autonomía y aislamiento', () => {
  it('la política de autonomía la fija una persona y no admite acciones que esta versión no ejecuta', async () => {
    const g = googleSimulado();
    const a = app(g);
    const { cookie, org } = await empresaConCampania(a, 'duena-pol@soec.cl', 'Empresa QA Optimizer Pol');
    const mala = await a.inject({ method: 'PATCH', url: '/optimizacion/politica', headers: h(cookie, org), payload: { accionesPermitidas: ['CREATE_AD'] } });
    expect(mala.statusCode).toBe(409);

    const v = await fijarPolitica(a, cookie, org, { accionesPermitidas: ['PAUSE_CAMPAIGN', 'ADD_NEGATIVE_KEYWORD'], maxCambioPresupuestoPct: 15, maxCambiosPorDia: 2, cooldownHoras: 12, activacionAutonomaPermitida: false });
    expect((v.politica as Vista).accionesPermitidas).toEqual(['PAUSE_CAMPAIGN', 'ADD_NEGATIVE_KEYWORD']);
    expect((v.politica as Vista).activacionAutonomaPermitida).toBe(false);
    const { rows } = await pool.query("select count(*)::int as n from business_audit where organization_id = $1 and action = 'AUTONOMY_POLICY_UPDATED'", [org]);
    expect(rows[0].n).toBe(1);
    await a.close();
  });

  it('cada acción aplicada deja un registro de aprendizaje con su efecto esperado', async () => {
    const g = googleSimulado({
      metricas: { costMicros: 20_000_000_000, impressions: 5_000, clicks: 200, conversions: 2 },
      terminos: [{ termino: 'trabajo dentista curico', metricas: { costMicros: 3_000_000_000, impressions: 200, clicks: 8, conversions: 0 } }],
    });
    const a = app(g);
    const { cookie, org } = await empresaConCampania(a, 'duena-apr@soec.cl', 'Empresa QA Optimizer Apr');
    const v = await correrCiclo(a, cookie, org);
    const pendiente = (v.pendientes as Vista[])[0]!;
    const vista = await a.inject({ method: 'POST', url: `/optimizacion/pendientes/${pendiente.id}`, headers: h(cookie, org), payload: { decision: 'APROBAR' } });
    const aprendizajes = (vista.json() as Vista).aprendizajes as Vista[];
    expect(aprendizajes).toHaveLength(1);
    expect(aprendizajes[0]!.resultado).toBe('NOT_ENOUGH_TIME');
    expect(aprendizajes[0]!.efectoEsperado).toContain('dejar de pagar');
    await a.close();
  });

  it('rechazar una propuesta la cierra sin tocar nada', async () => {
    const g = googleSimulado({
      metricas: { costMicros: 20_000_000_000, impressions: 5_000, clicks: 200, conversions: 2 },
      terminos: [{ termino: 'trabajo dentista curico', metricas: { costMicros: 3_000_000_000, impressions: 200, clicks: 8, conversions: 0 } }],
    });
    const a = app(g);
    const { cookie, org } = await empresaConCampania(a, 'duena-rech@soec.cl', 'Empresa QA Optimizer Rech');
    const v = await correrCiclo(a, cookie, org);
    const pendiente = (v.pendientes as Vista[])[0]!;
    const escrituras = g.mundo.escrituras;
    const r = await a.inject({ method: 'POST', url: `/optimizacion/pendientes/${pendiente.id}`, headers: h(cookie, org), payload: { decision: 'RECHAZAR', nota: 'ese término sí me sirve' } });
    expect(r.statusCode).toBe(200);
    expect(g.mundo.escrituras).toBe(escrituras);
    expect(g.mundo.negativas).toHaveLength(0);
    expect((r.json() as Vista).pendientes).toHaveLength(0);
    await a.close();
  });

  it('una empresa no corre el ciclo, no aprueba y no enciende la campaña de otra', async () => {
    const g = googleSimulado();
    const a = app(g);
    const { org: orgA } = await empresaConCampania(a, 'duena-iso-a@soec.cl', 'Empresa QA Optimizer ISO A');
    const cookieB = await usuario(a, 'dueno-iso-b@soec.cl');
    await crearEmpresa(a, cookieB, 'Empresa QA Optimizer ISO B');

    for (const url of ['/optimizacion', '/optimizacion/ciclo', '/optimizacion/activar', '/optimizacion/politica']) {
      const metodo = url === '/optimizacion' ? 'GET' : url === '/optimizacion/politica' ? 'PATCH' : 'POST';
      const r = await a.inject({ method: metodo as 'GET', url, headers: h(cookieB, orgA), payload: {} });
      expect([403, 404], `${url} → ${r.statusCode}`).toContain(r.statusCode);
    }
    expect(g.mundo.campania.estado).toBe('PAUSED');
    const { rows } = await pool.query('select count(*)::int as n from optimization_cycle where organization_id <> $1', [orgA]);
    expect(rows[0].n).toBe(0);
    await a.close();
  });
});
