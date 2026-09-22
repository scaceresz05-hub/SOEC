/**
 * Autonomy Fase H · MATRIZ DE FALLOS, INVARIANTES DE SEGURIDAD Y ACEPTACIÓN DE SEGURIDAD.
 *
 * Aquí no se comprueba que el producto funcione: se comprueba **cómo se rompe**. Para cada fallo controlado:
 *
 *   · ¿se cierra cuando debe (fail-closed) o sigue con lo que sí tiene (fail-soft)?
 *   · ¿queda un camino de recuperación, sin recursos duplicados ni escrituras no pedidas?
 *   · ¿el mensaje sirve a la persona que tiene que arreglarlo?
 *
 * Y se fijan los INVARIANTES que ninguna ruta puede violar: nada nace encendido, nadie supera el mandato,
 * la autonomía no se concede sola, y la medición no se marca verificada sin señal.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { runMigrations } from '@soec/event-store/pg';
import { crearMembresia, identityMigrations, usuarioPorEmail, organizacionPorSlug } from '@soec/identity/pg';
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
import { restablecerNegociosDelRuntime } from '../src/plataforma';
import { GoogleSearchError } from '../src/campana/google-ads-mutate-http';
import type { DepsInvestigacion } from '../src/investigacion/investigacion-service';
import type { AuditoriaSitio, GeoTargetResuelto, IdeaDeTermino, PaginaObservada } from '../src/investigacion/proveedores';

const AQUI = dirname(fileURLToPath(import.meta.url));
const src = (rel: string): string => readFileSync(resolve(AQUI, '..', 'src', rel), 'utf8');
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
  await runMigrations(pool, optimizacionMigrations);
  await ejecutarDestructivoDePrueba(pool, 'truncate learning_outcome, optimization_action_log, pending_marketing_action, optimization_decision, observation_snapshot, optimization_cycle, autonomy_policy, execution_reconciliation, creative_asset, tracking_state, conversion_action_mapping, campaign_execution_step, campaign_execution_request, accion_ledger, accion_mandato, campaign_plan_group, campaign_plan, research_competitor, research_landing, research_channel, research_geo_target, research_keyword, research_finding, research_evidence, research_run, business_budget_intent, business_website_insight, business_onboarding_answer, business_onboarding, business_channel_rule, business_autonomy_limits, business_evaluation_rule, business_conversion_event, business_kpi, business_evaluation_policy, business_connection_ciphertext, business_capability, business_connection, business_audit, business_restriction, business_geo_scope, business_offering, business_objective, business_governance, business_profile restart identity cascade');
  await ejecutarDestructivoDePrueba(pool, 'truncate identity_password_resets, identity_audit_events, identity_invitations, identity_sessions, identity_memberships, identity_organizations, identity_users cascade');
  restablecerNegociosDelRuntime();
});
afterAll(async () => {
  restablecerNegociosDelRuntime();
  await pool.end();
});

// ── Mundo simulado con fallos inyectables ───────────────────────────────────────────────────────

interface Metricas { costMicros: number; impressions: number; clicks: number; conversions: number }
type Fallo = 'NINGUNO' | '403' | '429' | '500' | 'TIMEOUT' | 'OAUTH' | 'ESCRITURA_FALLA' | 'VERIFICACION_NO_COINCIDE';

function googleSimulado(inicial: { readonly fallo?: Fallo; readonly metricas?: Metricas; readonly terminos?: { termino: string; metricas: Metricas }[] } = {}) {
  const w = {
    fallo: inicial.fallo ?? ('NINGUNO' as Fallo),
    campania: { id: '900', nombre: '', estado: 'PAUSED', presupuestoMicros: 0 },
    metricas: inicial.metricas ?? { costMicros: 45_000_000_000, impressions: 6_000, clicks: 240, conversions: 2 },
    terminos: inicial.terminos ?? [],
    grupos: [] as { id: string; nombre: string; estado: string }[],
    palabras: [] as { criterionId: string; adGroupId: string; texto: string; estado: string }[],
    negativas: [] as string[],
    conversiones: [] as { id: string; nombre: string }[],
    escrituras: 0,
  };
  const met = (m: Metricas) => ({ costMicros: String(m.costMicros), impressions: String(m.impressions), clicks: String(m.clicks), conversions: m.conversions });

  const lanzarSiToca = (): void => {
    if (w.fallo === '403') throw new GoogleSearchError({ httpStatus: 403, requestId: 'req-403', status: 'PERMISSION_DENIED', code: 'AuthorizationError.USER_PERMISSION_DENIED', message: 'sin permiso', errorPath: null, fieldPathElements: [], cuerpoResumen: null });
    if (w.fallo === '429') throw new GoogleSearchError({ httpStatus: 429, requestId: 'req-429', status: 'RESOURCE_EXHAUSTED', code: 'QuotaError.RESOURCE_EXHAUSTED', message: 'cuota agotada', errorPath: null, fieldPathElements: [], cuerpoResumen: null });
    if (w.fallo === '500') throw new GoogleSearchError({ httpStatus: 500, requestId: 'req-500', status: 'INTERNAL', code: null, message: 'error interno', errorPath: null, fieldPathElements: [], cuerpoResumen: null });
    if (w.fallo === 'TIMEOUT') throw new Error('The operation was aborted due to timeout');
    if (w.fallo === 'OAUTH') throw new Error('NO_ACCESS_TOKEN');
  };

  const buscar = vi.fn(async (_cid: string, consulta: string) => {
    lanzarSiToca();
    const q = consulta.toLowerCase();
    if (q.includes('from conversion_action')) {
      const m = /conversion_action.name = '([^']+)'/.exec(consulta);
      const c = w.conversiones.find((x) => x.nombre === m?.[1]);
      return c === undefined ? [] : [{ conversionAction: { id: c.id, name: c.nombre, resourceName: `customers/1/conversionActions/${c.id}`, status: 'ENABLED', tagSnippets: [{ eventSnippet: `send_to: 'AW-1/${c.id}'` }] } }];
    }
    if (q.includes('from keyword_view') || q.includes('from ad_group_criterion')) {
      const t = /ad_group_criterion\.keyword\.text = '([^']+)'/.exec(consulta);
      const fuente = t === null ? w.palabras : w.palabras.filter((k) => k.texto === t[1]);
      return fuente.map((k) => ({ adGroup: { id: k.adGroupId }, adGroupCriterion: { criterionId: k.criterionId, keyword: { text: k.texto, matchType: 'PHRASE' }, status: k.estado, cpcBidMicros: '2000000000' }, metrics: met(w.metricas) }));
    }
    if (q.includes('from search_term_view')) return w.terminos.map((t) => ({ searchTermView: { searchTerm: t.termino }, metrics: met(t.metricas) }));
    if (q.includes('from ad_group ')) return w.grupos.map((gr) => ({ adGroup: { id: gr.id, name: gr.nombre, status: gr.estado }, metrics: met(w.metricas) }));
    if (q.includes('from ad_group_ad')) return w.grupos.map(() => ({ adGroupAd: { ad: { id: '901' }, status: 'ENABLED' }, metrics: met(w.metricas) }));
    if (q.includes('bidding_strategy_type')) return [{ campaign: { biddingStrategyType: 'TARGET_SPEND' } }];
    if (q.includes('from campaign ')) {
      const porNombre = /campaign\.name = '([^']+)'/.exec(consulta);
      if (porNombre !== null && w.campania.nombre !== porNombre[1]) return [];
      if (w.campania.nombre === '' && !q.includes('metrics.')) return [];
      const base = { campaign: { id: w.campania.id, name: w.campania.nombre, status: w.campania.estado, advertisingChannelType: 'SEARCH' }, campaignBudget: { resourceName: 'customers/1/campaignBudgets/9', amountMicros: String(w.campania.presupuestoMicros) } };
      return q.includes('metrics.') ? [{ ...base, metrics: met(w.metricas), segments: { date: '2026-09-21' } }] : [base];
    }
    if (q.includes('from campaign_criterion')) {
      if (q.includes("type = 'location'")) return [{ campaignCriterion: { location: { geoTargetConstant: 'geoTargetConstants/1000341' } } }];
      return w.negativas.map((t) => ({ campaignCriterion: { keyword: { text: t } } }));
    }
    return [];
  });

  const mutarGrafo = vi.fn(async (_cid: string, request: { mutateOperations: Array<Record<string, unknown>> }) => {
    w.escrituras += 1;
    if (w.fallo === 'ESCRITURA_FALLA') {
      return { ok: false, httpStatus: 400, requestId: 'req-fail', validateOnly: false, operationCount: request.mutateOperations.length, resultsCount: 0, errorStatus: 'INVALID_ARGUMENT', errorCode: 'CampaignError.DUPLICATE_CAMPAIGN_NAME', errorMessage: 'duplicada', googleErrors: [], results: [], partialFailure: false as const };
    }
    const results: { resourceName: string }[] = [];
    let idGrupo = 950;
    for (const op of request.mutateOperations) {
      if ('campaignBudgetOperation' in op) {
        const o = op.campaignBudgetOperation as { create?: Record<string, unknown>; update?: Record<string, unknown> };
        if (o.create) w.campania.presupuestoMicros = Number(o.create.amountMicros);
        if (o.update && w.fallo !== 'VERIFICACION_NO_COINCIDE') w.campania.presupuestoMicros = Number(o.update.amountMicros);
        results.push({ resourceName: 'customers/1/campaignBudgets/9' });
      } else if ('campaignOperation' in op) {
        const o = op.campaignOperation as { create?: Record<string, unknown>; update?: Record<string, unknown> };
        if (o.create) w.campania = { ...w.campania, nombre: String(o.create.name), estado: String(o.create.status) };
        // El fallo de verificación simula una plataforma que acepta la orden y no la aplica.
        if (o.update?.status && w.fallo !== 'VERIFICACION_NO_COINCIDE') w.campania.estado = String(o.update.status);
        results.push({ resourceName: 'customers/1/campaigns/900' });
      } else if ('adGroupOperation' in op) {
        const o = op.adGroupOperation as { create?: Record<string, unknown> };
        const id = String((idGrupo += 1));
        if (o.create) w.grupos.push({ id, nombre: String(o.create.name), estado: String(o.create.status) });
        results.push({ resourceName: `customers/1/adGroups/${id}` });
      } else if ('adGroupAdOperation' in op) {
        results.push({ resourceName: 'customers/1/adGroupAds/950~1' });
      } else if ('adGroupCriterionOperation' in op) {
        const o = op.adGroupCriterionOperation as { create?: { keyword?: { text?: string } } };
        if (o.create?.keyword?.text) w.palabras.push({ criterionId: `k${w.palabras.length + 1}`, adGroupId: '951', texto: o.create.keyword.text, estado: 'ENABLED' });
        results.push({ resourceName: 'customers/1/adGroupCriteria/951~1' });
      } else if ('campaignCriterionOperation' in op) {
        const o = op.campaignCriterionOperation as { create?: { negative?: boolean; keyword?: { text?: string } } };
        if (o.create?.negative === true && o.create.keyword?.text && w.fallo !== 'VERIFICACION_NO_COINCIDE') w.negativas.push(o.create.keyword.text);
        results.push({ resourceName: 'customers/1/campaignCriteria/900~1' });
      }
    }
    return { ok: true, httpStatus: 200, requestId: 'req-ok', validateOnly: false, operationCount: request.mutateOperations.length, resultsCount: results.length, errorStatus: null, errorCode: null, errorMessage: null, googleErrors: [], results, partialFailure: false as const };
  });

  const crearAccionDeConversion = vi.fn(async (_cid: string, spec: { nombre: string }) => {
    lanzarSiToca();
    const id = String(700 + w.conversiones.length);
    w.conversiones.push({ id, nombre: spec.nombre });
    return { resourceName: `customers/1/conversionActions/${id}`, requestId: 'req-conv' };
  });

  return { mundo: w, cliente: { buscar, mutarGrafo, crearAccionDeConversion } as never, buscar, mutarGrafo };
}

const IDEAS: readonly IdeaDeTermino[] = [
  { termino: 'implante dental curico', semilla: null, metricas: { avgMonthlySearches: 320, competition: 'MEDIUM', competitionIndex: 45, lowTopOfPageBidMicros: 800_000_000, highTopOfPageBidMicros: 2_000_000_000 } },
];
const GEOS: Record<string, GeoTargetResuelto> = {
  'Curicó': { solicitado: 'Curicó', disponible: true, targetId: '1000341', targetTipo: 'CITY', nombreCanonico: 'Curicó, Chile', aproximacion: false, riesgoDerrame: 'NONE' },
};
const pagina = (over: Partial<PaginaObservada>): PaginaObservada => ({
  ruta: '/', httpStatus: 200, titulo: 'Clínica QA', metaDescription: 'dental', h1: ['Clínica QA'], h2: [],
  ctas: ['agendar'], enlacesInternos: 3, canonical: null, indexable: true, tieneDatosEstructurados: true,
  viasDeContacto: ['whatsapp'], ...over,
});

function proveedores(o: { readonly sitioCaido?: boolean; readonly sinDemanda?: boolean; readonly geoFalla?: boolean } = {}): (org: string) => Promise<DepsInvestigacion> {
  return async () => ({
    ahora: () => AHORA,
    sitio: {
      nombre: 'sitio', fuente: 'WEBSITE_AUDIT',
      auditar: async (url: string): Promise<AuditoriaSitio> => (o.sitioCaido === true
        ? { url, alcanzable: false, paginas: [], paginasVisitadas: 0, paginasOmitidas: 0, error: 'el sitio no respondió en el tiempo esperado', observadoEn: AHORA }
        : { url, alcanzable: true, paginas: [pagina({}), pagina({ ruta: '/implantes-dentales', titulo: 'Implantes dentales', h1: ['Implantes dentales'] })], paginasVisitadas: 2, paginasOmitidas: 0, error: null, observadoEn: AHORA }),
    },
    geo: {
      nombre: 'geo', fuente: 'GOOGLE_ADS_GEO_TARGETS',
      resolver: async (nombres: readonly string[]) => (o.geoFalla === true ? null : nombres.map((n) => GEOS[n] ?? { solicitado: n, disponible: false, targetId: null, targetTipo: null, nombreCanonico: null, aproximacion: false, riesgoDerrame: 'UNKNOWN' as const })),
    },
    ...(o.sinDemanda === true ? {} : {
      demanda: { nombre: 'demanda', fuente: 'GOOGLE_ADS_KEYWORD_DATA', demanda: async () => ({ ideas: IDEAS, fuente: 'GOOGLE_ADS_KEYWORD_DATA' as const, observadoEn: AHORA, periodo: '12 meses' }) },
    }),
  });
}

function app(google: ReturnType<typeof googleSimulado>, o: { readonly eventos?: number; readonly investigacion?: (org: string) => Promise<DepsInvestigacion> } = {}) {
  return buildApp({
    store: new InMemoryEventStore(), intelligence: new DeterministicIntelligenceProvider(), pool, legacyDemoAccess: false,
    proveedoresInvestigacion: o.investigacion ?? proveedores(),
    ejecucionGoogle: async () => google.cliente,
    ejecucionObservarEventos: async () => ({ observados: o.eventos ?? 4, desde: AHORA }),
  });
}
type App = ReturnType<typeof app>;
type Vista = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function cookieDe(res: { headers: Record<string, unknown> }): string {
  const sc = res.headers['set-cookie'];
  const arr = Array.isArray(sc) ? sc : [sc];
  const c = arr.find((x): x is string => typeof x === 'string' && x.startsWith('soec_session='));
  return c ? c.split(';')[0]! : '';
}
async function registrar(a: App, email: string): Promise<string> {
  await a.inject({ method: 'POST', url: '/auth/register', headers: H, payload: { email, displayName: email, password: 'Password123' } });
  return cookieDe(await a.inject({ method: 'POST', url: '/auth/login', headers: H, payload: { email, password: 'Password123' } }));
}
const h = (cookie: string, org: string) => ({ ...H, cookie, 'x-organization-slug': org });

const PASOS = [
  { paso: 'negocio', respuestas: { 'negocio.aQueSeDedica': 'Clínica dental en Curicó', 'negocio.tipo': 'CLINICA', 'negocio.tipoCliente': 'B2C', 'negocio.sitio': 'https://qa-fallos.example', 'negocio.pais': 'CL' } },
  { paso: 'oferta', respuestas: { 'oferta.queVendes': 'implantes dentales' } },
  { paso: 'territorio', respuestas: { 'territorio.donde': 'Curicó' } },
  { paso: 'objetivo', respuestas: { 'objetivo.queQuieres': 'nuevos-clientes', 'objetivo.enCuantoTiempo': 30 } },
  { paso: 'contacto', respuestas: { 'contacto.como': ['whatsapp'], 'contacto.principal': 'whatsapp' } },
  { paso: 'medicion', respuestas: { 'medicion.indicador': 'cantidad-contactos', 'medicion.conoceMeta': true, 'medicion.meta': 12, 'medicion.evidencia': 'prudente' } },
  { paso: 'presupuesto', respuestas: { 'presupuesto.modalidad': 'MONTHLY', 'presupuesto.monto': 300_000 } },
];
const MATERIAL = {
  ofertaSlug: 'implantes-dentales',
  titulares: ['Implantes dentales', 'Clínica en Curicó', 'Agenda tu evaluación'],
  descripciones: ['Rehabilitación oral con especialista.', 'Agenda tu hora por WhatsApp hoy mismo.'],
};

/** Empresa lista hasta donde diga `hasta`: 'CONEXION' | 'PLAN' | 'CAMPANA' | 'ACTIVA'. */
async function empresa(a: App, g: ReturnType<typeof googleSimulado>, email: string, nombre: string, hasta: 'CONEXION' | 'PLAN' | 'CAMPANA' | 'ACTIVA', opciones: { readonly mandato?: boolean } = {}): Promise<{ cookie: string; org: string }> {
  const cookie = await registrar(a, email);
  const alta = await a.inject({ method: 'POST', url: '/negocios', headers: { ...H, cookie }, payload: { displayName: nombre, businessType: 'CLINICA', country: 'CL', currency: 'CLP', timezone: 'America/Santiago' } });
  const org = alta.json().perfil.organizationId as string;
  for (const p of PASOS) await a.inject({ method: 'PATCH', url: '/onboarding', headers: h(cookie, org), payload: { paso: p.paso, respuestas: p.respuestas, avanzar: true } });
  await a.inject({ method: 'PATCH', url: '/politica', headers: h(cookie, org), payload: { reglas: [
    { tipo: 'PAUSE', metrica: 'SPEND', comparador: 'GTE', valor: 30_000, procedencia: 'USER_DEFINED' },
    { tipo: 'SUCCESS', metrica: 'COST_PER_CONVERSION', comparador: 'LTE', valor: 25_000, procedencia: 'USER_DEFINED' },
  ] } });
  await new RepositorioConexiones(pool).guardar(pool, {
    organizationId: org, provider: 'GOOGLE_ADS', id: `${org}:GOOGLE_ADS`, estado: 'CONNECTED',
    configuracion: { customerId: '1234567890', loginCustomerId: '1234567890' }, externalAccountId: '1234567890',
    loginAccountId: '1234567890', secretRef: null, validadaEn: AHORA, ultimoError: null, origen: 'UI',
  });
  await a.inject({ method: 'PATCH', url: '/capacidades', headers: h(cookie, org), payload: { capacidad: 'MEDICION_REAL', habilitada: true } });
  await a.inject({ method: 'PATCH', url: '/capacidades', headers: h(cookie, org), payload: { capacidad: 'ESCRITURA_ADS', habilitada: true } });
  await a.inject({ method: 'PATCH', url: `/organizations/${org}/operational-mode`, headers: { ...H, cookie }, payload: { mode: 'SUPERVISED_REAL' } });
  await a.inject({ method: 'PATCH', url: `/negocios/${org}/gobierno`, headers: h(cookie, org), payload: { externalMutations: true, campaignExecution: true } });
  if (opciones.mandato !== false) {
    await a.inject({ method: 'POST', url: '/acquisition/action/mandate', headers: h(cookie, org), payload: { objective: 'captar', currency: 'CLP', authorizedBudgetMinor: 900_000, periodStart: '2026-09-01T00:00:00.000Z', periodEnd: '2026-12-01T00:00:00.000Z', allowedMetaAssets: [], allowedActionTypes: ['CREATE_CAMPAIGN'] } });
  }
  if (hasta === 'CONEXION') return { cookie, org };

  await a.inject({ method: 'POST', url: '/investigacion', headers: h(cookie, org), payload: {} });
  await a.inject({ method: 'POST', url: '/plan', headers: h(cookie, org), payload: {} });
  if (hasta === 'PLAN') return { cookie, org };

  await a.inject({ method: 'POST', url: '/campana/material', headers: h(cookie, org), payload: MATERIAL });
  await a.inject({ method: 'POST', url: '/campana/medicion', headers: h(cookie, org), payload: {} });
  await a.inject({ method: 'PATCH', url: '/campana/medicion', headers: h(cookie, org), payload: { eventKey: 'whatsapp_intent', accion: 'VERIFICAR' } });
  const prep = await a.inject({ method: 'POST', url: '/campana/ejecucion/preparar', headers: h(cookie, org), payload: {} });
  const peticion = (prep.json() as Vista).peticion;
  if (peticion !== null) {
    await a.inject({ method: 'POST', url: `/campana/ejecucion/${peticion.id}/autorizar`, headers: h(cookie, org), payload: {} });
    await a.inject({ method: 'POST', url: `/campana/ejecucion/${peticion.id}/ejecutar`, headers: h(cookie, org), payload: {} });
  }
  if (hasta === 'CAMPANA') return { cookie, org };

  await a.inject({ method: 'POST', url: '/optimizacion/activar', headers: h(cookie, org), payload: {} });
  await a.inject({ method: 'PATCH', url: '/optimizacion/politica', headers: h(cookie, org), payload: { accionesPermitidas: ['PAUSE_CAMPAIGN', 'ADD_NEGATIVE_KEYWORD', 'ADJUST_DAILY_BUDGET'], maxCambioPresupuestoPct: 10, maxCambiosPorDia: 2, cooldownHoras: 1 } });
  return { cookie, org };
}

