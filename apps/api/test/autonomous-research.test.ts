/**
 * Autonomy Fase E · INVESTIGACIÓN AUTÓNOMA Y PLANIFICACIÓN — pruebas deterministas (sin base, sin red).
 *
 * Lo que se demuestra aquí es exactamente lo que el producto promete:
 *  1. la intención se clasifica con reglas auditables: «precio implante dental» es intención COMERCIAL, no basura;
 *  2. un candidato a negativa NO es una negativa activa, y una restricción que nadie persistió no se asume;
 *  3. el rastreo del propio sitio tiene presupuesto y defensas: ni http, ni direcciones internas, ni terceros;
 *  4. los veredictos por canal son estados con motivos, nunca una nota del 1 al 10, y «faltan datos» es válido;
 *  5. demanda ≠ recomendación: con demanda observada pero sin landing, sin medición o sin techo, el canal es
 *     `POSSIBLE`, no `SUITABLE`;
 *  6. el planificador es DETERMINISTA, no inventa presupuesto, no propone concordancia amplia sin justificación
 *     y nunca deja un plan ejecutable: sin anuncios escritos y sin conversión verificada, `EXECUTION_READY=false`;
 *  7. el gobierno de cuota existe: una misma consulta en vuelo se comparte y su resultado se reutiliza.
 */
import { describe, expect, it, vi } from 'vitest';
import { clasificarIntencion, evaluarTermino, terminosDeRestriccion, type ContextoClasificacion } from '../src/investigacion/intencion';
import { demandaRelevante, evaluarCanales, evaluarLandings, derivarHallazgos, veredictoDe, type ContextoAnalisis } from '../src/investigacion/analisis';
import { auditarSitio } from '../src/investigacion/sitio-auditoria';
import { planificar, type EntradaPlanificador } from '../src/investigacion/planificador';
import { CoordinadorDeConsultas } from '../src/investigacion/google-providers';
import { PRESUPUESTO_RASTREO_POR_DEFECTO, competidoresSinFuente, demandaNoDisponible, geoNoDisponible, type AuditoriaSitio, type PaginaObservada } from '../src/investigacion/proveedores';
import type { GeoEjecutable, TerminoInvestigado } from '../src/investigacion/investigacion-pg';
import type { OfertaNegocio, PerfilNegocio, RestriccionNegocio } from '../src/negocio/negocio-pg';
import type { PoliticaCompleta } from '../src/politica/politica-pg';

const ORG = 'empresa-qa-research';
const AHORA = '2026-09-21T12:00:00.000Z';
const RUN = 'run-2026-09-21-aaaaaaaa';

// ── Fixtures mínimos ────────────────────────────────────────────────────────────────────────────

const perfil = (over: Partial<PerfilNegocio> = {}): PerfilNegocio => ({
  organizationId: ORG, businessKey: 'bk', displayName: 'Clínica QA', legalName: null, businessType: 'SERVICIOS',
  description: null, website: 'https://clinica-qa.example/', country: 'CL', currency: 'CLP',
  timezone: 'America/Santiago', language: 'es', customerType: 'B2C', primaryObjective: 'conseguir más pacientes',
  status: 'ACTIVE', origen: 'UI', createdAt: AHORA, updatedAt: AHORA, ...over,
});

const oferta = (slug: string, name: string, over: Partial<OfertaNegocio> = {}): OfertaNegocio => ({
  organizationId: ORG, id: `of-${slug}`, slug, name, description: null, category: null, status: 'ACTIVE',
  landingUrl: null, priority: 1, geographicScope: null, advertisingEligibility: 'ELIGIBLE', restrictions: [], ...over,
});

const restriccion = (texto: string, tipo: RestriccionNegocio['tipo'] = 'PROHIBITED_CLAIM'): RestriccionNegocio =>
  ({ organizationId: ORG, id: `r-${texto.slice(0, 8)}`, tipo, texto, alcance: null });

const termino = (t: string, over: Partial<TerminoInvestigado> = {}): TerminoInvestigado => ({
  organizationId: ORG, id: `kw-${t.replace(/\s/g, '-')}`, runId: RUN, termino: t, terminoNormalizado: t,
  intencion: 'COMMERCIAL', intencionMetodo: 'RULES_V1', intencionConfianza: 'HIGH', intencionEvidencia: 'prueba',
  ofertaSlug: 'implantes', geografia: 'Curicó', idioma: 'es',
  // Micros de la plataforma: 1 CLP = 1.000.000 micros, así que un clic de ~2.000 CLP son 2.000.000.000.
  metricas: { avgMonthlySearches: 100, competition: 'MEDIUM', competitionIndex: 50, lowTopOfPageBidMicros: 800_000_000, highTopOfPageBidMicros: 2_000_000_000 },
  clase: 'OBSERVED', fuente: 'GOOGLE_ADS_KEYWORD_DATA', elegibilidad: 'CANDIDATE', motivoExclusion: null,
  observadoEn: AHORA, ...over,
});

