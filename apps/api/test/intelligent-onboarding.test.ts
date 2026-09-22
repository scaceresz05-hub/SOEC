/**
 * Autonomy Fase D · ONBOARDING INTELIGENTE — pruebas deterministas (sin base, sin red).
 *
 * Lo que se demuestra aquí:
 *  1. las preguntas son CONDICIONALES: cada tipo de negocio ve las suyas y no las de otro;
 *  2. no se pregunta lo que SOEC ya sabe (perfil, conexiones), y lo sabido se marca con su procedencia;
 *  3. el lenguaje natural se trocea bien: «hacemos implantes, prótesis y odontología general» son tres cosas;
 *  4. la inspección del sitio es segura: rechaza http, direcciones internas y redirecciones fuera del dominio;
 *  5. la preparación se evalúa por dominios y por niveles, y ejecutar campañas nunca queda listo por completar
 *     un formulario: exige permiso de gobierno y una autorización financiera humana.
 */
import { describe, expect, it } from 'vitest';
import { construirPasos, progreso, siguientePaso, type ContextoOnboarding } from '../src/onboarding/onboarding-preguntas';
import { claveDesdeTexto, trocearEnumeracion } from '../src/onboarding/onboarding-tipos';
import { esIpNoPublica, inspeccionarSitio, validarUrlDeSitio } from '../src/onboarding/sitio-web';
import { evaluarReadiness, type DatosDeReadiness } from '../src/onboarding/readiness';
import type { PerfilNegocio, OfertaNegocio, TerritorioNegocio } from '../src/negocio/negocio-pg';
import type { Conexion, CapacidadPersistida } from '../src/conexion/conexion-pg';
import type { PoliticaCompleta } from '../src/politica/politica-pg';
import type { CompletitudPerfil } from '../src/politica/politica-tipos';

const ORG = 'empresa-qa-d1d2d3';

const perfil = (over: Partial<PerfilNegocio> = {}): PerfilNegocio => ({
  organizationId: ORG,
  businessKey: 'bk',
  displayName: 'Empresa QA',
  legalName: null,
  businessType: 'SERVICIOS',
  description: null,
  website: null,
  country: 'CL',
  currency: 'CLP',
  timezone: 'America/Santiago',
  language: 'es',
  customerType: 'B2C',
  primaryObjective: null,
  status: 'DRAFT',
  origen: 'UI',
  createdAt: '2026-09-21T00:00:00.000Z',
  updatedAt: '2026-09-21T00:00:00.000Z',
  ...over,
});

const politicaVacia: PoliticaCompleta = { politica: null, kpis: [], eventos: [], reglas: [], limites: null, canales: [] };

const ctx = (over: Partial<ContextoOnboarding> = {}): ContextoOnboarding => ({
  perfil: perfil(),
  oferta: [],
  territorios: [],
  restricciones: [],
  politica: politicaVacia,
  conexiones: [],
  capacidades: [],
  sitio: null,
  presupuesto: null,
  modoOperativo: 'PILOT',
  respuestas: new Map(),
  ...over,
});

const conexion = (provider: Conexion['provider'], estado: Conexion['estado'] = 'CONNECTED'): Conexion => ({
  organizationId: ORG, provider, id: `cx-${provider}`, tipo: provider === 'GROWTH_M2M' ? 'GROWTH' : 'ADS',
  estado, externalAccountId: null, externalAccountName: null, loginAccountId: null, configuracion: {},
  secretRef: estado === 'CONNECTED' ? 'secretstore:x/y' : null, ultimoError: null, validadaEn: null,
  origen: 'UI', createdAt: '', updatedAt: '',
});

const idsDePaso = (c: ContextoOnboarding, paso: string): readonly string[] =>
  construirPasos(c).find((p) => p.id === paso)?.preguntas.map((q) => q.id) ?? [];