// ── 1. MATRIZ DE FALLOS ─────────────────────────────────────────────────────────────────────────

describe('matriz de fallos · investigación', () => {
  it.each([
    ['el sitio no responde', { sitioCaido: true }, 'WEBSITE_AUDIT', 'FAILED'],
    ['no hay proveedor de demanda', { sinDemanda: true }, 'GOOGLE_ADS_KEYWORD_DATA', 'UNAVAILABLE'],
    ['la consulta de territorios falla', { geoFalla: true }, 'GOOGLE_ADS_GEO_TARGETS', 'FAILED'],
  ])('%s ⇒ la investigación sigue con lo que sí tiene (fail-soft) y lo dice', async (_caso, fallo, fuente, disponibilidad) => {
    const g = googleSimulado();
    const a = app(g, { investigacion: proveedores(fallo as Record<string, boolean>) });
    const { cookie, org } = await empresa(a, g, `duena-${fuente.toLowerCase()}@soec.cl`, `Empresa QA ${fuente}`, 'CONEXION');
    const r = await a.inject({ method: 'POST', url: '/investigacion', headers: h(cookie, org), payload: {} });
    expect(r.statusCode).toBe(200);
    const v = r.json() as Vista;
    const estadoFuente = (v.corrida.fuentes as Vista[]).find((f) => f.fuente === fuente);
    expect(estadoFuente?.disponibilidad).toBe(disponibilidad);
    expect(estadoFuente?.motivo ?? v.corrida.fallos.join(' ')).toBeTruthy(); // siempre hay un motivo legible
    expect(['PARTIAL', 'FAILED']).toContain(v.corrida.estado);
    await a.close();
  });
});

