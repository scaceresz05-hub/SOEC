/**
 * Autonomy Fase H · ACEPTACIÓN EXTREMO A EXTREMO — una sola historia empresarial, sobre PostgreSQL real.
 *
 * Esta prueba NO añade capacidades: comprueba que las que ya existen encajan entre sí. Es la que encuentra lo
 * que ninguna prueba de fase puede encontrar — el campo que el asistente llama de una forma y el planificador
 * espera de otra, la capacidad que el plan concede y el ejecutor no reconoce, el territorio que la
 * investigación guarda y la ejecución no consume, la conversión que el optimizador interpreta distinto.
 *
 * Recorre las 33 etapas del producto con «Empresa QA Full Autonomy» por las MISMAS rutas que usa la interfaz,
 * con proveedores externos deterministas, y después exige tres cosas que el producto promete:
 *
 *  · LINAJE COMPLETO: desde la última decisión se puede reconstruir hasta el alta de la empresa, sin huérfanos.
 *  · AISLAMIENTO: una segunda empresa no puede leer ni usar nada de la primera, ni con identificadores válidos.
 *  · REANUDACIÓN: entre etapas el proceso se reinicia (instancia nueva) y el recorrido continúa desde la base.
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
import { ejecucionMigrations } from '../src/ejecucion/ejecucion-pg';
import { accionMigrations } from '../src/accion/accion-pg';
import { optimizacionMigrations } from '../src/optimizacion/optimizacion-pg';
import { estadoDeCompatibilidadLegado, restablecerNegociosDelRuntime } from '../src/plataforma';
import type { DepsInvestigacion } from '../src/investigacion/investigacion-service';
import type { AuditoriaSitio, GeoTargetResuelto, IdeaDeTermino, PaginaObservada } from '../src/investigacion/proveedores';

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

// ── MUNDO EXTERNO SIMULADO (compartido por todo el recorrido) ───────────────────────────────────

interface Metricas { costMicros: number; impressions: number; clicks: number; conversions: number }

interface Mundo {
  campania: { id: string; nombre: string; estado: string; presupuestoMicros: number; estrategia: string };
  metricas: Metricas;
  grupos: { id: string; nombre: string; estado: string }[];
  palabras: { criterionId: string; adGroupId: string; texto: string; estado: string; metricas: Metricas }[];
  terminos: { termino: string; metricas: Metricas }[];
  negativas: string[];
  conversiones: { id: string; nombre: string }[];
  escrituras: number;
  lecturas: number;
}

function googleSimulado(over: Partial<Mundo> = {}) {
  const w: Mundo = {
    campania: { id: '900', nombre: '', estado: 'PAUSED', presupuestoMicros: 0, estrategia: 'TARGET_SPEND' },
    metricas: { costMicros: 0, impressions: 0, clicks: 0, conversions: 0 },
    grupos: [], palabras: [], terminos: [], negativas: [], conversiones: [], escrituras: 0, lecturas: 0, ...over,
  };
  const met = (m: Metricas) => ({ costMicros: String(m.costMicros), impressions: String(m.impressions), clicks: String(m.clicks), conversions: m.conversions });

  const buscar = vi.fn(async (_cid: string, consulta: string) => {
    w.lecturas += 1;
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
    if (q.includes('from ad_group_ad')) return w.grupos.map(() => ({ adGroupAd: { ad: { id: '901' }, status: 'ENABLED' }, metrics: met(w.metricas) }));
    if (q.includes('bidding_strategy_type')) return [{ campaign: { biddingStrategyType: w.campania.estrategia } }];
    if (q.includes('from campaign ')) {
      const porNombre = /campaign\.name = '([^']+)'/.exec(consulta);
      if (porNombre !== null && w.campania.nombre !== porNombre[1]) return [];
      if (w.campania.nombre === '' && !q.includes('metrics.')) return [];
      const base = { campaign: { id: w.campania.id, name: w.campania.nombre, status: w.campania.estado, advertisingChannelType: 'SEARCH' }, campaignBudget: { resourceName: 'customers/1/campaignBudgets/9', amountMicros: String(w.campania.presupuestoMicros) } };
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
    let idGrupo = 950;
    for (const op of request.mutateOperations) {
      if ('campaignBudgetOperation' in op) {
        const o = op.campaignBudgetOperation as { create?: Record<string, unknown>; update?: Record<string, unknown> };
        if (o.create) w.campania.presupuestoMicros = Number(o.create.amountMicros);
        if (o.update) w.campania.presupuestoMicros = Number(o.update.amountMicros);
        results.push({ resourceName: 'customers/1/campaignBudgets/9' });
      } else if ('campaignOperation' in op) {
        const o = op.campaignOperation as { create?: Record<string, unknown>; update?: Record<string, unknown> };
        if (o.create) w.campania = { ...w.campania, nombre: String(o.create.name), estado: String(o.create.status) };
        if (o.update?.status) w.campania.estado = String(o.update.status);
        results.push({ resourceName: 'customers/1/campaigns/900' });
      } else if ('adGroupOperation' in op) {
        const o = op.adGroupOperation as { create?: Record<string, unknown> };
        const id = String((idGrupo += 1));
        if (o.create) w.grupos.push({ id, nombre: String(o.create.name), estado: String(o.create.status) });
        results.push({ resourceName: `customers/1/adGroups/${id}` });
      } else if ('adGroupAdOperation' in op) {
        results.push({ resourceName: 'customers/1/adGroupAds/950~1' });
      } else if ('adGroupCriterionOperation' in op) {
        const o = op.adGroupCriterionOperation as { create?: { keyword?: { text?: string } }; update?: { resourceName?: string; status?: string } };
        if (o.create?.keyword?.text) w.palabras.push({ criterionId: `k${w.palabras.length + 1}`, adGroupId: '951', texto: o.create.keyword.text, estado: 'ENABLED', metricas: { costMicros: 0, impressions: 0, clicks: 0, conversions: 0 } });
        if (o.update?.resourceName) {
          const id = o.update.resourceName.split('/').pop()?.split('~')[1];
          const k = w.palabras.find((x) => x.criterionId === id);
          if (k && o.update.status) k.estado = o.update.status;
        }
        results.push({ resourceName: 'customers/1/adGroupCriteria/951~1' });
      } else if ('campaignCriterionOperation' in op) {
        const o = op.campaignCriterionOperation as { create?: { negative?: boolean; keyword?: { text?: string } } };
        if (o.create?.negative === true && o.create.keyword?.text) w.negativas.push(o.create.keyword.text);
        results.push({ resourceName: 'customers/1/campaignCriteria/900~1' });
      }
    }
    return { ok: true, httpStatus: 200, requestId: 'req-e2e', validateOnly: false, operationCount: request.mutateOperations.length, resultsCount: results.length, errorStatus: null, errorCode: null, errorMessage: null, googleErrors: [], results, partialFailure: false as const };
  });

  const crearAccionDeConversion = vi.fn(async (_cid: string, spec: { nombre: string }) => {
    w.escrituras += 1;
    const id = String(700 + w.conversiones.length);
    w.conversiones.push({ id, nombre: spec.nombre });
    return { resourceName: `customers/1/conversionActions/${id}`, requestId: 'req-conv' };
  });

  return { mundo: w, cliente: { buscar, mutarGrafo, crearAccionDeConversion } as never, buscar, mutarGrafo };
}

const IDEAS: readonly IdeaDeTermino[] = [
  { termino: 'implante dental curico', semilla: null, metricas: { avgMonthlySearches: 320, competition: 'MEDIUM', competitionIndex: 45, lowTopOfPageBidMicros: 800_000_000, highTopOfPageBidMicros: 2_000_000_000 } },
  { termino: 'precio implante dental', semilla: null, metricas: { avgMonthlySearches: 210, competition: 'MEDIUM', competitionIndex: 40, lowTopOfPageBidMicros: 700_000_000, highTopOfPageBidMicros: 1_800_000_000 } },
  { termino: 'trabajo dentista curico', semilla: null, metricas: { avgMonthlySearches: 40, competition: 'LOW', competitionIndex: 10, lowTopOfPageBidMicros: null, highTopOfPageBidMicros: null } },
];
const GEOS: Record<string, GeoTargetResuelto> = {
  'Curicó': { solicitado: 'Curicó', disponible: true, targetId: '1000341', targetTipo: 'CITY', nombreCanonico: 'Curicó, Chile', aproximacion: false, riesgoDerrame: 'NONE' },
};
const pagina = (over: Partial<PaginaObservada>): PaginaObservada => ({
  ruta: '/', httpStatus: 200, titulo: 'Clínica QA Full', metaDescription: 'dental', h1: ['Clínica QA Full'], h2: [],
  ctas: ['agendar'], enlacesInternos: 4, canonical: null, indexable: true, tieneDatosEstructurados: true,
  viasDeContacto: ['whatsapp'], ...over,
});

function proveedores(opciones: { readonly sitioCaido?: boolean; readonly sinDemanda?: boolean } = {}): (org: string) => Promise<DepsInvestigacion> {
  return async () => ({
    ahora: () => AHORA,
    sitio: {
      nombre: 'sitio', fuente: 'WEBSITE_AUDIT',
      auditar: async (url: string): Promise<AuditoriaSitio> => (opciones.sitioCaido === true
        ? { url, alcanzable: false, paginas: [], paginasVisitadas: 0, paginasOmitidas: 0, error: 'el sitio no respondió', observadoEn: AHORA }
        : {
          url, alcanzable: true,
          paginas: [pagina({}), pagina({ ruta: '/implantes-dentales', titulo: 'Implantes dentales', h1: ['Implantes dentales'] })],
          paginasVisitadas: 2, paginasOmitidas: 0, error: null, observadoEn: AHORA,
        }),
    },
    geo: {
      nombre: 'geo', fuente: 'GOOGLE_ADS_GEO_TARGETS',
      resolver: async (nombres: readonly string[]) => nombres.map((n) => GEOS[n] ?? { solicitado: n, disponible: false, targetId: null, targetTipo: null, nombreCanonico: null, aproximacion: false, riesgoDerrame: 'UNKNOWN' as const }),
    },
    ...(opciones.sinDemanda === true ? {} : {
      demanda: {
        nombre: 'demanda', fuente: 'GOOGLE_ADS_KEYWORD_DATA',
        demanda: async () => ({ ideas: IDEAS, fuente: 'GOOGLE_ADS_KEYWORD_DATA' as const, observadoEn: AHORA, periodo: '12 meses' }),
      },
    }),
  });
}

// ── SESIÓN Y RUTAS (todo por la superficie real) ────────────────────────────────────────────────

function app(google: ReturnType<typeof googleSimulado>, opciones: { readonly eventos?: number; readonly investigacion?: (org: string) => Promise<DepsInvestigacion> } = {}) {
  return buildApp({
    store: new InMemoryEventStore(), intelligence: new DeterministicIntelligenceProvider(), pool, legacyDemoAccess: false,
    proveedoresInvestigacion: opciones.investigacion ?? proveedores(),
    ejecucionGoogle: async () => google.cliente,
    ejecucionObservarEventos: async () => ({ observados: opciones.eventos ?? 4, desde: AHORA }),
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
async function entrar(a: App, email: string): Promise<string> {
  return cookieDe(await a.inject({ method: 'POST', url: '/auth/login', headers: H, payload: { email, password: 'Password123' } }));
}
const h = (cookie: string, org: string) => ({ ...H, cookie, 'x-organization-slug': org });

const PASOS = [
  { paso: 'negocio', respuestas: { 'negocio.aQueSeDedica': 'Clínica dental en Curicó', 'negocio.tipo': 'CLINICA', 'negocio.tipoCliente': 'B2C', 'negocio.sitio': 'https://qa-full.example', 'negocio.pais': 'CL' } },
  { paso: 'oferta', respuestas: { 'oferta.queVendes': 'implantes dentales' } },
  { paso: 'territorio', respuestas: { 'territorio.donde': 'Curicó' } },
  { paso: 'objetivo', respuestas: { 'objetivo.queQuieres': 'nuevos-clientes', 'objetivo.enCuantoTiempo': 30 } },
  { paso: 'contacto', respuestas: { 'contacto.como': ['whatsapp'], 'contacto.principal': 'whatsapp' } },
  { paso: 'restricciones', respuestas: { 'restricciones.noPodemosAfirmar': 'no atendemos Fonasa' } },
  { paso: 'medicion', respuestas: { 'medicion.indicador': 'cantidad-contactos', 'medicion.conoceMeta': true, 'medicion.meta': 12, 'medicion.evidencia': 'prudente' } },
  { paso: 'presupuesto', respuestas: { 'presupuesto.modalidad': 'MONTHLY', 'presupuesto.monto': 300_000 } },
];
const MATERIAL = {
  ofertaSlug: 'implantes-dentales',
  titulares: ['Implantes dentales', 'Clínica en Curicó', 'Agenda tu evaluación'],
  descripciones: ['Rehabilitación oral con especialista.', 'Agenda tu hora por WhatsApp hoy mismo.'],
};

// ── 1. EL RECORRIDO COMPLETO ────────────────────────────────────────────────────────────────────

describe('Empresa QA Full Autonomy · de crear la empresa a optimizar la campaña', () => {
  it('recorre las 33 etapas por las rutas reales, reiniciando el proceso entre fases', async () => {
    // Un término NUEVO (no estaba en la investigación, así que el plan no lo excluyó todavía).
    const g = googleSimulado({ terminos: [{ termino: 'curso de implantes dentales', metricas: { costMicros: 3_000_000_000, impressions: 200, clicks: 8, conversions: 0 } }] });

    // ── ETAPAS 1-2 · ALTA Y PROPIEDAD ──
    let a = app(g);
    const cookie0 = await registrar(a, 'duena-full@soec.cl');
    const alta = await a.inject({ method: 'POST', url: '/negocios', headers: { ...H, cookie: cookie0 }, payload: { displayName: 'Empresa QA Full Autonomy', businessType: 'CLINICA', country: 'CL', currency: 'CLP', timezone: 'America/Santiago' } });
    expect(alta.statusCode, alta.body).toBe(201);
    const org = alta.json().perfil.organizationId as string;
    const { rows: membresia } = await pool.query(
      `select m.role from identity_memberships m join identity_organizations o on o.id = m.organization_id where o.slug = $1`, [org]);
    expect(membresia[0].role).toBe('OWNER'); // quien crea la empresa es su dueña, sin pasos extra
    await a.close();

    // ── REINICIO 1 · el recorrido continúa desde PostgreSQL, no desde la memoria del proceso ──
    a = app(g);
    const cookie = await entrar(a, 'duena-full@soec.cl');

    // ── ETAPAS 3-9 · ASISTENTE: oferta, territorio, restricciones, objetivo, conversiones, política ──
    for (const p of PASOS) {
      const r = await a.inject({ method: 'PATCH', url: '/onboarding', headers: h(cookie, org), payload: { paso: p.paso, respuestas: p.respuestas, avanzar: true } });
      expect(r.statusCode, `${p.paso}: ${r.body}`).toBe(200);
    }
    const negocios = new RepositorioNegocios(pool);
    expect((await negocios.oferta(org)).map((o) => o.slug)).toContain('implantes-dentales');
    expect((await negocios.territorios(org)).find((t) => t.ambito === 'BUSINESS')?.localities).toEqual(['Curicó']);
    expect((await negocios.restricciones(org)).some((r) => r.tipo === 'PROHIBITED_CLAIM')).toBe(true);
    const politicaInicial = await a.inject({ method: 'GET', url: '/politica', headers: h(cookie, org) });
    expect(politicaInicial.json().politica.eventos[0].eventKey).toBe('whatsapp_intent');

    // Criterios de evaluación de la empresa (lo que después gobierna al optimizador).
    const pol = await a.inject({
      method: 'PATCH', url: '/politica', headers: h(cookie, org),
      payload: { reglas: [
        { tipo: 'PAUSE', metrica: 'SPEND', comparador: 'GTE', valor: 30_000, procedencia: 'USER_DEFINED' },
        { tipo: 'SUCCESS', metrica: 'COST_PER_CONVERSION', comparador: 'LTE', valor: 25_000, procedencia: 'USER_DEFINED' },
      ] },
    });
    expect(pol.statusCode, pol.body).toBe(200);

    // ── ETAPAS 10-13 · CONEXIONES, CAPACIDADES, LÍMITES FINANCIEROS Y GOBIERNO ──
    const conexiones = new RepositorioConexiones(pool);
    await conexiones.guardar(pool, {
      organizationId: org, provider: 'GOOGLE_ADS', id: `${org}:GOOGLE_ADS`, estado: 'CONNECTED',
      configuracion: { customerId: '1234567890', loginCustomerId: '1234567890' }, externalAccountId: '1234567890',
      loginAccountId: '1234567890', secretRef: null, validadaEn: AHORA, ultimoError: null, origen: 'UI',
    });
    const cx = await a.inject({ method: 'GET', url: '/conexiones', headers: h(cookie, org) });
    expect(cx.statusCode).toBe(200);
    // La escritura es un acto explícito: conectar no la concede.
    const capSinPermiso = (cx.json().capacidades as Vista[]).find((c) => c.capacidad === 'ESCRITURA_ADS');
    expect(capSinPermiso?.habilitada ?? false).toBe(false);
    const lectura = await a.inject({ method: 'PATCH', url: '/capacidades', headers: h(cookie, org), payload: { capacidad: 'MEDICION_REAL', habilitada: true } });
    expect([200, 201, 204], lectura.body).toContain(lectura.statusCode);
    const permiso = await a.inject({ method: 'PATCH', url: '/capacidades', headers: h(cookie, org), payload: { capacidad: 'ESCRITURA_ADS', habilitada: true } });
    expect([200, 201, 204], permiso.body).toContain(permiso.statusCode);
    await a.inject({ method: 'PATCH', url: `/organizations/${org}/operational-mode`, headers: { ...H, cookie }, payload: { mode: 'SUPERVISED_REAL' } });
    const gob = await a.inject({ method: 'PATCH', url: `/negocios/${org}/gobierno`, headers: h(cookie, org), payload: { externalMutations: true, campaignExecution: true } });
    expect(gob.statusCode, gob.body).toBe(200);
    expect(gob.json().gobierno.autonomousSpend).toBe(false);
    const mandato = await a.inject({
      method: 'POST', url: '/acquisition/action/mandate', headers: h(cookie, org),
      payload: { objective: 'captar pacientes', currency: 'CLP', authorizedBudgetMinor: 900_000, periodStart: MANDATO_DESDE, periodEnd: MANDATO_HASTA, allowedMetaAssets: [], allowedActionTypes: ['CREATE_CAMPAIGN'] },
    });
    expect(mandato.statusCode, mandato.body).toBe(201);
    await a.close();

    // ── REINICIO 2 (durante la investigación) ──
    a = app(g);

    // ── ETAPAS 14-16 · INVESTIGACIÓN, HALLAZGOS Y PLAN ──
    const inv = await a.inject({ method: 'POST', url: '/investigacion', headers: h(cookie, org), payload: {} });
    expect(inv.statusCode, inv.body).toBe(200);
    const investigacion = inv.json() as Vista;
    expect(['COMPLETE', 'PARTIAL']).toContain(investigacion.corrida.estado);
    expect((investigacion.hallazgos as Vista[]).length).toBeGreaterThan(0);
    // El territorio que la investigación confirmó es el que más tarde consume la ejecución.
    expect((investigacion.geos as Vista[]).map((g) => g.targetId)).toContain('1000341');
    // Lo que la empresa declaró que no puede afirmar llega hasta la clasificación de términos.
    expect((investigacion.terminos as Vista[]).some((t) => t.elegibilidad === 'EXCLUDED')).toBe(true);

    const planResp = await a.inject({ method: 'POST', url: '/plan', headers: h(cookie, org), payload: {} });
    expect(planResp.statusCode, planResp.body).toBe(200);
    const plan = (planResp.json() as Vista).plan;
    expect(plan.researchRunId).toBe(investigacion.corrida.id); // el plan apunta a SU investigación
    expect(plan.estado).toBe('NON_EXECUTABLE'); // todavía faltan anuncios y medición

    // ── ETAPAS 17-19 · ANUNCIOS APROBADOS, CONVERSIÓN EXTERNA Y MEDICIÓN VERIFICADA ──
    expect((await a.inject({ method: 'POST', url: '/campana/material', headers: h(cookie, org), payload: MATERIAL })).statusCode).toBe(200);
    expect((await a.inject({ method: 'POST', url: '/campana/medicion', headers: h(cookie, org), payload: {} })).statusCode).toBe(200);
    expect(g.mundo.conversiones).toHaveLength(1);
    const medicion = await a.inject({ method: 'PATCH', url: '/campana/medicion', headers: h(cookie, org), payload: { eventKey: 'whatsapp_intent', accion: 'VERIFICAR' } });
    expect((medicion.json() as Vista).medicion[0].estado).toBe('VERIFIED');
    await a.close();

    // ── REINICIO 3 (antes de preparar la ejecución) ──
    a = app(g);

    // ── ETAPAS 20-24 · PETICIÓN, AUTORIZACIÓN HUMANA, MATERIALIZACIÓN Y RECONCILIACIÓN ──
    const prep = await a.inject({ method: 'POST', url: '/campana/ejecucion/preparar', headers: h(cookie, org), payload: {} });
    const peticion = (prep.json() as Vista).peticion;
    expect((prep.json() as Vista).puedeEjecutar, JSON.stringify(((prep.json() as Vista).prerrequisitos as Vista[]).filter((r) => r.veredicto !== 'PASS'))).toBe(true);
    // El paquete congelado consume el territorio de la investigación y las palabras del plan.
    expect(peticion.paquete.campania.geo[0].criterionId).toBe('1000341');
    expect(peticion.paquete.grupos[0].palabras.length).toBeGreaterThan(0);

    const autorizada = await a.inject({ method: 'POST', url: `/campana/ejecucion/${peticion.id}/autorizar`, headers: h(cookie, org), payload: {} });
    expect(autorizada.json().peticion.autorizacion.accion).toBe('CREAR_CAMPANA_EN_PAUSA');
    const ejecutada = await a.inject({ method: 'POST', url: `/campana/ejecucion/${peticion.id}/ejecutar`, headers: h(cookie, org), payload: {} });
    const tras = ejecutada.json() as Vista;
    expect(tras.peticion.estado).toBe('CREATED_PAUSED');
    expect(tras.peticion.reconciliacion.coincide).toBe(true);
    expect(g.mundo.campania.estado).toBe('PAUSED');
    expect(g.mundo.grupos.every((x) => x.estado === 'PAUSED')).toBe(true);
    await a.close();

    // ── REINICIO 4 (tras la escritura externa) ──
    a = app(g);

    // ── ETAPAS 25-26 · AUTORIZACIÓN DE ACTIVACIÓN Y ENCENDIDO ──
    const activada = await a.inject({ method: 'POST', url: '/optimizacion/activar', headers: h(cookie, org), payload: {} });
    expect(activada.statusCode, activada.body).toBe(200);
    expect(g.mundo.campania.estado).toBe('ENABLED');

    // La campaña ya sirve: ahora hay datos que observar.
    g.mundo.metricas = { costMicros: 45_000_000_000, impressions: 6_000, clicks: 240, conversions: 2 };
    g.mundo.palabras = g.mundo.palabras.map((k) => ({ ...k, metricas: { costMicros: 20_000_000_000, impressions: 3_000, clicks: 120, conversions: 1 } }));
    await a.close();

    // ── REINICIO 5 (antes de la optimización) ──
    a = app(g);

    // ── LÍMITES DE AUTONOMÍA: qué puede hacer SOEC sola (el cuánto sigue en el mandato) ──
    const limites = await a.inject({
      method: 'PATCH', url: '/optimizacion/politica', headers: h(cookie, org),
      payload: { accionesPermitidas: ['PAUSE_CAMPAIGN', 'ADD_NEGATIVE_KEYWORD', 'ADJUST_DAILY_BUDGET'], maxCambioPresupuestoPct: 10, maxCambiosPorDia: 2, cooldownHoras: 1 },
    });
    expect(limites.statusCode, limites.body).toBe(200);
    expect((limites.json() as Vista).politica.activacionAutonomaPermitida).toBe(false);

    // ── ETAPAS 27-33 · OBSERVAR, EVIDENCIA, DECIDIR, APROBAR, MUTAR, VERIFICAR Y APRENDER ──
    const ciclo = await a.inject({ method: 'POST', url: '/optimizacion/ciclo', headers: h(cookie, org), payload: {} });
    expect(ciclo.statusCode, ciclo.body).toBe(200);
    const vistaCiclo = ciclo.json() as Vista;
    expect(vistaCiclo.snapshot.campania.clicks).toBe(240);
    expect(vistaCiclo.evidencia.veredicto).toBe('SUFFICIENT');
    expect((vistaCiclo.decisiones as Vista[]).length).toBeGreaterThan(0);
    const pendiente = (vistaCiclo.pendientes as Vista[])[0];
    if (pendiente === undefined) throw new Error(`el ciclo no propuso nada que aprobar: ${JSON.stringify(vistaCiclo.ciclo)}`);

    const aprobada = await a.inject({ method: 'POST', url: `/optimizacion/pendientes/${pendiente.id}`, headers: h(cookie, org), payload: { decision: 'APROBAR' } });
    expect(aprobada.statusCode, aprobada.body).toBe(200);
    const final = aprobada.json() as Vista;
    const aplicada = (final.aplicadas as Vista[]).find((x) => x.resultado === 'APPLIED');
    expect(aplicada, JSON.stringify(final.aplicadas)).toBeDefined();
    expect(aplicada!.verificacion).toBe('VERIFIED');
    expect((final.aprendizajes as Vista[]).map((x) => x.resultado)).toContain('NOT_ENOUGH_TIME');

    // ── LÍMITES DEL RECORRIDO: nadie gastó de más, nadie encendió nada por su cuenta ──
    const gobiernoFinal = await negocios.gobierno(org);
    expect(gobiernoFinal?.autonomousSpend).toBe(false);
    const { rows: mandatoFinal } = await pool.query('select spent_minor, authorized_budget_minor from accion_mandato where organization_id = $1', [org]);
    expect(Number(mandatoFinal[0].spent_minor)).toBeLessThanOrEqual(Number(mandatoFinal[0].authorized_budget_minor));

    // ── SIN DEPENDENCIA DEL REGISTRO HISTÓRICO ──
    const legado = estadoDeCompatibilidadLegado();
    const suyo = legado.organizaciones.find((u) => u.org === org);
    expect(suyo?.usos ?? 0, 'una empresa nueva no debería caer nunca al registro histórico').toBe(0);
    await a.close();
  });

  it('LINAJE: desde la última decisión se reconstruye toda la historia, sin huérfanos', async () => {
    // Un término NUEVO (no estaba en la investigación, así que el plan no lo excluyó todavía).
    const g = googleSimulado({ terminos: [{ termino: 'curso de implantes dentales', metricas: { costMicros: 3_000_000_000, impressions: 200, clicks: 8, conversions: 0 } }] });
    const a = app(g);
    const { cookie, org } = await recorridoCompleto(a, g, 'duena-linaje@soec.cl', 'Empresa QA Linaje');

    // Punto de partida: la acción aplicada.
    const { rows: acciones } = await pool.query('select * from optimization_action_log where organization_id = $1 order by aplicado_en desc limit 1', [org]);
    expect(acciones).toHaveLength(1);
    const accion = acciones[0] as Record<string, string>;

    // acción → decisión → ciclo → snapshot
    const { rows: decision } = await pool.query('select * from optimization_decision where organization_id = $1 and id = $2', [org, accion.decision_id]);
    expect(decision).toHaveLength(1);
    const { rows: ciclo } = await pool.query('select * from optimization_cycle where organization_id = $1 and id = $2', [org, (decision[0] as Record<string, string>).ciclo_id]);
    expect(ciclo).toHaveLength(1);
    const cicloFila = ciclo[0] as Record<string, string>;
    const { rows: snapshot } = await pool.query('select * from observation_snapshot where organization_id = $1 and id = $2', [org, cicloFila.snapshot_id]);
    expect(snapshot).toHaveLength(1);

    // ciclo → campaña → petición de ejecución → plan → investigación
    const campaignId = (snapshot[0] as Record<string, string>).campaign_id;
    const { rows: peticion } = await pool.query('select * from campaign_execution_request where organization_id = $1', [org]);
    expect(peticion).toHaveLength(1);
    const peticionFila = peticion[0] as Record<string, unknown>;
    expect(String((peticionFila.recursos_externos as { campaigns?: string[] }).campaigns?.[0])).toContain(campaignId);

    const { rows: plan } = await pool.query('select * from campaign_plan where organization_id = $1 and id = $2', [org, peticionFila.plan_id]);
    expect(plan).toHaveLength(1);
    const { rows: corrida } = await pool.query('select * from research_run where organization_id = $1 and id = $2', [org, (plan[0] as Record<string, string>).research_run_id]);
    expect(corrida).toHaveLength(1);

    // investigación → política → asistente → perfil de la empresa
    const { rows: politica } = await pool.query('select * from business_evaluation_policy where organization_id = $1', [org]);
    expect(politica).toHaveLength(1);
    const { rows: onboarding } = await pool.query('select * from business_onboarding where organization_id = $1', [org]);
    expect(onboarding).toHaveLength(1);
    const { rows: perfil } = await pool.query('select * from business_profile where organization_id = $1', [org]);
    expect(perfil).toHaveLength(1);

    // NINGÚN HUÉRFANO: todo lo persistido para esta empresa pertenece a su organización.
    for (const tabla of ['research_run', 'campaign_plan', 'campaign_execution_request', 'optimization_cycle', 'observation_snapshot', 'optimization_decision', 'optimization_action_log', 'learning_outcome', 'conversion_action_mapping', 'tracking_state', 'creative_asset']) {
      const { rows } = await pool.query(`select count(*)::int as n from ${tabla} where organization_id <> $1`, [org]);
      expect(rows[0].n, `${tabla} tiene filas de otra organización`).toBe(0);
    }
    // Y cada registro de aprendizaje apunta a una decisión que existe.
    const { rows: huerfanos } = await pool.query(
      `select count(*)::int as n from learning_outcome l
       left join optimization_decision d on d.organization_id = l.organization_id and d.id = l.decision_id
       where l.organization_id = $1 and d.id is null`, [org]);
    expect(huerfanos[0].n).toBe(0);
    await a.close();
  });
});

/** Recorrido completo reutilizable: deja la empresa con campaña encendida y una acción aplicada. */
async function recorridoCompleto(a: App, g: ReturnType<typeof googleSimulado>, email: string, nombre: string): Promise<{ cookie: string; org: string }> {
  const cookie = await registrar(a, email);
  const alta = await a.inject({ method: 'POST', url: '/negocios', headers: { ...H, cookie }, payload: { displayName: nombre, businessType: 'CLINICA', country: 'CL', currency: 'CLP', timezone: 'America/Santiago' } });
  const org = alta.json().perfil.organizationId as string;
  for (const p of PASOS) await a.inject({ method: 'PATCH', url: '/onboarding', headers: h(cookie, org), payload: { paso: p.paso, respuestas: p.respuestas, avanzar: true } });
  await a.inject({ method: 'PATCH', url: '/politica', headers: h(cookie, org), payload: { reglas: [
    { tipo: 'PAUSE', metrica: 'SPEND', comparador: 'GTE', valor: 30_000, procedencia: 'USER_DEFINED' },
    { tipo: 'SUCCESS', metrica: 'COST_PER_CONVERSION', comparador: 'LTE', valor: 25_000, procedencia: 'USER_DEFINED' },
  ] } });
  const conexiones = new RepositorioConexiones(pool);
  await conexiones.guardar(pool, {
    organizationId: org, provider: 'GOOGLE_ADS', id: `${org}:GOOGLE_ADS`, estado: 'CONNECTED',
    configuracion: { customerId: '1234567890', loginCustomerId: '1234567890' }, externalAccountId: '1234567890',
    loginAccountId: '1234567890', secretRef: null, validadaEn: AHORA, ultimoError: null, origen: 'UI',
  });
  await a.inject({ method: 'PATCH', url: '/capacidades', headers: h(cookie, org), payload: { capacidad: 'MEDICION_REAL', habilitada: true } });
  await a.inject({ method: 'PATCH', url: '/capacidades', headers: h(cookie, org), payload: { capacidad: 'ESCRITURA_ADS', habilitada: true } });
  await a.inject({ method: 'PATCH', url: `/organizations/${org}/operational-mode`, headers: { ...H, cookie }, payload: { mode: 'SUPERVISED_REAL' } });
  await a.inject({ method: 'PATCH', url: `/negocios/${org}/gobierno`, headers: h(cookie, org), payload: { externalMutations: true, campaignExecution: true } });
  await a.inject({ method: 'POST', url: '/acquisition/action/mandate', headers: h(cookie, org), payload: { objective: 'captar', currency: 'CLP', authorizedBudgetMinor: 900_000, periodStart: MANDATO_DESDE, periodEnd: MANDATO_HASTA, allowedMetaAssets: [], allowedActionTypes: ['CREATE_CAMPAIGN'] } });
  await a.inject({ method: 'POST', url: '/investigacion', headers: h(cookie, org), payload: {} });
  await a.inject({ method: 'POST', url: '/plan', headers: h(cookie, org), payload: {} });
  await a.inject({ method: 'POST', url: '/campana/material', headers: h(cookie, org), payload: MATERIAL });
  await a.inject({ method: 'POST', url: '/campana/medicion', headers: h(cookie, org), payload: {} });
  await a.inject({ method: 'PATCH', url: '/campana/medicion', headers: h(cookie, org), payload: { eventKey: 'whatsapp_intent', accion: 'VERIFICAR' } });
  const prep = await a.inject({ method: 'POST', url: '/campana/ejecucion/preparar', headers: h(cookie, org), payload: {} });
  const peticion = (prep.json() as Vista).peticion;
  await a.inject({ method: 'POST', url: `/campana/ejecucion/${peticion.id}/autorizar`, headers: h(cookie, org), payload: {} });
  await a.inject({ method: 'POST', url: `/campana/ejecucion/${peticion.id}/ejecutar`, headers: h(cookie, org), payload: {} });
  await a.inject({ method: 'POST', url: '/optimizacion/activar', headers: h(cookie, org), payload: {} });
  await a.inject({ method: 'PATCH', url: '/optimizacion/politica', headers: h(cookie, org), payload: { accionesPermitidas: ['PAUSE_CAMPAIGN', 'ADD_NEGATIVE_KEYWORD', 'ADJUST_DAILY_BUDGET'], maxCambioPresupuestoPct: 10, maxCambiosPorDia: 2, cooldownHoras: 1 } });
  g.mundo.metricas = { costMicros: 45_000_000_000, impressions: 6_000, clicks: 240, conversions: 2 };
  const ciclo = await a.inject({ method: 'POST', url: '/optimizacion/ciclo', headers: h(cookie, org), payload: {} });
  const pendiente = ((ciclo.json() as Vista).pendientes as Vista[])[0];
  if (pendiente !== undefined) {
    await a.inject({ method: 'POST', url: `/optimizacion/pendientes/${pendiente.id}`, headers: h(cookie, org), payload: { decision: 'APROBAR' } });
  }
  return { cookie, org };
}