describe('1 · preguntas condicionales: cada negocio ve las suyas', () => {
  it('una tienda online recibe venta online y despacho; no recibe prueba de software', () => {
    const c = ctx({ perfil: perfil({ businessType: 'ECOMMERCE' }) });
    expect(idsDePaso(c, 'oferta')).toContain('oferta.ventaOnline');
    expect(idsDePaso(c, 'territorio')).toContain('territorio.despacho');
    expect(idsDePaso(c, 'oferta')).not.toContain('oferta.modalidadPrueba');
  });

  it('una clínica recibe zonas atendidas y agenda; no recibe despacho', () => {
    const c = ctx({ perfil: perfil({ businessType: 'CLINICA' }) });
    expect(idsDePaso(c, 'territorio')).toContain('territorio.donde');
    expect(idsDePaso(c, 'contacto')).toContain('contacto.agenda');
    expect(idsDePaso(c, 'territorio')).not.toContain('territorio.despacho');
  });

  it('un software recibe modalidad de prueba y países; no se le piden comunas', () => {
    const c = ctx({ perfil: perfil({ businessType: 'SAAS' }) });
    expect(idsDePaso(c, 'oferta')).toContain('oferta.modalidadPrueba');
    expect(idsDePaso(c, 'territorio')).toContain('territorio.alcanceSaas');
    expect(idsDePaso(c, 'territorio')).not.toContain('territorio.donde');
  });

  it('la integración técnica sólo se ofrece a quien puede tenerla', () => {
    expect(idsDePaso(ctx({ perfil: perfil({ businessType: 'LOCAL' }) }), 'conexiones')).not.toContain('conexiones.sistemaPropio');
    expect(idsDePaso(ctx({ perfil: perfil({ businessType: 'ECOMMERCE' }) }), 'conexiones')).toContain('conexiones.sistemaPropio');
  });

  it('la respuesta del propio asistente manda sobre el tipo guardado (la rama cambia al instante)', () => {
    const c = ctx({
      perfil: perfil({ businessType: 'SERVICIOS' }),
      respuestas: new Map([['negocio.tipo', { organizationId: ORG, pregunta: 'negocio.tipo', valor: 'ECOMMERCE', procedencia: 'USER', confirmacion: 'USER_CONFIRMED', actualizadoEn: '' }]]),
    });
    expect(idsDePaso(c, 'territorio')).toContain('territorio.despacho');
  });

  it('ninguna pregunta usa jerga de marketing técnico', () => {
    const textos = construirPasos(ctx({ perfil: perfil({ businessType: 'ECOMMERCE' }) }))
      .flatMap((p) => [p.titulo, p.descripcion, ...p.preguntas.flatMap((q) => [q.etiqueta, q.ayuda ?? ''])])
      .join(' ')
      .toLowerCase();
    for (const jerga of ['cpc', 'cpa', 'roas', 'cvr', 'mcc', 'pixel', 'conversion label', 'attribution', 'bidding', 'match type', 'capability', 'governance', 'scheduler']) {
      expect(textos).not.toContain(jerga);
    }
  });
});

describe('2 · no se pregunta lo que SOEC ya sabe', () => {
  it('el país del perfil aparece resuelto, con su procedencia', () => {
    const p = construirPasos(ctx()).find((x) => x.id === 'negocio')!.preguntas.find((q) => q.id === 'negocio.pais')!;
    expect(p.yaSabemos).toBe(true);
    expect(p.valorActual).toBe('CL');
    expect(p.procedencia).toBe('USER');
  });

  it('con Google ya conectado, la pregunta llega respondida por el conector', () => {
    const p = construirPasos(ctx({ conexiones: [conexion('GOOGLE_ADS')] })).find((x) => x.id === 'conexiones')!
      .preguntas.find((q) => q.id === 'conexiones.usaGoogleAds')!;
    expect(p.yaSabemos).toBe(true);
    expect(p.valorActual).toBe(true);
    expect(p.procedencia).toBe('CONNECTOR');
  });

  it('la oferta ya persistida se muestra para confirmar, no se pide de nuevo', () => {
    const oferta: OfertaNegocio[] = [
      { organizationId: ORG, id: 'rehabilitacion-oral', slug: 'rehabilitacion-oral', name: 'rehabilitación oral', description: null, category: null, status: 'ACTIVE', landingUrl: null, priority: 10, geographicScope: null, advertisingEligibility: 'REQUIRES_APPROVAL', restrictions: [] },
      { organizationId: ORG, id: 'odontologia-general', slug: 'odontologia-general', name: 'odontología general', description: null, category: null, status: 'ACTIVE', landingUrl: null, priority: 50, geographicScope: null, advertisingEligibility: 'REQUIRES_APPROVAL', restrictions: [] },
    ];
    const paso = construirPasos(ctx({ oferta })).find((x) => x.id === 'oferta')!;
    const que = paso.preguntas.find((q) => q.id === 'oferta.queVendes')!;
    expect(que.yaSabemos).toBe(true);
    expect(que.valorActual).toBe('rehabilitación oral, odontología general');
    const prioritarios = paso.preguntas.find((q) => q.id === 'oferta.prioritarios')!;
    expect(prioritarios.valorActual).toEqual(['rehabilitacion-oral']);
  });

  it('el progreso y el siguiente paso salen de lo que falta, no de un contador ciego', () => {
    const pasos = construirPasos(ctx());
    expect(siguientePaso(pasos)).toBe('negocio');
    expect(progreso(pasos)).toBeLessThan(100);
  });
});