describe('matriz de fallos · plataforma externa durante la ejecución', () => {
  it.each([
    ['403 sin permiso', '403' as const],
    ['429 cuota agotada', '429' as const],
    ['500 error del proveedor', '500' as const],
    ['timeout', 'TIMEOUT' as const],
    ['OAuth caducado', 'OAUTH' as const],
  ])('%s al preparar la medición ⇒ no se crea nada y el mensaje es útil', async (_caso, fallo) => {
    const g = googleSimulado({ fallo });
    const a = app(g);
    const { cookie, org } = await empresa(a, g, `duena-${fallo}@soec.cl`, `Empresa QA ${fallo}`, 'CONEXION');
    const r = await a.inject({ method: 'POST', url: '/campana/medicion', headers: h(cookie, org), payload: {} });
    // Fail-closed: no se inventa una acción de conversión ni se marca medición lista.
    expect([409, 500]).toContain(r.statusCode);
    expect(g.mundo.conversiones).toHaveLength(0);
    const { rows } = await pool.query('select count(*)::int as n from conversion_action_mapping where organization_id = $1 and external_id is not null', [org]);
    expect(rows[0].n).toBe(0);
    await a.close();
  });

  it('la plataforma rechaza la creación ⇒ FAILED, sin recursos a medias y reintentable', async () => {
    const g = googleSimulado({ fallo: 'ESCRITURA_FALLA' });
    const a = app(g);
    const { cookie, org } = await empresa(a, g, 'duena-rechazo@soec.cl', 'Empresa QA Rechazo', 'PLAN');
    await a.inject({ method: 'POST', url: '/campana/material', headers: h(cookie, org), payload: MATERIAL });
    g.mundo.fallo = 'NINGUNO';
    await a.inject({ method: 'POST', url: '/campana/medicion', headers: h(cookie, org), payload: {} });
    await a.inject({ method: 'PATCH', url: '/campana/medicion', headers: h(cookie, org), payload: { eventKey: 'whatsapp_intent', accion: 'VERIFICAR' } });
    const prep = await a.inject({ method: 'POST', url: '/campana/ejecucion/preparar', headers: h(cookie, org), payload: {} });
    const peticion = (prep.json() as Vista).peticion;
    await a.inject({ method: 'POST', url: `/campana/ejecucion/${peticion.id}/autorizar`, headers: h(cookie, org), payload: {} });

    g.mundo.fallo = 'ESCRITURA_FALLA';
    const fallida = await a.inject({ method: 'POST', url: `/campana/ejecucion/${peticion.id}/ejecutar`, headers: h(cookie, org), payload: {} });
    expect((fallida.json() as Vista).peticion.estado).toBe('FAILED');
    expect(g.mundo.campania.nombre).toBe(''); // nada quedó creado

    // RECUPERACIÓN: al arreglarse la plataforma, se puede volver a preparar y ejecutar, sin duplicar.
    g.mundo.fallo = 'NINGUNO';
    const prep2 = await a.inject({ method: 'POST', url: '/campana/ejecucion/preparar', headers: h(cookie, org), payload: {} });
    const peticion2 = (prep2.json() as Vista).peticion;
    await a.inject({ method: 'POST', url: `/campana/ejecucion/${peticion2.id}/autorizar`, headers: h(cookie, org), payload: {} });
    const ok = await a.inject({ method: 'POST', url: `/campana/ejecucion/${peticion2.id}/ejecutar`, headers: h(cookie, org), payload: {} });
    expect((ok.json() as Vista).peticion.estado).toBe('CREATED_PAUSED');
    const { rows } = await pool.query("select count(*)::int as n from campaign_execution_request where organization_id = $1 and estado = 'CREATED_PAUSED'", [org]);
    expect(rows[0].n).toBe(1);
    await a.close();
  });

  it('la plataforma acepta pero NO aplica ⇒ la verificación lo detecta (DIVERGED)', async () => {
    const g = googleSimulado({ terminos: [{ termino: 'curso de implantes dentales', metricas: { costMicros: 3_000_000_000, impressions: 200, clicks: 8, conversions: 0 } }] });
    const a = app(g);
    const { cookie, org } = await empresa(a, g, 'duena-diverge@soec.cl', 'Empresa QA Diverge', 'ACTIVA');
    const ciclo = await a.inject({ method: 'POST', url: '/optimizacion/ciclo', headers: h(cookie, org), payload: {} });
    const pendiente = ((ciclo.json() as Vista).pendientes as Vista[])[0];
    if (pendiente === undefined) throw new Error('el ciclo no propuso nada que aprobar');

    g.mundo.fallo = 'VERIFICACION_NO_COINCIDE'; // Google responde 200 pero no aplica el cambio
    const r = await a.inject({ method: 'POST', url: `/optimizacion/pendientes/${pendiente.id}`, headers: h(cookie, org), payload: { decision: 'APROBAR' } });
    const aplicadas = (r.json() as Vista).aplicadas as Vista[];
    expect(aplicadas.some((x) => x.verificacion === 'DIVERGED')).toBe(true);
    await a.close();
  });

  it('DERIVA REMOTA: si alguien cambia la campaña por fuera, se registra y no se sobrescribe', async () => {
    const g = googleSimulado();
    const a = app(g);
    const { cookie, org } = await empresa(a, g, 'duena-drift@soec.cl', 'Empresa QA Drift', 'CAMPANA');
    const { rows: pet } = await pool.query('select id from campaign_execution_request where organization_id = $1', [org]);
    const id = (pet[0] as { id: string }).id;

    g.mundo.campania.presupuestoMicros = 99_000_000_000; // alguien lo cambió en la interfaz de Google
    const r = await a.inject({ method: 'POST', url: `/campana/ejecucion/${id}/reconciliar`, headers: h(cookie, org), payload: {} });
    const peticion = (r.json() as Vista).peticion;
    expect(peticion.reconciliacion.coincide).toBe(false);
    expect((peticion.reconciliacion.divergencias as Vista[]).map((d) => d.campo)).toContain('presupuesto diario');
    expect(String(peticion.motivo)).toContain('fuera de SOEC');
    expect(g.mundo.campania.presupuestoMicros).toBe(99_000_000_000); // NO se pisó
    await a.close();
  });
});