// ── 2. AISLAMIENTO ENTRE EMPRESAS, CON IDENTIFICADORES VÁLIDOS ──────────────────────────────────

describe('Empresa QA Neighbor · el vecino no puede tocar nada', () => {
  it('con identificadores REALES de la otra empresa, todas las etapas responden 403/404', async () => {
    // Un término NUEVO (no estaba en la investigación, así que el plan no lo excluyó todavía).
    const g = googleSimulado({ terminos: [{ termino: 'curso de implantes dentales', metricas: { costMicros: 3_000_000_000, impressions: 200, clicks: 8, conversions: 0 } }] });
    const a = app(g);
    const { org: orgA } = await recorridoCompleto(a, g, 'duena-vecina-a@soec.cl', 'Empresa QA Full Autonomy');

    // Identificadores REALES de A: el vecino los conoce y aun así no puede usarlos.
    const { rows: pet } = await pool.query('select id from campaign_execution_request where organization_id = $1', [orgA]);
    const { rows: pend } = await pool.query('select id from pending_marketing_action where organization_id = $1 limit 1', [orgA]);
    const idPeticion = (pet[0] as { id: string }).id;
    const idPendiente = (pend[0] as { id: string } | undefined)?.id ?? 'pend-inexistente';

    const cookieB = await registrar(a, 'dueno-vecino-b@soec.cl');
    const altaB = await a.inject({ method: 'POST', url: '/negocios', headers: { ...H, cookie: cookieB }, payload: { displayName: 'Empresa QA Neighbor', businessType: 'SERVICIOS', country: 'CL', currency: 'CLP', timezone: 'America/Santiago' } });
    const orgB = altaB.json().perfil.organizationId as string;

    const rutas: ReadonlyArray<{ metodo: 'GET' | 'POST' | 'PATCH'; url: string }> = [
      { metodo: 'GET', url: '/onboarding' },
      { metodo: 'GET', url: '/politica' },
      { metodo: 'GET', url: '/conexiones' },
      { metodo: 'GET', url: '/investigacion' },
      { metodo: 'POST', url: '/investigacion' },
      { metodo: 'GET', url: '/plan' },
      { metodo: 'POST', url: '/plan' },
      { metodo: 'GET', url: '/campana/ejecucion' },
      { metodo: 'POST', url: '/campana/ejecucion/preparar' },
      { metodo: 'POST', url: `/campana/ejecucion/${idPeticion}/autorizar` },
      { metodo: 'POST', url: `/campana/ejecucion/${idPeticion}/ejecutar` },
      { metodo: 'GET', url: `/campana/ejecucion/${idPeticion}/libro` },
      { metodo: 'GET', url: '/optimizacion' },
      { metodo: 'POST', url: '/optimizacion/ciclo' },
      { metodo: 'POST', url: '/optimizacion/activar' },
      { metodo: 'PATCH', url: '/optimizacion/politica' },
      { metodo: 'PATCH', url: '/capacidades' },
      { metodo: 'POST', url: `/optimizacion/pendientes/${idPendiente}` },
    ];
    for (const r of rutas) {
      const res = await a.inject({ method: r.metodo, url: r.url, headers: h(cookieB, orgA), payload: { decision: 'APROBAR' } });
      expect([403, 404], `${r.metodo} ${r.url} con la org de otro → ${res.statusCode}`).toContain(res.statusCode);
    }

    // Y desde SU PROPIA organización, los identificadores del vecino tampoco sirven.
    const conSuOrg = await a.inject({ method: 'POST', url: `/campana/ejecucion/${idPeticion}/ejecutar`, headers: h(cookieB, orgB), payload: {} });
    expect(conSuOrg.statusCode).toBe(404);
    const pendienteAjeno = await a.inject({ method: 'POST', url: `/optimizacion/pendientes/${idPendiente}`, headers: h(cookieB, orgB), payload: { decision: 'APROBAR' } });
    expect([404, 409]).toContain(pendienteAjeno.statusCode);

    // Nada del vecino quedó creado, y nada de A cambió.
    for (const tabla of ['research_run', 'campaign_plan', 'campaign_execution_request', 'optimization_cycle']) {
      const { rows } = await pool.query(`select count(*)::int as n from ${tabla} where organization_id = $1`, [orgB]);
      expect(rows[0].n, tabla).toBe(0);
    }
    expect(g.mundo.campania.estado).toBe('ENABLED'); // la campaña de A sigue como estaba
    await a.close();
  });
});