const geo = (nombre: string, over: Partial<GeoEjecutable> = {}): GeoEjecutable => ({
  organizationId: ORG, id: `geo-${nombre}`, runId: RUN, solicitado: nombre, disponible: true, targetId: '1000123',
  targetTipo: 'CITY', nombreCanonico: nombre, aproximacion: false, riesgoDerrame: 'NONE', ...over,
});

const pagina = (over: Partial<PaginaObservada> = {}): PaginaObservada => ({
  ruta: '/', httpStatus: 200, titulo: 'Clínica QA', metaDescription: 'atención dental', h1: ['Clínica QA'], h2: [],
  ctas: ['agendar'], enlacesInternos: 4, canonical: null, indexable: true, tieneDatosEstructurados: false,
  viasDeContacto: ['whatsapp'], ...over,
});

const auditoria = (paginas: readonly PaginaObservada[]): AuditoriaSitio => ({
  url: 'https://clinica-qa.example/', alcanzable: true, paginas, paginasVisitadas: paginas.length,
  paginasOmitidas: 0, error: null, observadoEn: AHORA,
});

const politicaVacia: PoliticaCompleta = { politica: null, kpis: [], eventos: [], reglas: [], limites: null, canales: [] };

const politicaCon = (eventos: readonly string[], canales: readonly { canal: string; modo: string }[] = []): PoliticaCompleta => ({
  ...politicaVacia,
  eventos: eventos.map((eventKey, orden) => ({
    organizationId: ORG, eventKey, rol: 'PRIMARY' as const, orden, displayName: null, nota: null,
  })),
  canales: canales.map((c) => ({ organizationId: ORG, canal: c.canal, modo: c.modo as 'ALLOWED', nota: null })),
});

const ctxAnalisis = (over: Partial<ContextoAnalisis> = {}): ContextoAnalisis => ({
  organizationId: ORG, runId: RUN, oferta: [oferta('implantes', 'Implantes dentales')], restricciones: [],
  auditoria: auditoria([pagina(), pagina({ ruta: '/implantes-dentales', titulo: 'Implantes dentales' })]),
  terminos: [termino('implante dental curico')], geos: [geo('Curicó')], eventosConversion: ['contacto_whatsapp'],
  techoDeclarado: { modalidad: 'MONTHLY', montoMinor: 300_000 }, reglasCanal: [], demanda: 'CON_DATOS',
  competidoresDisponibles: false, ahora: AHORA, ...over,
});

const ctxClasificacion = (over: Partial<ContextoClasificacion> = {}): ContextoClasificacion => ({
  ofertas: ['Implantes dentales', 'Rehabilitación oral'], localidades: ['Curicó'], localidadesExcluidas: [],
  restricciones: [], marca: 'Clínica QA', ...over,
});

// ── 1. INTENCIÓN: reglas auditables ─────────────────────────────────────────────────────────────