describe('matriz de fallos · condiciones del negocio', () => {
  it('investigación vieja ⇒ el plan y la ejecución se bloquean', async () => {
    const g = googleSimulado();
    const a = app(g);
    const { cookie, org } = await empresa(a, g, 'duena-stale@soec.cl', 'Empresa QA Stale', 'CAMPANA');
    await a.inject({ method: 'PATCH', url: '/onboarding', headers: h(cookie, org), payload: { paso: 'territorio', respuestas: { 'territorio.donde': 'Curicó y Molina' }, avanzar: true } });
    const v = await a.inject({ method: 'GET', url: '/campana/ejecucion', headers: h(cookie, org) });
    const plan = ((v.json() as Vista).prerrequisitos as Vista[]).find((r) => r.requisito === 'PLAN_CURRENT');
    expect(plan?.veredicto).toBe('ACTION_REQUIRED');
    await a.close();
  });

  it('mandato vencido ⇒ ni se ejecuta ni se enciende', async () => {
    const g = googleSimulado();
    const a = app(g);
    const { cookie, org } = await empresa(a, g, 'duena-mandato@soec.cl', 'Empresa QA Mandato', 'CAMPANA');
    await pool.query("update accion_mandato set period_end = '2026-09-02T00:00:00.000Z' where organization_id = $1", [org]);
    const activar = await a.inject({ method: 'POST', url: '/optimizacion/activar', headers: h(cookie, org), payload: {} });
    expect(activar.statusCode).toBe(409);
    expect(g.mundo.campania.estado).toBe('PAUSED');
    await a.close();
  });

  it('medición degradada ⇒ no se decide por conversiones', async () => {
    const g = googleSimulado();
    const a = app(g);
    const { cookie, org } = await empresa(a, g, 'duena-track@soec.cl', 'Empresa QA Tracking', 'ACTIVA');
    await pool.query("update tracking_state set estado = 'DEGRADED' where organization_id = $1", [org]);
    const ciclo = await a.inject({ method: 'POST', url: '/optimizacion/ciclo', headers: h(cookie, org), payload: {} });
    const decisiones = ((ciclo.json() as Vista).decisiones as Vista[]).map((d) => d.accion);
    expect(decisiones).not.toContain('ADJUST_DAILY_BUDGET');
    expect(decisiones).not.toContain('PAUSE_KEYWORD');
    await a.close();
  });

  it('interruptor del despliegue cerrado ⇒ ninguna ruta puede escribir', async () => {
    const g = googleSimulado({ terminos: [{ termino: 'curso de implantes dentales', metricas: { costMicros: 3_000_000_000, impressions: 200, clicks: 8, conversions: 0 } }] });
    const a = app(g);
    const { cookie, org } = await empresa(a, g, 'duena-kill@soec.cl', 'Empresa QA Kill', 'ACTIVA');
    const escrituras = g.mundo.escrituras;
    process.env.SOEC_EXTERNAL_MUTATIONS = 'off';
    try {
      const ciclo = await a.inject({ method: 'POST', url: '/optimizacion/ciclo', headers: h(cookie, org), payload: {} });
      expect(ciclo.statusCode).toBe(200);
      const activar = await a.inject({ method: 'POST', url: '/optimizacion/activar', headers: h(cookie, org), payload: {} });
      expect(activar.statusCode).toBe(409);
      const medicion = await a.inject({ method: 'POST', url: '/campana/medicion', headers: h(cookie, org), payload: {} });
      expect([400, 409]).toContain(medicion.statusCode);
      expect(medicion.body).toMatch(/[A-Za-z]/); // hay un motivo, no un cuerpo vacío
      expect(g.mundo.escrituras).toBe(escrituras); // ni una escritura nueva
    } finally {
      delete process.env.SOEC_EXTERNAL_MUTATIONS;
    }
    await a.close();
  });
});

