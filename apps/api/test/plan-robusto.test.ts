/**
 * PLANIFICAR CON LO QUE HAY, SIN INVENTAR LO QUE NO.
 *
 * Dos cosas se fijan aquí, y las dos salieron de mirar la cuenta real de una clínica:
 *
 *  1. EL DINERO LO MANDA EL MANDATO. En el alta se declaró un techo de 3.000 al día; después una persona
 *     autorizó un máximo de 2.500. El plan tiene que proponer 2.500 — no 3.000 «que ya se recortará al
 *     ejecutar», porque enseñarle a alguien un plan de 3.000 cuando sólo hay 2.500 autorizados es enseñarle
 *     un plan que no es el suyo.
 *  2. UN SILENCIO DEL PLANIFICADOR NO ES UN MERCADO VACÍO. Si Google no trae términos pero el negocio tiene
 *     sitio auditado, ofertas y páginas verificadas, se planifica con ese material y se marca la demanda como
 *     desconocida. Nunca volumen cero, que es una medición que nadie hizo.
 */
import { describe, expect, it } from 'vitest';
import { planificar, type EntradaPlanificador } from '../src/investigacion/planificador';
import { semillasDeSitio, type PaginaVerificada } from '../src/investigacion/semillas-sitio';
import type { OfertaNegocio, PerfilNegocio } from '../src/negocio/negocio-pg';
import type { PoliticaCompleta } from '../src/politica/politica-pg';
import type { CompatibilidadLanding, EvaluacionCanal, GeoEjecutable, TerminoInvestigado } from '../src/investigacion/investigacion-pg';

const ORG = 'org-qa-plan';
const RUN = 'run-qa-1';
const AHORA = '2026-09-26T12:00:00.000Z';

const perfil = (over: Partial<PerfilNegocio> = {}): PerfilNegocio => ({
  organizationId: ORG, businessKey: 'k', displayName: 'Clínica QA', legalName: null, businessType: 'CLINICA',
  description: null, website: 'https://www.clinica-qa.example/', country: 'CL', currency: 'CLP',
  timezone: 'America/Santiago', language: 'es', customerType: 'B2C', primaryObjective: 'captar pacientes',
  status: 'ACTIVE', origen: 'UI', createdAt: AHORA, updatedAt: AHORA, ...over,
} as PerfilNegocio);

const oferta = (slug: string, name: string): OfertaNegocio => ({
  organizationId: ORG, slug, name, priority: 10, status: 'ACTIVE', landingUrl: null,
} as OfertaNegocio);

const politica = (): PoliticaCompleta => ({
  politica: { objectiveId: 'captar', objectiveText: 'captar pacientes' }, kpis: [],
  eventos: [{ eventKey: 'whatsapp_intent', rol: 'PRIMARY' }], reglas: [], limites: null, canales: [],
} as unknown as PoliticaCompleta);

const geo = (nombre: string, disponible = true): GeoEjecutable => ({
  organizationId: ORG, runId: RUN, id: `geo-${nombre}`, solicitado: nombre, disponible,
  targetId: disponible ? '9246355' : null, targetTipo: disponible ? 'Municipality' : null,
  nombreCanonico: disponible ? `${nombre}, Chile` : null, aproximacion: false, riesgoDerrame: 'NONE',
} as GeoEjecutable);

const landing = (slug: string, url: string | null, estado: 'READY' | 'MISSING' = 'READY'): CompatibilidadLanding => ({
  organizationId: ORG, runId: RUN, ofertaSlug: slug, estado, url, motivos: [],
} as CompatibilidadLanding);

const canalConDemanda = (veredicto: string): EvaluacionCanal => ({
  organizationId: ORG, runId: RUN, canal: 'GOOGLE_SEARCH', veredicto, motivos: ['qa'], evidenciaIds: [],
} as unknown as EvaluacionCanal);