// ── 3. FUENTE ÚNICA DE VERDAD Y DEPENDENCIA DEL REGISTRO ────────────────────────────────────────

describe('inventario de la verdad para una empresa nueva', () => {
  it('todo vive en PostgreSQL y no hace falta el registro histórico', async () => {
    const g = googleSimulado();
    const a = app(g);
    const { org } = await recorridoCompleto(a, g, 'duena-ssot@soec.cl', 'Empresa QA SSOT');

    const tablas: ReadonlyArray<[string, string]> = [
      ['perfil del negocio', 'business_profile'],
      ['oferta', 'business_offering'],
      ['territorio', 'business_geo_scope'],
      ['restricciones', 'business_restriction'],
      ['gobierno', 'business_governance'],
      ['conexiones', 'business_connection'],
      ['capacidades', 'business_capability'],
      ['política de evaluación', 'business_evaluation_policy'],
      ['investigación', 'research_run'],
      ['plan', 'campaign_plan'],
      ['ejecución', 'campaign_execution_request'],
      ['conversiones externas', 'conversion_action_mapping'],
      ['medición', 'tracking_state'],
      ['mandato financiero', 'accion_mandato'],
      ['optimización', 'optimization_cycle'],
    ];
    for (const [que, tabla] of tablas) {
      const { rows } = await pool.query(`select count(*)::int as n from ${tabla} where organization_id = $1`, [org]);
      expect(rows[0].n, `${que} debería vivir en ${tabla}`).toBeGreaterThan(0);
    }

    // CERO caídas al registro histórico para una empresa nueva.
    const legado = estadoDeCompatibilidadLegado();
    const suyo = legado.organizaciones.find((u) => u.org === org);
    expect(suyo?.usos ?? 0).toBe(0);
    expect(suyo?.camposDelRegistro ?? []).toEqual([]);
    await a.close();
  });

  /**
   * El informe de PREPARACIÓN COMERCIAL leído por su ruta real. Se comprueba las dos direcciones en la misma
   * prueba: la empresa que recorrió todo sale lista, y una recién dada de alta no sale lista en NADA — porque
   * el informe lee lo persistido y no rellena nada para verse verde.
   */
  it('informe de preparación comercial · dice la verdad de una empresa completa y de una vacía', async () => {
    const g = googleSimulado();
    const a = app(g);
    const { cookie, org } = await recorridoCompleto(a, g, 'duena-preparacion@soec.cl', 'Empresa QA Preparacion');

    const r = await a.inject({ method: 'GET', url: '/aceptacion/preparacion', headers: h(cookie, org) });
    expect(r.statusCode, r.body).toBe(200);
    const p = (r.json() as Vista).preparacion;
    expect((p.items as Vista[])).toHaveLength(18);
    const pendientes = (p.items as Vista[]).filter((x) => x.estado !== 'READY' && x.estado !== 'OPTIONAL');
    expect(pendientes.map((x) => `${x.item}:${x.estado}:${x.observado}`)).toEqual([]);
    expect((p.hitos as Vista[]).find((x) => x.hito === 'CREAR_CAMPANA')?.listo).toBe(true);
    expect((p.hitos as Vista[]).find((x) => x.hito === 'ENCENDER_CAMPANA')?.listo).toBe(true);
    // La autonomía nunca se concede por haber llegado hasta aquí.
    expect((p.hitos as Vista[]).find((x) => x.hito === 'OPERAR_CON_AUTONOMIA')?.listo).toBe(false);

    // Una empresa recién creada, sin tocarle nada.
    const cookieVacia = await registrar(a, 'duena-vacia@soec.cl');
    const alta = await a.inject({ method: 'POST', url: '/negocios', headers: { ...H, cookie: cookieVacia }, payload: { displayName: 'Empresa QA Vacia', businessType: 'CLINICA', country: 'CL', currency: 'CLP', timezone: 'America/Santiago' } });
    const orgVacia = alta.json().perfil.organizationId as string;
    const rv = await a.inject({ method: 'GET', url: '/aceptacion/preparacion', headers: h(cookieVacia, orgVacia) });
    expect(rv.statusCode, rv.body).toBe(200);
    const pv = (rv.json() as Vista).preparacion;
    expect((pv.hitos as Vista[]).every((x) => x.listo === false)).toBe(true);
    expect(pv.siguienteAccion.de).toBe('LA_EMPRESA');
    // Y leer el informe no creó ni cambió nada de esa empresa.
    for (const tabla of ['research_run', 'campaign_plan', 'campaign_execution_request', 'conversion_action_mapping', 'accion_mandato']) {
      const { rows } = await pool.query(`select count(*)::int as n from ${tabla} where organization_id = $1`, [orgVacia]);
      expect(rows[0].n, tabla).toBe(0);
    }
    await a.close();
  });
});