describe('3 · el lenguaje natural se trocea bien', () => {
  it('«hacemos implantes, prótesis y odontología general» son tres cosas, sin el verbo', () => {
    expect(trocearEnumeracion('hacemos implantes, prótesis y odontología general')).toEqual(['implantes', 'prótesis', 'odontología general']);
  });

  it('acepta saltos de línea, puntos y viñetas', () => {
    expect(trocearEnumeracion('· cortes\n· tintura;  peinados.')).toEqual(['cortes', 'tintura', 'peinados']);
  });

  it('la clave interna se deriva del texto y el usuario nunca la escribe', () => {
    expect(claveDesdeTexto('Rehabilitación Oral')).toBe('rehabilitacion-oral');
  });
});

describe('4 · la inspección del sitio es segura', () => {
  it('rechaza http, credenciales, puertos y direcciones sin dominio', () => {
    expect(validarUrlDeSitio('http://mi-sitio.cl').ok).toBe(false);
    expect(validarUrlDeSitio('https://user:pass@mi-sitio.cl').ok).toBe(false);
    expect(validarUrlDeSitio('https://mi-sitio.cl:8443').ok).toBe(false);
    expect(validarUrlDeSitio('https://localhost').ok).toBe(false);
    expect(validarUrlDeSitio('mi-sitio.cl').ok).toBe(true);
  });

  it('reconoce direcciones internas, incluida la de metadatos de nube', () => {
    for (const ip of ['127.0.0.1', '10.0.0.5', '192.168.1.1', '172.16.0.1', '169.254.169.254', '::1', 'fd00::1']) {
      expect(esIpNoPublica(ip)).toBe(true);
    }
    expect(esIpNoPublica('190.100.1.1')).toBe(false);
  });

  it('no consulta un sitio cuyo dominio apunta a una dirección interna', async () => {
    let pedido = false;
    const r = await inspeccionarSitio('https://interno.example', {
      resolver: async () => ['127.0.0.1'],
      fetchFn: (async () => {
        pedido = true;
        return new Response('', { status: 200 });
      }) as unknown as typeof fetch,
    });
    expect(r.estado).toBe('REJECTED');
    expect(pedido).toBe(false);
  });

  it('extrae título, descripción y páginas del propio sitio', async () => {
    const html = `<html><head><title>Clínica X · Odontología</title>
      <meta name="description" content="Atención dental en Curicó"></head>
      <body><a href="/servicios">Servicios</a><a href="https://mi-sitio.cl/contacto">Contacto</a>
      <a href="https://otro-sitio.cl/algo">Externo</a></body></html>`;
    const r = await inspeccionarSitio('https://mi-sitio.cl', {
      resolver: async () => ['190.100.1.1'],
      fetchFn: (async () => new Response(html, { status: 200 })) as unknown as typeof fetch,
    });
    expect(r.estado).toBe('OK');
    expect(r.titulo).toBe('Clínica X · Odontología');
    expect(r.metaDescription).toBe('Atención dental en Curicó');
    expect(r.paginas).toEqual(['/contacto', '/servicios']);
    expect(r.enlacesInternos).toBe(2); // el enlace a otro dominio no cuenta
  });

  it('una redirección fuera del dominio del negocio se detiene', async () => {
    const r = await inspeccionarSitio('https://mi-sitio.cl', {
      resolver: async () => ['190.100.1.1'],
      fetchFn: (async () => new Response('', { status: 301, headers: { location: 'https://otro-sitio.cl/' } })) as unknown as typeof fetch,
    });
    expect(r.estado).toBe('REJECTED');
    expect(r.error).toContain('fuera del sitio');
  });

  it('un sitio caído es información, no un error del sistema', async () => {
    const r = await inspeccionarSitio('https://mi-sitio.cl', {
      resolver: async () => ['190.100.1.1'],
      fetchFn: (async () => new Response('', { status: 503 })) as unknown as typeof fetch,
    });
    expect(r.estado).toBe('UNREACHABLE');
    expect(r.httpStatus).toBe(503);
  });
});