// ── 2. INVARIANTES DE SEGURIDAD ─────────────────────────────────────────────────────────────────

describe('invariantes que ninguna ruta puede violar', () => {
  it('ninguna campaña se crea ENABLED por defecto', async () => {
    const g = googleSimulado();
    const a = app(g);
    await empresa(a, g, 'duena-inv1@soec.cl', 'Empresa QA Inv1', 'CAMPANA');
    expect(g.mundo.campania.estado).toBe('PAUSED');
    expect(g.mundo.grupos.every((x) => x.estado === 'PAUSED')).toBe(true);
    // Y en la fuente: el materializador no puede caer en ENABLED por descuido.
    expect(src('campana/google-ads-materializer.ts')).toContain("status: opts.campaignStatus ?? 'PAUSED'");
    expect(src('ejecucion/paquete.ts')).toContain("readonly estadoInicial: 'PAUSED'");
    await a.close();
  });

  it('la autonomía no se concede sola: completar el recorrido deja todo apagado', async () => {
    const g = googleSimulado();
    const a = app(g);
    const { cookie, org } = await empresa(a, g, 'duena-inv2@soec.cl', 'Empresa QA Inv2', 'CAMPANA');
    const { rows: modo } = await pool.query('select operational_mode from identity_organizations where slug = $1', [org]);
    expect(modo[0].operational_mode).toBe('SUPERVISED_REAL'); // lo pidió una persona, y aun así NO es autónomo
    const { rows: gob } = await pool.query('select autonomous_spend from business_governance where organization_id = $1', [org]);
    expect(gob[0].autonomous_spend).toBe(false);
    const v = await a.inject({ method: 'GET', url: '/optimizacion', headers: h(cookie, org) });
    expect((v.json() as Vista).politica.activacionAutonomaPermitida).toBe(false);
    expect((v.json() as Vista).politica.maxCambioPresupuestoPct).toBe(0);
    await a.close();
  });

  it('sin permiso de escritura no hay camino que llegue a la plataforma', async () => {
    const g = googleSimulado();
    const a = app(g);
    const { cookie, org } = await empresa(a, g, 'duena-inv3@soec.cl', 'Empresa QA Inv3', 'PLAN');
    await a.inject({ method: 'PATCH', url: '/capacidades', headers: h(cookie, org), payload: { capacidad: 'ESCRITURA_ADS', habilitada: false } });
    const escrituras = g.mundo.escrituras;
    expect([400, 409]).toContain((await a.inject({ method: 'POST', url: '/campana/medicion', headers: h(cookie, org), payload: {} })).statusCode);
    expect([400, 409]).toContain((await a.inject({ method: 'POST', url: '/optimizacion/activar', headers: h(cookie, org), payload: {} })).statusCode);
    expect(g.mundo.escrituras).toBe(escrituras);
    await a.close();
  });

  it('la medición no se marca verificada sin señal observada', async () => {
    const g = googleSimulado();
    const a = app(g, { eventos: 0 }); // no llega ninguna señal
    const { cookie, org } = await empresa(a, g, 'duena-inv4@soec.cl', 'Empresa QA Inv4', 'PLAN');
    await a.inject({ method: 'POST', url: '/campana/medicion', headers: h(cookie, org), payload: {} });
    const r = await a.inject({ method: 'PATCH', url: '/campana/medicion', headers: h(cookie, org), payload: { eventKey: 'whatsapp_intent', accion: 'VERIFICAR' } });
    expect((r.json() as Vista).medicion[0].estado).not.toBe('VERIFIED');
    const { rows } = await pool.query("select count(*)::int as n from conversion_action_mapping where organization_id = $1 and verificacion = 'VERIFICADA'", [org]);
    expect(rows[0].n).toBe(0);
    await a.close();
  });

  it('el presupuesto materializado nunca supera el mandato', async () => {
    const g = googleSimulado();
    const a = app(g);
    const { org } = await empresa(a, g, 'duena-inv5@soec.cl', 'Empresa QA Inv5', 'CAMPANA');
    const { rows } = await pool.query('select paquete from campaign_execution_request where organization_id = $1', [org]);
    const paquete = (rows[0] as { paquete: Vista }).paquete;
    const diario = paquete.campania.presupuestoDiarioClp as number;
    const dias = Math.round((Date.parse(paquete.mandato.hasta as string) - Date.parse('2026-09-01T00:00:00.000Z')) / 86_400_000);
    expect(diario * dias).toBeLessThanOrEqual(paquete.mandato.topeMinor as number);
    await a.close();
  });

  it('no existe ninguna ruta que encienda una campaña fuera del flujo de activación', () => {
    const rutas = readdirSync(resolve(AQUI, '..', 'src'), { recursive: true, encoding: 'utf8' })
      .filter((f) => typeof f === 'string' && f.endsWith('-routes.ts'));
    const conEncendido = rutas.filter((f) => /(status|estado)\s*:\s*'ENABLED'/.test(src(f)));
    expect(conEncendido, `rutas que mencionan ENABLED: ${conEncendido.join(', ')}`).toHaveLength(0);
    // La única puerta de encendido vive en el servicio de optimización, y exige sus ocho condiciones.
    expect(src('optimizacion/optimizacion-service.ts')).toContain('puedeActivarse');
  });
});