describe('clasificación de intención', () => {
  it('«precio implante dental» es intención COMERCIAL, no ruido: es quien está más cerca de decidir', () => {
    const c = clasificarIntencion('precio implante dental', ctxClasificacion());
    expect(c.intencion).toBe('COMMERCIAL');
    expect(c.confianza).toBe('HIGH');
    expect(c.ofertaRelacionada).toBe('Implantes dentales');
    // La clasificación es AUDITABLE: dice con qué coincidió y con qué método.
    expect(c.metodo).toBe('RULES_V1');
    expect(c.evidencia).toContain('precio');
    // Y sobre todo: NO se excluye.
    expect(evaluarTermino('precio implante dental', c).elegibilidad).toBe('CANDIDATE');
  });

  it('el empleo y la formación ganan sobre cualquier otra señal: quien busca trabajo no es cliente', () => {
    const empleo = clasificarIntencion('trabajo dentista curico', ctxClasificacion());
    expect(empleo.intencion).toBe('EMPLOYMENT');
    const estudio = clasificarIntencion('curso de implantes dentales', ctxClasificacion());
    expect(estudio.intencion).toBe('EDUCATIONAL');
    for (const [t, c] of [['trabajo dentista curico', empleo], ['curso de implantes dentales', estudio]] as const) {
      const v = evaluarTermino(t, c);
      expect(v.elegibilidad).toBe('EXCLUDED');
      // CANDIDATO, con su motivo: sigue siendo una propuesta que alguien tiene que aprobar.
      expect(v.candidatoNegativo).not.toBeNull();
      expect(v.candidatoNegativo?.evidencia).not.toBe('');
    }
  });

  it('una búsqueda local dentro del territorio declarado es intención LOCAL con confianza alta', () => {
    const c = clasificarIntencion('implantes dentales curico', ctxClasificacion());
    expect(c.intencion).toBe('LOCAL');
    expect(c.confianza).toBe('HIGH');
    expect(c.evidencia).toContain('Curicó');
  });

  it('un territorio EXCLUIDO explícitamente vuelve el término irrelevante', () => {
    const c = clasificarIntencion('implantes dentales talca', ctxClasificacion({ localidadesExcluidas: ['Talca'] }));
    expect(c.intencion).toBe('IRRELEVANT');
    expect(evaluarTermino('implantes dentales talca', c).elegibilidad).toBe('EXCLUDED');
  });

  it('una restricción PERSISTIDA produce candidatos a negativa; sin ella no se asume nada', () => {
    // Sin la restricción en la base, «fonasa» NO se excluye: no se infiere de un brief ni de un supuesto.
    const sinRestriccion = clasificarIntencion('implantes dentales fonasa', ctxClasificacion());
    expect(sinRestriccion.intencion).not.toBe('IRRELEVANT');
    expect(evaluarTermino('implantes dentales fonasa', sinRestriccion).elegibilidad).not.toBe('EXCLUDED');

    // Con la restricción persistida, sí: y el motivo cita el texto que el negocio declaró.
    const con = clasificarIntencion('implantes dentales fonasa', ctxClasificacion({ restricciones: [restriccion('No atendemos Fonasa')] }));
    expect(con.intencion).toBe('IRRELEVANT');
    const v = evaluarTermino('implantes dentales fonasa', con);
    expect(v.elegibilidad).toBe('EXCLUDED');
    expect(v.candidatoNegativo?.evidencia).toContain('No atendemos Fonasa');
  });

  it('las palabras de una restricción ignoran las negaciones y el relleno', () => {
    expect(terminosDeRestriccion('No atendemos Fonasa')).toEqual(['fonasa']);
    expect(terminosDeRestriccion('No tenemos convenio con isapres')).toContain('isapres');
  });

  it('un término sin relación con la oferta va a REVISIÓN, no a la basura', () => {
    const c = clasificarIntencion('reparacion de lavadoras', ctxClasificacion());
    const v = evaluarTermino('reparacion de lavadoras', c);
    expect(v.elegibilidad).toBe('NEEDS_REVIEW');
    expect(v.candidatoNegativo).toBeNull();
  });

  it('el nombre del propio negocio es una búsqueda de marca', () => {
    expect(clasificarIntencion('clinica qa horarios', ctxClasificacion()).intencion).toBe('NAVIGATIONAL');
  });
});

// ── 2. AUDITORÍA DEL SITIO: presupuesto y defensas ──────────────────────────────────────────────