describe('5 · preparación por dominios y por niveles', () => {
  const completitud = (estado: CompletitudPerfil['estado'], faltantes: CompletitudPerfil['faltantes'] = []): CompletitudPerfil => ({
    estado, faltantes, recomendaciones: [], lineaBase: 'CONFIRMED', actualizadoEn: null,
  });

  const datos = (over: Partial<DatosDeReadiness> = {}): DatosDeReadiness => ({
    perfil: perfil(),
    oferta: [],
    territorios: [],
    restricciones: [],
    politica: politicaVacia,
    completitudPolitica: completitud('EVALUATION_PROFILE_INCOMPLETE', [
      { campo: 'primaryKpi', motivo: 'm', comoSeResuelve: 'c' },
    ]),
    conexiones: [],
    capacidades: [],
    gobierno: { organizationId: ORG, externalMutations: false, autonomousSpend: false, automaticSafetyPause: false, campaignExecution: false, updatedAt: '' },
    presupuesto: null,
    modoOperativo: 'PILOT',
    restriccionesRevisadas: false,
    ...over,
  });

  it('una empresa recién creada no está lista para nada, y dice exactamente por qué', () => {
    const r = evaluarReadiness(datos());
    expect(r.resumen).toBe('REQUIERE_TU_ACCION'); // falta conectar una fuente de datos
    const porDominio = new Map(r.dominios.map((d) => [d.dominio, d]));
    expect(porDominio.get('BUSINESS_PROFILE')!.estado).toBe('INCOMPLETE');
    expect(porDominio.get('OFFER')!.estado).toBe('INCOMPLETE');
    expect(porDominio.get('CONNECTIONS')!.estado).toBe('ACTION_REQUIRED');
    expect(r.niveles.every((n) => !n.listo)).toBe(true);
    expect(r.niveles.find((n) => n.nivel === 'BUSINESS_READY')!.bloqueos.length).toBeGreaterThan(0);
  });

  const negocioCompleto = (over: Partial<DatosDeReadiness> = {}): DatosDeReadiness => datos({
    perfil: perfil({ description: 'clínica dental', primaryObjective: 'conseguir nuevos clientes', businessType: 'CLINICA' }),
    oferta: [{ organizationId: ORG, id: 'implantes', slug: 'implantes', name: 'implantes', description: null, category: null, status: 'ACTIVE', landingUrl: null, priority: 10, geographicScope: null, advertisingEligibility: 'REQUIRES_APPROVAL', restrictions: [] }],
    territorios: [{ organizationId: ORG, id: 'business', ambito: 'BUSINESS', country: 'CL', region: 'Maule', province: 'Curicó', localities: ['Curicó'], criterio: null, nota: null } as TerritorioNegocio],
    ...over,
  });

  it('con negocio, oferta, territorio y objetivo, SOEC ya entiende la empresa', () => {
    const r = evaluarReadiness(negocioCompleto());
    expect(r.niveles.find((n) => n.nivel === 'BUSINESS_READY')!.listo).toBe(true);
    expect(r.niveles.find((n) => n.nivel === 'MEASUREMENT_READY')!.listo).toBe(false);
  });

  it('medir exige conversión, conexión y capacidad de lectura', () => {
    const capacidades: CapacidadPersistida[] = [{ organizationId: ORG, capacidad: 'MEDICION_REAL', habilitada: true, origen: 'SISTEMA', nota: null, actor: 'onboarding', updatedAt: '' }];
    const r = evaluarReadiness(negocioCompleto({
      politica: { ...politicaVacia, eventos: [{ organizationId: ORG, eventKey: 'whatsapp_intent', rol: 'PRIMARY', orden: 0, displayName: null, nota: null }] },
      conexiones: [conexion('GROWTH_M2M')],
      capacidades,
    }));
    expect(r.niveles.find((n) => n.nivel === 'MEASUREMENT_READY')!.listo).toBe(true);
    expect(r.niveles.find((n) => n.nivel === 'CAMPAIGN_PLANNING_READY')!.listo).toBe(false);
  });

  it('EJECUTAR campañas nunca queda listo por rellenar un formulario', () => {
    const r = evaluarReadiness(negocioCompleto({
      politica: { ...politicaVacia, eventos: [{ organizationId: ORG, eventKey: 'whatsapp_intent', rol: 'PRIMARY', orden: 0, displayName: null, nota: null }] },
      completitudPolitica: completitud('EVALUATION_PROFILE_COMPLETE'),
      conexiones: [conexion('GROWTH_M2M'), conexion('GOOGLE_ADS')],
      capacidades: [{ organizationId: ORG, capacidad: 'MEDICION_REAL', habilitada: true, origen: 'SISTEMA', nota: null, actor: 'onboarding', updatedAt: '' }],
      presupuesto: { organizationId: ORG, modalidad: 'DAILY', montoClp: 5000, moneda: 'CLP', declaradoPor: 'dueño', declaradoEn: '' },
      restriccionesRevisadas: true,
      modoOperativo: 'SUPERVISED_REAL',
    }));
    expect(r.niveles.find((n) => n.nivel === 'CAMPAIGN_PLANNING_READY')!.listo).toBe(true);
    const ejecucion = r.niveles.find((n) => n.nivel === 'CAMPAIGN_EXECUTION_READY')!;
    expect(ejecucion.listo).toBe(false);
    expect(ejecucion.bloqueos).toContain('falta habilitar la ejecución de campañas (decisión de gobierno)');
    expect(ejecucion.bloqueos).toContain('falta una autorización de presupuesto firmada por una persona');
    expect(r.niveles.find((n) => n.nivel === 'AUTONOMY_READY')!.listo).toBe(false);
  });

  it('responder «no quiero invertir todavía» resuelve el dominio sin fingir que hay presupuesto', () => {
    const r = evaluarReadiness(negocioCompleto({
      presupuesto: { organizationId: ORG, modalidad: 'NONE', montoClp: null, moneda: 'CLP', declaradoPor: 'dueño', declaradoEn: '' },
    }));
    const dominio = r.dominios.find((d) => d.dominio === 'FINANCIAL_MANDATE')!;
    expect(dominio.estado).toBe('COMPLETE');
    expect(dominio.motivos[0]!.motivo).toContain('observará sin gastar');
    expect(r.niveles.find((n) => n.nivel === 'CAMPAIGN_EXECUTION_READY')!.bloqueos).toContain('falta declarar un máximo de inversión');
  });

  it('una meta por aprender se explica como tal, no como un descuido', () => {
    const r = evaluarReadiness(negocioCompleto({
      politica: {
        ...politicaVacia,
        kpis: [{ organizationId: ORG, id: 'principal', rol: 'PRIMARY', clave: 'contactos', displayName: 'contactos', tipo: 'EVENT_COUNT', unidad: 'COUNT', direccion: 'HIGHER_IS_BETTER', eventKey: 'whatsapp_intent', targetValue: null, baselineValue: 0, tolerance: 0.2, estado: 'UNKNOWN', procedencia: 'TO_BE_LEARNED', nota: null, orden: 0 }],
      },
      completitudPolitica: completitud('EVALUATION_PROFILE_INCOMPLETE', [{ campo: 'successCriterion', motivo: 'm', comoSeResuelve: 'c' }]),
    }));
    const evaluacion = r.dominios.find((d) => d.dominio === 'EVALUATION')!;
    expect(evaluacion.motivos[0]!.motivo).toContain('se aprenderá observando');
  });
});