const termino = (t: string, volumen: number): TerminoInvestigado => ({
  organizationId: ORG, runId: RUN, id: `kw-${t}`, termino: t, terminoNormalizado: t,
  intencion: 'LOCAL', intencionMetodo: 'RULE', intencionConfianza: 'HIGH', intencionEvidencia: [],
  ofertaSlug: 'clinica-dental', geografia: 'Curicó', idioma: 'es',
  metricas: { avgMonthlySearches: volumen, highTopOfPageBidMicros: 1_500_000_000 },
  clase: 'OBSERVED', fuente: 'GOOGLE_ADS_KEYWORD_DATA', elegibilidad: 'CANDIDATE', motivoExclusion: null,
  observadoEn: AHORA,
} as unknown as TerminoInvestigado);

const PAGINAS: readonly PaginaVerificada[] = [
  { ruta: '/servicios', httpStatus: 200, titulo: 'Servicios | Clínica QA', metaDescription: 'Atención dental integral para toda la familia en Curicó, con horas disponibles.', h1: ['Clínica dental'], indexable: true },
  { ruta: '/dra-claudia', httpStatus: 200, titulo: 'Rehabilitación oral', metaDescription: 'Rehabilitación oral con especialista: evaluación clínica y plan de tratamiento personalizado.', h1: ['Rehabilitación oral'], indexable: true },
];

const OFERTAS = [oferta('clinica-dental', 'clínica dental'), oferta('rehabilitacion-oral', 'rehabilitación oral')];

const semillas = (over: { paginas?: readonly PaginaVerificada[]; landings?: ReadonlyMap<string, string | null> } = {}) =>
  semillasDeSitio({
    oferta: OFERTAS,
    paginas: over.paginas ?? PAGINAS,
    localidades: ['Curicó', 'Teno'],
    marca: 'Clínica QA',
    landingPorOferta: over.landings ?? new Map([['clinica-dental', '/servicios'], ['rehabilitacion-oral', '/dra-claudia']]),
  });

const entrada = (over: Partial<EntradaPlanificador> = {}): EntradaPlanificador => ({
  organizationId: ORG,
  perfil: perfil(),
  oferta: OFERTAS,
  politica: politica(),
  runId: RUN,
  terminos: [],
  geos: [geo('Curicó'), geo('Teno')],
  canales: [canalConDemanda('INSUFFICIENT_EVIDENCE')],
  landings: [landing('clinica-dental', '/servicios'), landing('rehabilitacion-oral', '/dra-claudia')],
  techoDeclarado: { modalidad: 'DAILY', montoMinor: 3_000 },
  mandato: { diarioMinor: 2_500, totalMinor: 30_000, currency: 'CLP' },
  semillasSitio: semillas(),
  conversionExternaVerificada: false,
  historialDeConversiones: 0,
  version: 1,
  ahora: AHORA,
  ...over,
});