// ── 3. ACEPTACIÓN DE SEGURIDAD ──────────────────────────────────────────────────────────────────

describe('aceptación de seguridad', () => {
  it('sin sesión no se llega a ninguna superficie de negocio', async () => {
    const g = googleSimulado();
    const a = app(g);
    for (const url of ['/onboarding', '/politica', '/conexiones', '/investigacion', '/plan', '/campana/ejecucion', '/optimizacion']) {
      const r = await a.inject({ method: 'GET', url });
      expect([401, 403], `${url} sin sesión → ${r.statusCode}`).toContain(r.statusCode);
    }
    await a.close();
  });

  it('un miembro sin permiso de gestión puede mirar, pero no decidir', async () => {
    const g = googleSimulado();
    const a = app(g);
    const { org } = await empresa(a, g, 'duena-perm@soec.cl', 'Empresa QA Permisos', 'CAMPANA');
    // Una persona con rol de sólo lectura en la MISMA empresa.
    const cookieViewer = await registrar(a, 'mirona@soec.cl');
    const u = await usuarioPorEmail(pool, 'mirona@soec.cl');
    const o = await organizacionPorSlug(pool, org);
    await crearMembresia(pool, u!.id, o!.id, 'VIEWER', 'ACTIVE');

    const lectura = await a.inject({ method: 'GET', url: '/optimizacion', headers: h(cookieViewer, org) });
    expect(lectura.statusCode).toBe(200);
    for (const url of ['/campana/ejecucion/preparar', '/optimizacion/ciclo', '/optimizacion/activar', '/campana/medicion']) {
      const r = await a.inject({ method: 'POST', url, headers: h(cookieViewer, org), payload: {} });
      expect(r.statusCode, `${url} con VIEWER → ${r.statusCode}`).toBe(403);
    }
    expect(g.mundo.campania.estado).toBe('PAUSED');
    await a.close();
  });

  it('ninguna respuesta de las superficies nuevas devuelve secretos', async () => {
    const g = googleSimulado();
    const a = app(g);
    const { cookie, org } = await empresa(a, g, 'duena-secretos@soec.cl', 'Empresa QA Secretos', 'CAMPANA');
    for (const url of ['/conexiones', '/campana/ejecucion', '/optimizacion', '/investigacion', '/plan']) {
      const r = await a.inject({ method: 'GET', url, headers: h(cookie, org) });
      const cuerpo = r.body;
      expect(cuerpo).not.toMatch(/"(secret|token|password|refresh_token|access_token)"\s*:/i);
      expect(cuerpo).not.toMatch(/ya29\.|AIza[0-9A-Za-z_-]{10}/); // formas de credencial de Google
    }
    await a.close();
  });

  it('la ingesta del sitio conserva sus defensas: ni http, ni direcciones internas', async () => {
    const g = googleSimulado();
    const a = app(g);
    const { cookie, org } = await empresa(a, g, 'duena-ssrf@soec.cl', 'Empresa QA SSRF', 'CONEXION');
    for (const url of ['http://interno.example', 'https://localhost', 'https://127.0.0.1', 'no-es-una-url']) {
      const r = await a.inject({ method: 'POST', url: '/onboarding/sitio', headers: h(cookie, org), payload: { url } });
      const v = r.json() as Vista;
      expect(['REJECTED', 'NOT_HTTPS', 'UNREACHABLE', 'ERROR'], `${url} → ${JSON.stringify(v.sitio ?? v)}`).toContain(v.sitio?.estado ?? 'REJECTED');
    }
    await a.close();
  });

  it('los secretos de conexión se guardan cifrados, nunca en claro', () => {
    // El almacén de secretos de conexiones usa sobre cifrado con KMS; la tabla guarda ciphertext.
    expect(src('conexion/conexion-pg.ts')).toContain('business_connection_ciphertext');
    expect(src('conexion/secreto-conexion.ts')).toContain('EnvelopeSecretBackend');
    // Y las rutas nunca devuelven el valor del secreto: sólo si está configurado.
    expect(src('conexion/conexion-routes.ts')).not.toMatch(/token:\s*conexion|secretValue/);
  });
});