describe('auditoría del propio sitio', () => {
  const html = (extra = ''): string =>
    `<html><head><title>Clínica QA</title><meta name="description" content="dental"></head>
     <body><h1>Clínica QA</h1><a href="tel:+56900000000">llamar</a><form></form>${extra}</body></html>`;

  it('no sale a la red si la url no es https ni apunta a un dominio con punto', async () => {
    const fetchFn = vi.fn();
    for (const url of ['http://clinica-qa.example/', 'https://localhost/', 'no-es-una-url']) {
      const a = await auditarSitio(url, PRESUPUESTO_RASTREO_POR_DEFECTO, { fetchFn: fetchFn as unknown as typeof fetch, ahora: () => AHORA });
      expect(a.alcanzable).toBe(false);
      expect(a.error).not.toBeNull();
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('no sale a la red si el dominio resuelve a una dirección interna', async () => {
    const fetchFn = vi.fn();
    const a = await auditarSitio('https://interno.example/', PRESUPUESTO_RASTREO_POR_DEFECTO, {
      fetchFn: fetchFn as unknown as typeof fetch, resolver: async () => ['10.0.0.5'], ahora: () => AHORA,
    });
    expect(a.alcanzable).toBe(false);
    expect(a.error).toContain('pública');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('respeta el presupuesto de páginas y no visita otros dominios', async () => {
    const visitadas: string[] = [];
    const fetchFn = (async (url: URL | string): Promise<Response> => {
      const u = new URL(String(url));
      visitadas.push(u.pathname);
      const enlaces = Array.from({ length: 10 }, (_, i) => `<a href="/p${u.pathname}-${i}">x</a>`).join('')
        + '<a href="https://otro-dominio.example/espia">externo</a>';
      return new Response(html(enlaces), { status: 200, headers: { 'content-type': 'text/html' } });
    }) as unknown as typeof fetch;

    const a = await auditarSitio('https://clinica-qa.example/', { maxPaginas: 3, maxProfundidad: 2, timeoutMsPorPagina: 1000, maxBytesPorPagina: 100_000 }, {
      fetchFn, resolver: async () => ['93.184.216.34'], ahora: () => AHORA,
    });
    expect(a.alcanzable).toBe(true);
    expect(a.paginasVisitadas).toBe(3);
    expect(visitadas).toHaveLength(3);
    expect(visitadas.some((v) => v.includes('espia'))).toBe(false);
    // Lo que se descarta se cuenta: el presupuesto es visible, no silencioso.
    expect(a.paginasOmitidas).toBeGreaterThan(0);
  });

  it('un sitio caído es un HALLAZGO, no una excepción', async () => {
    const fetchFn = (async (): Promise<Response> => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const a = await auditarSitio('https://clinica-qa.example/', PRESUPUESTO_RASTREO_POR_DEFECTO, {
      fetchFn, resolver: async () => ['93.184.216.34'], ahora: () => AHORA,
    });
    expect(a.alcanzable).toBe(false);
    expect(a.error).toContain('ECONNREFUSED');
    expect(a.paginas).toEqual([]);
  });

  it('extrae vías de contacto y llamadas a la acción, y no guarda el cuerpo de la página', async () => {
    const fetchFn = (async (): Promise<Response> =>
      new Response(html('<a href="https://wa.me/56900000000">WhatsApp</a>'), { status: 200, headers: { 'content-type': 'text/html' } })
    ) as unknown as typeof fetch;
    const a = await auditarSitio('https://clinica-qa.example/', { ...PRESUPUESTO_RASTREO_POR_DEFECTO, maxPaginas: 1 }, {
      fetchFn, resolver: async () => ['93.184.216.34'], ahora: () => AHORA,
    });
    const p = a.paginas[0]!;
    expect(p.viasDeContacto).toEqual(expect.arrayContaining(['telefono', 'whatsapp', 'formulario']));
    expect(p.indexable).toBe(true);
    expect(JSON.stringify(p)).not.toContain('<html');
  });
});

// ── 3. LANDINGS Y CANALES: estados con motivos ──────────────────────────────────────────────────

describe('compatibilidad de landings', () => {
  it('sin sitio revisado la landing es MISSING y se dice por qué (no se crea ninguna)', () => {
    const [l] = evaluarLandings(ctxAnalisis({ auditoria: null }));
    expect(l?.estado).toBe('MISSING');
    expect(l?.motivos[0]).toContain('sitio web');
  });

  it('una página propia, indexable, con llamada a la acción y contacto está READY', () => {
    const [l] = evaluarLandings(ctxAnalisis({
      auditoria: auditoria([pagina(), pagina({ ruta: '/implantes-dentales', titulo: 'Implantes dentales' })]),
    }));
    expect(l?.estado).toBe('READY');
    expect(l?.url).toBe('/implantes-dentales');
  });

  it('si la oferta sólo se menciona en la portada, la landing es WEAK con su motivo', () => {
    const [l] = evaluarLandings(ctxAnalisis({
      auditoria: auditoria([pagina({ titulo: 'Implantes dentales en Curicó' })]),
    }));
    expect(l?.estado).toBe('WEAK');
    expect(l?.motivos.join(' ')).toContain('no hay página propia');
  });

  it('una página que afirma algo que el negocio declaró prohibido queda BLOCKED', () => {
    const [l] = evaluarLandings(ctxAnalisis({
      restricciones: [restriccion('No atendemos Fonasa')],
      auditoria: auditoria([pagina(), pagina({ ruta: '/implantes-dentales', titulo: 'Implantes dentales con Fonasa' })]),
    }));
    expect(l?.estado).toBe('BLOCKED');
    expect(l?.motivos.join(' ')).toContain('No atendemos Fonasa');
  });
});

describe('veredicto por canal', () => {
  it('con todo en su sitio, el buscador es SUITABLE — y el veredicto es un estado, nunca una nota', () => {
    const canales = evaluarCanales(ctxAnalisis());
    expect(veredictoDe(canales, 'GOOGLE_SEARCH')).toBe('SUITABLE');
    for (const c of canales) {
      expect(['SUITABLE', 'POSSIBLE', 'INSUFFICIENT_EVIDENCE', 'NOT_SUITABLE', 'BLOCKED']).toContain(c.veredicto);
      expect(c.motivos.length).toBeGreaterThan(0);
      expect(JSON.stringify(c)).not.toMatch(/"(score|puntaje|ranking)"/);
    }
  });

  it('sin fuente de demanda el veredicto es INSUFFICIENT_EVIDENCE: faltan datos es una respuesta válida', () => {
    const canales = evaluarCanales(ctxAnalisis({ demanda: 'SIN_FUENTE', terminos: [] }));
    expect(veredictoDe(canales, 'GOOGLE_SEARCH')).toBe('INSUFFICIENT_EVIDENCE');
    expect(canales.find((c) => c.canal === 'GOOGLE_SEARCH')?.motivos.join(' ')).toContain('conectar la cuenta de Google');
  });

  /**
   * EL SILENCIO DEL PROVEEDOR NO ES UN VEREDICTO. Salió de producción: el planificador de Google respondió a
   * «clínica dental», «odontología general» y «rehabilitación oral» sin traer un solo término, y SOEC lo
   * tradujo a «este canal no sirve para tu negocio» —una afirmación sobre el mercado de alguien, sostenida en
   * una lista vacía—. Ahora se distingue: no traer nada es no saber; traer términos sin volumen sí es medir.
   */
  it('si el planificador responde sin términos NO se concluye que el canal no sirva', () => {
    const canales = evaluarCanales(ctxAnalisis({ demanda: 'SIN_IDEAS', terminos: [] }));
    expect(veredictoDe(canales, 'GOOGLE_SEARCH')).toBe('INSUFFICIENT_EVIDENCE');
    const motivos = canales.find((c) => c.canal === 'GOOGLE_SEARCH')?.motivos.join(' ') ?? '';
    expect(motivos).toMatch(/sin ningún término/i);
    expect(motivos, 'no se puede afirmar que no haya demanda').not.toMatch(/no aparecen búsquedas relevantes/i);
  });

  it('si la consulta de demanda falla tampoco se concluye nada del mercado', () => {
    const canales = evaluarCanales(ctxAnalisis({ demanda: 'SIN_RESPUESTA', terminos: [] }));
    expect(veredictoDe(canales, 'GOOGLE_SEARCH')).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('con términos devueltos y todos sin volumen SÍ se concluye: eso es una medición', () => {
    const canales = evaluarCanales(ctxAnalisis({ demanda: 'CON_DATOS', terminos: [] }));
    expect(veredictoDe(canales, 'GOOGLE_SEARCH')).toBe('NOT_SUITABLE');
  });

  it('DEMANDA NO ES RECOMENDACIÓN: con demanda pero sin landing, sin medición o sin techo es POSSIBLE', () => {
    expect(veredictoDe(evaluarCanales(ctxAnalisis({ auditoria: auditoria([pagina({ titulo: 'otra cosa', h1: [] })]) })), 'GOOGLE_SEARCH')).toBe('POSSIBLE');
    expect(veredictoDe(evaluarCanales(ctxAnalisis({ eventosConversion: [] })), 'GOOGLE_SEARCH')).toBe('POSSIBLE');
    expect(veredictoDe(evaluarCanales(ctxAnalisis({ techoDeclarado: null })), 'GOOGLE_SEARCH')).toBe('POSSIBLE');
    expect(veredictoDe(evaluarCanales(ctxAnalisis({ geos: [] })), 'GOOGLE_SEARCH')).toBe('POSSIBLE');
  });

  it('un canal declarado prohibido por el negocio queda BLOCKED', () => {
    const canales = evaluarCanales(ctxAnalisis({ reglasCanal: [{ canal: 'GOOGLE_ADS', modo: 'FORBIDDEN' }] }));
    expect(veredictoDe(canales, 'GOOGLE_SEARCH')).toBe('BLOCKED');
  });

  it('sin datos de competidores el hallazgo es INSUFICIENTE, y no se inventa ningún competidor', () => {
    const hallazgos = derivarHallazgos(ctxAnalisis(), evaluarLandings(ctxAnalisis()));
    const h = hallazgos.find((x) => x.tipo === 'COMPETITOR_DATA_INSUFFICIENT');
    expect(h).toBeDefined();
    expect(h?.confianza).toBe('LOW');
  });

  it('cada hallazgo de demanda observada apunta a las evidencias que lo sostienen', () => {
    const hallazgos = derivarHallazgos(ctxAnalisis(), evaluarLandings(ctxAnalisis()));
    const h = hallazgos.find((x) => x.tipo === 'SEARCH_DEMAND_EXISTS');
    expect(h?.evidenciaIds.length).toBeGreaterThan(0);
    expect(h?.confianza).toBe('HIGH');
  });

  it('demandaRelevante sólo cuenta candidatos con intención de pago', () => {
    const r = demandaRelevante([
      termino('implante dental precio'),
      termino('que es un implante dental', { intencion: 'INFORMATIONAL', elegibilidad: 'NEEDS_REVIEW' }),
      termino('trabajo dentista', { intencion: 'EMPLOYMENT', elegibilidad: 'EXCLUDED' }),
    ]);
    expect(r.candidatos).toHaveLength(1);
    expect(r.volumenTotal).toBe(100);
  });
});

// ── 4. PLANIFICADOR ─────────────────────────────────────────────────────────────────────────────

const entradaPlan = (over: Partial<EntradaPlanificador> = {}): EntradaPlanificador => {
  const ctx = ctxAnalisis();
  return {
    organizationId: ORG, perfil: perfil(), oferta: [oferta('implantes', 'Implantes dentales')],
    politica: politicaCon(['contacto_whatsapp']), runId: RUN,
    terminos: [termino('implante dental curico', { intencion: 'LOCAL' }), termino('precio implante dental')],
    geos: [geo('Curicó')], canales: evaluarCanales(ctx), landings: evaluarLandings(ctx),
    techoDeclarado: { modalidad: 'MONTHLY', montoMinor: 300_000 }, conversionExternaVerificada: false,
    historialDeConversiones: 0, version: 1, ahora: AHORA, ...over,
  };
};

describe('planificador de campañas', () => {
  it('es DETERMINISTA: la misma evidencia produce exactamente el mismo plan', () => {
    const a = planificar(entradaPlan());
    const b = planificar(entradaPlan());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('el plan NUNCA es ejecutable en esta fase, y el bloqueo se dice en primer plano', () => {
    const { plan } = planificar(entradaPlan());
    expect(plan.estado).toBe('NON_EXECUTABLE');
    expect(plan.readiness.EXECUTION_READY).toBe(false);
    expect(plan.readiness.CREATIVE_READY).toBe(false);
    expect(plan.requisitosCreativos).toContain('RSA_REQUIRED');
    expect(plan.prerequisitos.join(' ')).toContain('escribir los anuncios');
  });

  it('no inventa presupuesto: sin techo declarado no propone gasto y lo exige como prerrequisito', () => {
    const { plan } = planificar(entradaPlan({ techoDeclarado: null }));
    expect(plan.presupuesto.propuestoDiarioClp).toBeNull();
    expect(plan.presupuesto.base).toBe('NONE');
    expect(plan.presupuesto.explicacion).toContain('inventar dinero ajeno');
    expect(plan.prerequisitos.join(' ')).toContain('declarar cuánto');
    expect(plan.readiness.BUDGET_READY).toBe(false);
  });

  it('el gasto propuesto sale del TECHO del dueño; la oportunidad de mercado va aparte y etiquetada', () => {
    const { plan } = planificar(entradaPlan());
    expect(plan.presupuesto.techoDeclaradoClp).toBe(300_000);
    expect(plan.presupuesto.propuestoDiarioClp).toBe(10_000); // 300.000 / 30, no una cifra elegida por el motor
    expect(plan.presupuesto.base).toBe('USER_CEILING');
    expect(plan.presupuesto.oportunidadDiariaClp).not.toBeNull();
    expect(plan.presupuesto.explicacion).toContain('no una recomendación');
  });

  it('sin conversión declarada exige configurarla y deja la medición sin preparar', () => {
    const { plan } = planificar(entradaPlan({ politica: politicaVacia }));
    expect(plan.requisitoConversion).toBe('CONVERSION_SETUP_REQUIRED');
    expect(plan.readiness.MEASUREMENT_READY).toBe(false);
    expect(plan.readiness.EXECUTION_READY).toBe(false);
  });

  it('con conversión declarada pero no verificada, el plan lo dice en lugar de darla por buena', () => {
    const { plan } = planificar(entradaPlan());
    expect(plan.requisitoConversion).toBe('CONVERSION_TRACKING_UNVERIFIED');
    expect(plan.prerequisitos.join(' ')).toContain('verificar la conversión');
  });

  it('NO propone concordancia amplia sin historial ni cobertura de negativas, y lo explica', () => {
    const { plan, grupos } = planificar(entradaPlan());
    const concordancias = grupos.flatMap((g) => g.palabras.map((p) => p.concordancia));
    expect(concordancias).not.toContain('BROAD');
    expect(concordancias.length).toBeGreaterThan(0);
    expect(plan.explicacion.some((e) => e.decision.includes('No se propone concordancia amplia'))).toBe(true);
    // Y cada palabra lleva su justificación: nada de «lo recomienda la IA».
    for (const p of grupos.flatMap((g) => g.palabras)) expect(p.justificacion.length).toBeGreaterThan(10);
  });

  it('admite concordancia amplia SÓLO con historial de conversiones y negativas suficientes', () => {
    const excluidos = ['trabajo dentista', 'curso implantes', 'implantes gratis', 'implante fonasa', 'dentista sueldo']
      .map((t) => termino(t, { intencion: 'EMPLOYMENT', elegibilidad: 'EXCLUDED', motivoExclusion: 'no es cliente' }));
    const { grupos } = planificar(entradaPlan({
      historialDeConversiones: 120,
      terminos: [termino('implante dental', { intencion: 'COMMERCIAL', intencionConfianza: 'LOW' }), ...excluidos],
    }));
    const palabras = grupos.flatMap((g) => g.palabras);
    expect(palabras.some((p) => p.concordancia === 'BROAD')).toBe(true);
    expect(palabras.find((p) => p.concordancia === 'BROAD')?.justificacion).toContain('historial');
  });

  it('con historial de conversiones cambia la puja, y lo justifica con el número observado', () => {
    expect(planificar(entradaPlan()).plan.puja.estrategia).toBe('MAXIMIZE_CLICKS_WITH_CPC_CEILING');
    const conHistorial = planificar(entradaPlan({ historialDeConversiones: 45 })).plan.puja;
    expect(conHistorial.estrategia).toBe('MAXIMIZE_CONVERSIONS');
    expect(conHistorial.justificacion).toContain('45');
  });

  it('un territorio no segmentable se excluye del plan y queda como prerrequisito explícito', () => {
    const { plan } = planificar(entradaPlan({
      geos: [geo('Curicó'), geo('Provincia de Curicó', { disponible: false, targetId: null, targetTipo: null })],
    }));
    expect(plan.geografia.noEjecutables).toContain('Provincia de Curicó');
    expect(plan.geografia.targets.map((t) => t.nombre)).not.toContain('Provincia de Curicó');
    expect(plan.explicacion.some((e) => e.decision.includes('territorio'))).toBe(true);
  });

  it('un territorio que sólo se alcanza de forma aproximada NO se sustituye en silencio', () => {
    const { plan } = planificar(entradaPlan({
      geos: [geo('Curicó', { aproximacion: true, riesgoDerrame: 'HIGH', targetTipo: 'REGION' })],
    }));
    expect(plan.geografia.aproximaciones).toContain('Curicó');
    expect(plan.prerequisitos.join(' ')).toContain('revisar el alcance');
  });

  it('una landing ausente o bloqueada aparece como prerrequisito y no se da la oferta por planificable', () => {
    const ctxSinLanding = ctxAnalisis({ auditoria: null });
    const { plan } = planificar(entradaPlan({ landings: evaluarLandings(ctxSinLanding) }));
    expect(plan.prerequisitos.join(' ')).toContain('crear una página de destino');
    expect(plan.readiness.LANDING_READY).toBe(false);

    const ctxBloqueada = ctxAnalisis({
      restricciones: [restriccion('No atendemos Fonasa')],
      auditoria: auditoria([pagina(), pagina({ ruta: '/implantes-dentales', titulo: 'Implantes con Fonasa' })]),
    });
    const bloqueado = planificar(entradaPlan({ landings: evaluarLandings(ctxBloqueada) }));
    expect(bloqueado.plan.ofertas).not.toContain('implantes');
    expect(bloqueado.plan.prerequisitos.join(' ')).toContain('restricción declarada');
  });

  it('una oferta no es una campaña: con presupuesto pequeño se propone UNA campaña con varios grupos', () => {
    const ofertas = ['implantes', 'ortodoncia', 'limpieza'].map((s, i) => oferta(s, `Servicio ${s}`, { priority: i + 1 }));
    const terminos = ofertas.map((o) => termino(`${o.slug} curico`, { ofertaSlug: o.slug, intencion: 'LOCAL' }));
    const landings = ofertas.map((o) => ({ organizationId: ORG, runId: RUN, ofertaSlug: o.slug, estado: 'READY' as const, url: `/${o.slug}`, motivos: [] }));
    const { plan } = planificar(entradaPlan({ oferta: ofertas, terminos, landings, techoDeclarado: { modalidad: 'DAILY', montoMinor: 3_000 } }));
    expect(plan.estructura.tipo).toBe('UNA_CAMPANA_VARIOS_GRUPOS');
    expect(plan.estructura.justificacion).toContain('sin datos suficientes');
  });

  it('con varias ofertas, páginas propias y presupuesto suficiente sí propone una campaña por oferta', () => {
    const ofertas = ['implantes', 'ortodoncia', 'limpieza'].map((s, i) => oferta(s, `Servicio ${s}`, { priority: i + 1 }));
    const terminos = ofertas.map((o) => termino(`${o.slug} curico`, { ofertaSlug: o.slug, intencion: 'LOCAL' }));
    const landings = ofertas.map((o) => ({ organizationId: ORG, runId: RUN, ofertaSlug: o.slug, estado: 'READY' as const, url: `/${o.slug}`, motivos: [] }));
    const { plan, grupos } = planificar(entradaPlan({ oferta: ofertas, terminos, landings, techoDeclarado: { modalidad: 'DAILY', montoMinor: 200_000 } }));
    expect(plan.estructura.tipo).toBe('CAMPANA_POR_OFERTA');
    expect(grupos).toHaveLength(3);
  });

  it('cada decisión del plan viene con su porqué: nunca «porque la IA lo recomienda»', () => {
    const { plan } = planificar(entradaPlan());
    expect(plan.explicacion.length).toBeGreaterThan(3);
    for (const e of plan.explicacion) {
      expect(e.porque.length).toBeGreaterThan(20);
      expect(e.porque.toLowerCase()).not.toContain('la ia');
      expect(e.porque.toLowerCase()).not.toContain('inteligencia artificial');
    }
    expect(JSON.stringify(plan)).not.toMatch(/gaql|SELECT .* FROM campaign/i);
  });

  it('las negativas del plan son CANDIDATAS con su motivo, no negativas aplicadas', () => {
    const { plan, grupos } = planificar(entradaPlan({
      terminos: [termino('implante dental curico', { intencion: 'LOCAL' }), termino('trabajo dentista', { intencion: 'EMPLOYMENT', elegibilidad: 'EXCLUDED', motivoExclusion: 'busca empleo' })],
    }));
    expect(grupos[0]?.negativas.map((n) => n.termino)).toContain('trabajo dentista');
    expect(grupos[0]?.negativas[0]?.motivo).not.toBe('');
    expect(plan.explicacion.some((e) => e.porque.includes('CANDIDATAS'))).toBe(true);
  });

  it('el plan no contiene ningún identificador de campaña externa: es una propuesta, no una campaña', () => {
    const { plan } = planificar(entradaPlan());
    const json = JSON.stringify(plan);
    expect(json).not.toMatch(/customers\/\d+/);
    expect(json).not.toMatch(/campaigns\/\d+/);
    expect(plan.id.startsWith('plan-v1-')).toBe(true);
  });
});

// ── 5. GOBIERNO DE CUOTA ────────────────────────────────────────────────────────────────────────

describe('gobierno de cuota', () => {
  it('SINGLE-FLIGHT: dos peticiones simultáneas de la misma consulta producen UNA sola llamada', async () => {
    const coordinador = new CoordinadorDeConsultas();
    let llamadas = 0;
    const consulta = async (): Promise<number> => {
      llamadas += 1;
      await new Promise((r) => setTimeout(r, 10));
      return llamadas;
    };
    const [a, b, c] = await Promise.all([
      coordinador.una('k', consulta), coordinador.una('k', consulta), coordinador.una('k', consulta),
    ]);
    expect(llamadas).toBe(1);
    expect([a, b, c]).toEqual([1, 1, 1]);
  });

  it('CACHÉ: abrir la pantalla otra vez no vuelve a consultar, pero la caché caduca', async () => {
    let ahora = 0;
    const coordinador = new CoordinadorDeConsultas(() => ahora, 1_000);
    let llamadas = 0;
    const consulta = async (): Promise<number> => ++llamadas;
    await coordinador.una('k', consulta);
    await coordinador.una('k', consulta);
    expect(llamadas).toBe(1);
    expect(coordinador.tamanoCache).toBe(1);
    ahora = 2_000;
    await coordinador.una('k', consulta);
    expect(llamadas).toBe(2);
  });

  it('claves distintas no se comparten entre organizaciones', async () => {
    const coordinador = new CoordinadorDeConsultas();
    let llamadas = 0;
    const consulta = async (): Promise<number> => ++llamadas;
    await coordinador.una('demanda:org-a:1', consulta);
    await coordinador.una('demanda:org-b:1', consulta);
    expect(llamadas).toBe(2);
  });
});

// ── 6. PROVEEDORES AUSENTES ─────────────────────────────────────────────────────────────────────

describe('proveedores ausentes', () => {
  it('sin Google, la demanda y la geografía devuelven null con su motivo (no datos inventados)', async () => {
    const demanda = demandaNoDisponible('falta conexión');
    expect(await demanda.demanda({ semillas: ['x'], urlSitio: null, geoTargetIds: [], idioma: 'es', pais: 'CL' })).toBeNull();
    expect(demanda.motivo).toBe('falta conexión');
    const g = geoNoDisponible('falta conexión');
    expect(await g.resolver(['Curicó'], 'CL', 'es')).toBeNull();
  });

  it('el proveedor de competidores por defecto responde «no hay fuente», no una lista plausible', async () => {
    expect(await competidoresSinFuente.competidores({ semillas: ['x'], pais: 'CL', territorio: [] })).toBeNull();
  });

  it('el presupuesto de rastreo por defecto es conservador', () => {
    expect(PRESUPUESTO_RASTREO_POR_DEFECTO.maxPaginas).toBeLessThanOrEqual(20);
    expect(PRESUPUESTO_RASTREO_POR_DEFECTO.maxProfundidad).toBeLessThanOrEqual(3);
  });
});