describe('precedencia del dinero: manda lo autorizado', () => {
  it('con mandato de 2.500 y una intención vieja de 3.000, el plan propone 2.500', () => {
    const { plan } = planificar(entrada());
    expect(plan.presupuesto.propuestoDiarioClp).toBe(2_500);
    expect(plan.presupuesto.base).toBe('HUMAN_MANDATE');
    expect(plan.presupuesto.topeMandatoDiarioClp).toBe(2_500);
    expect(plan.presupuesto.explicacion).toMatch(/manda la autorización/i);
  });

  it('si la intención es MENOR que lo autorizado, se respeta la intención', () => {
    const { plan } = planificar(entrada({ techoDeclarado: { modalidad: 'DAILY', montoMinor: 1_000 } }));
    expect(plan.presupuesto.propuestoDiarioClp).toBe(1_000);
    expect(plan.presupuesto.base).toBe('USER_CEILING');
  });

  it('sin intención declarada manda el mandato', () => {
    const { plan } = planificar(entrada({ techoDeclarado: null }));
    expect(plan.presupuesto.propuestoDiarioClp).toBe(2_500);
    expect(plan.presupuesto.base).toBe('HUMAN_MANDATE');
  });

  it('sin mandato ni intención no se propone gasto y el plan queda BLOQUEADO', () => {
    const { plan } = planificar(entrada({ techoDeclarado: null, mandato: null }));
    expect(plan.presupuesto.propuestoDiarioClp).toBeNull();
    expect(plan.estado).toBe('BLOCKED');
    expect(plan.prerequisitos.join(' ')).toMatch(/autorizar un presupuesto/i);
  });

  it('un mandato mensual sin tope diario se reparte, y nunca se propone más que eso', () => {
    const { plan } = planificar(entrada({ mandato: { diarioMinor: 1_000, totalMinor: 30_000, currency: 'CLP' } }));
    expect(plan.presupuesto.propuestoDiarioClp).toBe(1_000);
  });

  it('EL PLAN NUNCA SUPERA EL MANDATO, cualquiera sea la intención', () => {
    for (const intencion of [3_000, 10_000, 1_000_000]) {
      const { plan } = planificar(entrada({ techoDeclarado: { modalidad: 'DAILY', montoMinor: intencion } }));
      expect(plan.presupuesto.propuestoDiarioClp!).toBeLessThanOrEqual(2_500);
    }
  });
});

describe('cuando el planificador de palabras trae datos', () => {
  const conDemanda = () => entrada({
    terminos: [termino('dentista curico', 320), termino('clinica dental curico', 210)],
    canales: [canalConDemanda('SUITABLE')],
  });

  it('usa los datos del proveedor y no las semillas del sitio', () => {
    const { plan, grupos } = planificar(conDemanda());
    expect(plan.evidencia.origenKeywords).toBe('PROVIDER_DATA');
    expect(plan.evidencia.demanda).toBe('KNOWN');
    expect(plan.evidencia.confianza).toBe('FULL');
    expect(grupos.flatMap((g) => g.palabras).every((p) => p.origen === 'PROVIDER_DATA')).toBe(true);
    expect(grupos.flatMap((g) => g.palabras).some((p) => (p.volumenMensual ?? 0) > 0)).toBe(true);
  });
});

describe('cuando el planificador calla', () => {
  it('no concluye que no haya demanda: la marca DESCONOCIDA', () => {
    const { plan } = planificar(entrada());
    expect(plan.evidencia.demanda).toBe('UNKNOWN');
    expect(plan.evidencia.investigacion).toBe('PARTIAL');
    expect(plan.evidencia.confianza).toBe('LIMITED');
    expect(JSON.stringify(plan)).not.toMatch(/no hay demanda|sin búsquedas|demanda: 0/i);
  });

  it('planifica con semillas verificadas del sitio y queda REVIEW_REQUIRED', () => {
    const { plan, grupos } = planificar(entrada());
    expect(plan.estado).toBe('REVIEW_REQUIRED');
    expect(plan.evidencia.origenKeywords).toBe('VERIFIED_SITE_SEEDS');
    expect(grupos.length).toBeGreaterThan(0);
    expect(grupos.flatMap((g) => g.palabras).length).toBeGreaterThan(0);
  });

  it('NINGUNA palabra del fallback lleva volumen inventado', () => {
    const { grupos } = planificar(entrada());
    for (const p of grupos.flatMap((g) => g.palabras)) {
      expect(p.volumenMensual, `«${p.termino}» no puede declarar volumen`).toBeNull();
      expect(p.evidenciaDemanda).toBe('UNKNOWN');
      expect(p.origen).toBe('VERIFIED_SITE_SEEDS');
    }
  });

  it('las negativas son de intención no comercial, y pocas', () => {
    const { grupos } = planificar(entrada());
    const negativas = grupos[0]!.negativas.map((n) => n.termino);
    expect(negativas).toContain('empleo');
    expect(negativas).toContain('curso');
    expect(negativas.length).toBeLessThanOrEqual(10);
    // Nada que pueda excluir una búsqueda legítima de alguien que quiere atenderse.
    for (const prohibida of ['dental', 'dentista', 'clinica', 'precio', 'urgencia', 'curico']) {
      expect(negativas, `«${prohibida}» excluiría búsquedas legítimas`).not.toContain(prohibida);
    }
  });

  it('el presupuesto sigue mandándolo el mandato aunque las palabras vengan del sitio', () => {
    const { plan } = planificar(entrada());
    expect(plan.presupuesto.propuestoDiarioClp).toBe(2_500);
  });

  it('las limitaciones se dicen en el propio plan', () => {
    const { plan } = planificar(entrada());
    expect(plan.evidencia.limitaciones.join(' ')).toMatch(/sin medir|no hay volumen/i);
  });
});

describe('lo que el fallback NO hace', () => {
  it('sin página verificada no hay grupo para esa oferta', () => {
    const soloUna = semillas({ landings: new Map([['clinica-dental', '/servicios']]) });
    const { grupos } = planificar(entrada({ semillasSitio: soloUna }));
    expect(grupos.map((g) => g.ofertaSlug)).toEqual(['clinica-dental']);
  });

  it('sin sitio auditado y sin datos del proveedor, el plan queda BLOQUEADO', () => {
    const sinNada = semillasDeSitio({ oferta: OFERTAS, paginas: [], localidades: ['Curicó'], marca: 'Clínica QA', landingPorOferta: new Map() });
    const { plan, grupos } = planificar(entrada({ semillasSitio: sinNada, landings: [] }));
    expect(sinNada.utilizable).toBe(false);
    expect(grupos).toHaveLength(0);
    expect(plan.estado).toBe('BLOCKED');
  });

  it('sin territorio segmentable el plan queda BLOQUEADO aunque haya material', () => {
    const { plan } = planificar(entrada({ geos: [geo('Hualañé', false)] }));
    expect(plan.estado).toBe('BLOCKED');
    expect(plan.prerequisitos.join(' ')).toMatch(/territorio segmentable/i);
  });

  it('no inventa territorios que la plataforma no ofrece', () => {
    const { plan } = planificar(entrada({ geos: [geo('Curicó'), geo('Hualañé', false)] }));
    expect(plan.geografia.targets.map((t) => t.nombre)).toEqual(['Curicó']);
    expect(plan.geografia.noEjecutables).toEqual(['Hualañé']);
  });
});

describe('anuncios: sólo lo que el sitio ya dice', () => {
  it('propone titulares y descripciones respaldados, y lo declara', () => {
    const { plan } = planificar(entrada());
    expect(plan.anuncios.length).toBeGreaterThan(0);
    for (const a of plan.anuncios) {
      expect(a.titulares.length).toBeGreaterThan(0);
      expect(a.respaldo.length).toBeGreaterThan(0);
      for (const t of a.titulares) expect(t.length).toBeLessThanOrEqual(30);
      for (const d of a.descripciones) expect(d.length).toBeLessThanOrEqual(90);
    }
  });

  it('descarta promesas, precios y convenios aunque estén en el sitio', () => {
    const conClaims: readonly PaginaVerificada[] = [{
      ruta: '/servicios', httpStatus: 200,
      titulo: 'Implantes desde $99.000',
      metaDescription: 'Atendemos Fonasa e Isapre, resultados garantizados y 20 años de experiencia.',
      h1: ['Clínica dental sin dolor'], indexable: true,
    }];
    const s = semillasDeSitio({
      oferta: [oferta('clinica-dental', 'clínica dental')], paginas: conClaims, localidades: ['Curicó'],
      marca: 'Clínica QA', landingPorOferta: new Map([['clinica-dental', '/servicios']]),
    });
    // La prueba no puede pasar por vacío: tiene que haber anuncio, y limpio.
    expect(s.anuncios.length, 'queda material seguro con el que proponer').toBeGreaterThan(0);
    const textos = s.anuncios.flatMap((a) => [...a.titulares, ...a.descripciones]).join(' ').toLowerCase();
    for (const prohibido of ['$', 'fonasa', 'isapre', 'garantiz', 'sin dolor', '20 años']) {
      expect(textos, `«${prohibido}» no puede llegar a un anuncio`).not.toContain(prohibido);
    }
  });

  /**
   * SALIÓ DEL PLAN REAL DE CP. Los primeros borradores traían «rehabilitación oral en» y «Dra. Claudia
   * Pacheco R. —»: frases cortadas a treinta caracteres que ningún humano escribiría. Un titular a medias no
   * es un borrador, es basura que alguien tendría que limpiar a mano.
   */
  it('ningún texto propuesto queda colgando de un conector o un guión', () => {
    const s = semillasDeSitio({
      oferta: [oferta('rehabilitacion-oral', 'rehabilitación oral')],
      paginas: [{
        ruta: '/dra', httpStatus: 200,
        titulo: 'Dra. Claudia Pacheco R. — Especialista en Rehabilitación Oral | Clínica CP',
        metaDescription: 'Conoce a la Dra. Claudia Pacheco R., especialista en Rehabilitación Oral en Curicó. Trato cercano y evaluación completa.',
        h1: ['Dra. Claudia Pacheco R.'], indexable: true,
      }],
      localidades: ['Curicó', 'Sagrada Familia'],
      marca: 'CP Odontología',
      landingPorOferta: new Map([['rehabilitacion-oral', '/dra']]),
    });
    const textos = s.anuncios.flatMap((a) => [...a.titulares, ...a.descripciones]);
    expect(textos.length).toBeGreaterThan(0);
    for (const t of textos) {
      expect(t, `«${t}» termina colgando`).not.toMatch(/\s(en|de|del|la|el|los|las|y|o|con|para|por|a|al|un|una|que|su|sus)$/i);
      expect(t, `«${t}» termina en puntuación suelta`).not.toMatch(/[-—–|,;:]$/);
      expect(t.length).toBeGreaterThanOrEqual(10);
    }
  });

  it('un plan con borradores sigue exigiendo que alguien los apruebe', () => {
    const { plan } = planificar(entrada());
    expect(plan.readiness.CREATIVE_READY).toBe(false);
    expect(plan.prerequisitos.join(' ')).toMatch(/aprobar los textos/i);
    expect(plan.estado).not.toBe('EXECUTABLE');
  });
});

describe('aislamiento entre negocios', () => {
  it('el plan sólo lleva material de su propia organización', () => {
    const { plan, grupos } = planificar(entrada());
    expect(plan.organizationId).toBe(ORG);
    expect(grupos.every((g) => g.organizationId === ORG)).toBe(true);
    // Las semillas de OTRO negocio no pueden colarse: se construyen desde la entrada, no de un estado global.
    const otras = semillasDeSitio({
      oferta: [oferta('ortodoncia', 'ortodoncia')],
      paginas: [{ ruta: '/orto', httpStatus: 200, titulo: 'Ortodoncia', metaDescription: null, h1: ['Ortodoncia'], indexable: true }],
      localidades: ['Talca'], marca: 'Otra', landingPorOferta: new Map([['ortodoncia', '/orto']]),
    });
    const { grupos: gruposOtro } = planificar(entrada({ organizationId: 'org-otro', semillasSitio: otras, oferta: [oferta('ortodoncia', 'ortodoncia')], landings: [landing('ortodoncia', '/orto')] }));
    expect(gruposOtro.every((g) => g.organizationId === 'org-otro')).toBe(true);
    expect(JSON.stringify(gruposOtro)).not.toMatch(/curic/i);
  });
});
