/**
 * apps/api · PLANIFICACIÓN DE CAMPAÑAS · el planificador (función PURA).
 *
 * Convierte negocio + política + investigación + techo declarado en un PLAN EN BORRADOR. Determinista: con la
 * misma evidencia produce exactamente el mismo plan, lo que permite discutirlo, versionarlo y compararlo.
 *
 * LAS CUATRO REGLAS QUE MÁS IMPORTAN AQUÍ:
 *
 *  1. NO SE INVENTA PRESUPUESTO. Lo que se propone gastar sale del TECHO QUE DECLARÓ EL DUEÑO. Aparte, y
 *     etiquetado como derivación, se muestra lo que costaría capturar toda la demanda observada. Sin techo
 *     declarado no hay propuesta de gasto: el plan queda `NON_EXECUTABLE`.
 *  2. UNA OFERTA NO ES UNA CAMPAÑA. La estructura se decide con volumen, presupuesto, separación de intención y
 *     de landing: repartir un presupuesto pequeño entre varias campañas deja a todas sin datos suficientes.
 *  3. CONCORDANCIA AMPLIA SÓLO CON JUSTIFICACIÓN. Sin historial de conversiones y sin cobertura de negativas,
 *     `BROAD` gasta el presupuesto en búsquedas que nadie controla, así que no se propone.
 *  4. SIN MEDICIÓN NO HAY EJECUCIÓN. Si falta la conversión, se dice `CONVERSION_SETUP_REQUIRED` y
 *     `EXECUTION_READY = false`. Ese bloqueo no se esconde para que el plan parezca terminado.
 */
import type { OfertaNegocio, PerfilNegocio } from '../negocio/negocio-pg';
import type { PoliticaCompleta } from '../politica/politica-pg';
import type { CompatibilidadLanding, EvaluacionCanal, GeoEjecutable, TerminoInvestigado } from './investigacion-pg';
import type { ExplicacionPlan, GrupoDelPlan, PalabraDelPlan, PlanCampania, PropuestaPresupuesto, PropuestaPuja } from './plan-pg';
import { veredictoDe } from './analisis';
import {
  INTENCIONES_DE_PAGO,
  type DimensionPlan,
  type EstadoPlan,
  type RequisitoConversion,
  type RequisitoCreativo,
  type TipoConcordancia,
} from './investigacion-tipos';

export interface EntradaPlanificador {
  readonly organizationId: string;
  readonly perfil: PerfilNegocio;
  readonly oferta: readonly OfertaNegocio[];
  readonly politica: PoliticaCompleta;
  readonly runId: string;
  readonly terminos: readonly TerminoInvestigado[];
  readonly geos: readonly GeoEjecutable[];
  readonly canales: readonly EvaluacionCanal[];
  readonly landings: readonly CompatibilidadLanding[];
  readonly techoDeclarado: { readonly modalidad: string; readonly montoMinor: number | null } | null;
  /** `true` sólo si existe una acción de conversión verificada en la plataforma. Hoy nunca: no se crean. */
  readonly conversionExternaVerificada: boolean;
  /** Historial fiable de conversiones observado. Sin él, la puja no puede optimizar a conversiones. */
  readonly historialDeConversiones: number;
  readonly version: number;
  readonly ahora: string;
}

export interface ResultadoPlanificacion {
  readonly plan: PlanCampania;
  readonly grupos: readonly GrupoDelPlan[];
}

const volumenDe = (t: TerminoInvestigado): number => Number((t.metricas as { avgMonthlySearches?: number | null }).avgMonthlySearches ?? 0);
const pujaAltaDe = (t: TerminoInvestigado): number | null => {
  const micros = (t.metricas as { highTopOfPageBidMicros?: number | null }).highTopOfPageBidMicros ?? null;
  return micros === null ? null : Math.round(micros / 1_000_000);
};
const pujaBajaDe = (t: TerminoInvestigado): number | null => {
  const micros = (t.metricas as { lowTopOfPageBidMicros?: number | null }).lowTopOfPageBidMicros ?? null;
  return micros === null ? null : Math.round(micros / 1_000_000);
};

/** Mediana entera de una lista. Se prefiere a la media: un término carísimo no debe arrastrar la estimación. */
function mediana(valores: readonly number[]): number | null {
  const xs = valores.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const medio = Math.floor(xs.length / 2);
  return xs.length % 2 === 1 ? xs[medio]! : Math.round((xs[medio - 1]! + xs[medio]!) / 2);
}

/**
 * Concordancia propuesta para un término. `EXACT` cuando la intención es inequívoca y hay volumen; `PHRASE`
 * cuando la señal es buena pero el término admite variantes; `BROAD` nunca en un primer plan, y se explica.
 */
function concordanciaDe(t: TerminoInvestigado, cobertura: { readonly negativas: number; readonly historial: number }): { tipo: TipoConcordancia; justificacion: string } {
  const volumen = volumenDe(t);
  if ((t.intencion === 'TRANSACTIONAL' || t.intencion === 'LOCAL') && t.intencionConfianza === 'HIGH' && volumen > 0) {
    return { tipo: 'EXACT', justificacion: `intención ${t.intencion === 'LOCAL' ? 'local' : 'de contratación'} inequívoca con volumen observado (${volumen}/mes): conviene pagar sólo por esa búsqueda` };
  }
  if (t.intencion === 'COMMERCIAL' && t.intencionConfianza === 'HIGH') {
    return { tipo: 'PHRASE', justificacion: 'intención comercial clara, pero el término admite variantes: frase permite capturarlas sin abrir del todo' };
  }
  if (cobertura.historial > 50 && cobertura.negativas >= 5 && volumen > 0) {
    return { tipo: 'BROAD', justificacion: `se justifica amplia: hay historial de conversiones (${cobertura.historial}) y cobertura de negativas (${cobertura.negativas}) para controlar el gasto` };
  }
  return { tipo: 'PHRASE', justificacion: 'señal suficiente pero no inequívoca: frase limita el gasto sin perder variantes razonables' };
}

/**
 * Genera el plan. NO escribe nada: devuelve el plan y sus grupos para que el servicio los persista con su
 * versión. Así el planificador se puede probar sin base de datos.
 */
export function planificar(e: EntradaPlanificador): ResultadoPlanificacion {
  const explicacion: ExplicacionPlan[] = [];
  const prerequisitos: string[] = [];
  const anotar = (decision: string, porque: string, evidenciaIds: readonly string[] = []): void => {
    explicacion.push({ decision, porque, evidenciaIds });
  };

  // ── CANAL ──
  const veredictoSearch = veredictoDe(e.canales, 'GOOGLE_SEARCH');
  const canal = 'GOOGLE_SEARCH';
  anotar(
    'Canal propuesto: buscador de Google',
    `es el único canal con demanda medible antes de gastar y su evaluación en esta investigación fue ${veredictoSearch}.`,
    e.canales.find((c) => c.canal === 'GOOGLE_SEARCH')?.evidenciaIds ?? [],
  );
  if (veredictoSearch === 'BLOCKED') prerequisitos.push('el negocio declaró Google como canal prohibido: hay que revisarlo antes de planificar aquí');
  if (veredictoSearch === 'INSUFFICIENT_EVIDENCE') {
    /**
     * EL PRERREQUISITO DICE LO QUE DE VERDAD PASÓ. Antes daba por hecho que «no se pudo medir la demanda»
     * significaba «falta conectar Google», y se lo decía a una empresa que tenía su cuenta conectada desde
     * hacía días: pedirle a alguien que haga algo que ya hizo es peor que no decirle nada. Ahora se traslada
     * el motivo observado del propio canal —sin conexión, consulta fallida o planificador sin términos—, que
     * es el único que sabe cuál de los tres ocurrió.
     */
    prerequisitos.push(e.canales.find((c) => c.canal === 'GOOGLE_SEARCH')?.motivos[0] ?? 'no se pudo medir la demanda de búsqueda');
  }
  if (veredictoSearch === 'NOT_SUITABLE') prerequisitos.push('la demanda observada no justifica invertir en buscador con la oferta actual');

  // ── OBJETIVO ──
  const objetivo = e.politica.politica?.objectiveText ?? e.perfil.primaryObjective ?? 'sin objetivo declarado';
  if (objetivo === 'sin objetivo declarado') prerequisitos.push('declarar qué quiere conseguir el negocio');

  // ── GEOGRAFÍA ──
  const ejecutables = e.geos.filter((g) => g.disponible);
  const noEjecutables = e.geos.filter((g) => !g.disponible).map((g) => g.solicitado);
  const aproximaciones = ejecutables.filter((g) => g.aproximacion).map((g) => g.solicitado);
  if (ejecutables.length === 0) {
    prerequisitos.push('comprobar qué parte del territorio comercial se puede segmentar en la plataforma');
  }
  if (noEjecutables.length > 0) {
    // Excluir territorio que el dueño SÍ declaró atender no puede ser una nota al pie: es una decisión suya.
    prerequisitos.push(`decidir cómo cubrir ${noEjecutables.join(', ')}: la plataforma no permite segmentar ese territorio tal como está declarado`);
    anotar(
      `Se excluyen del plan ${noEjecutables.length} territorio(s) que la plataforma no permite segmentar`,
      `la plataforma no ofrece un objetivo geográfico para ${noEjecutables.join(', ')}; usar una unidad más amplia anunciaría fuera del área autorizada.`,
      noEjecutables.map((n) => `ev-geo-${n.toLowerCase().replace(/\s+/g, '-')}`),
    );
  }
  if (aproximaciones.length > 0) {
    prerequisitos.push(`revisar el alcance en ${aproximaciones.join(', ')}: sólo se alcanza con una unidad más amplia y puede salir del territorio autorizado`);
  }

  // ── OFERTAS Y TÉRMINOS ──
  const activas = e.oferta.filter((o) => o.status === 'ACTIVE').sort((a, b) => a.priority - b.priority);
  const landingPorOferta = new Map(e.landings.map((l) => [l.ofertaSlug, l]));
  const candidatos = e.terminos.filter((t) => t.elegibilidad === 'CANDIDATE' && INTENCIONES_DE_PAGO.includes(t.intencion));
  const negativas = e.terminos
    .filter((t) => t.elegibilidad === 'EXCLUDED')
    .map((t) => ({ termino: t.termino, motivo: t.motivoExclusion ?? 'excluido por la investigación' }));

  const conVolumen = (slug: string): readonly TerminoInvestigado[] =>
    candidatos.filter((t) => t.ofertaSlug === slug).sort((a, b) => volumenDe(b) - volumenDe(a));
  const ofertasConDemanda = activas.filter((o) => conVolumen(o.slug).some((t) => volumenDe(t) > 0));
  const ofertasPlanificables = ofertasConDemanda.filter((o) => landingPorOferta.get(o.slug)?.estado !== 'BLOCKED');

  for (const o of ofertasConDemanda) {
    const landing = landingPorOferta.get(o.slug) ?? null;
    if (landing?.estado === 'BLOCKED') {
      prerequisitos.push(`«${o.name}» queda fuera del plan: su página choca con una restricción declarada (${landing.motivos.join('; ')})`);
    } else if (landing?.estado === 'MISSING') {
      prerequisitos.push(`crear una página de destino para «${o.name}»`);
    } else if (landing?.estado === 'WEAK') {
      prerequisitos.push(`mejorar la página de «${o.name}»: ${landing.motivos.join('; ')}`);
    }
  }

  // ── PRESUPUESTO ──
  const cpcEstimado = mediana(candidatos.map((t) => pujaAltaDe(t) ?? pujaBajaDe(t) ?? 0).filter((v): v is number => v !== null));
  const volumenTotal = candidatos.reduce((a, t) => a + volumenDe(t), 0);
  const oportunidadDiaria = cpcEstimado !== null && volumenTotal > 0 ? Math.round((volumenTotal / 30) * cpcEstimado) : null;
  const techoDiario = e.techoDeclarado === null || e.techoDeclarado.montoMinor === null
    ? null
    : e.techoDeclarado.modalidad === 'DAILY'
      ? e.techoDeclarado.montoMinor
      : e.techoDeclarado.modalidad === 'MONTHLY'
        ? Math.round(e.techoDeclarado.montoMinor / 30)
        : null;

  const presupuesto: PropuestaPresupuesto = {
    techoDeclaradoClp: e.techoDeclarado?.montoMinor ?? null,
    modalidadTecho: e.techoDeclarado?.modalidad ?? null,
    propuestoDiarioClp: techoDiario,
    oportunidadDiariaClp: oportunidadDiaria,
    costoPorClicEstimadoClp: cpcEstimado,
    base: techoDiario === null ? 'NONE' : 'USER_CEILING',
    explicacion: techoDiario === null
      ? 'No hay techo declarado por el dueño, así que no se propone ningún gasto: proponerlo sería inventar dinero ajeno.'
      : `Se propone gastar hasta ${techoDiario} CLP al día, que es el techo que declaró el dueño.${cpcEstimado !== null ? ` Con un costo por clic observado de ~${cpcEstimado} CLP, eso permite del orden de ${Math.max(0, Math.floor(techoDiario / cpcEstimado))} clics diarios.` : ''}${oportunidadDiaria !== null ? ` Capturar toda la demanda observada costaría ~${oportunidadDiaria} CLP al día (derivado, no una recomendación).` : ''}`,
  };
  if (techoDiario === null) {
    prerequisitos.push('declarar cuánto se está dispuesto a invertir como máximo');
  } else if (cpcEstimado !== null && techoDiario < cpcEstimado) {
    prerequisitos.push(`el techo declarado (${techoDiario} CLP/día) no alcanza para un solo clic al costo observado (~${cpcEstimado} CLP)`);
  }
  anotar('Presupuesto propuesto', presupuesto.explicacion, candidatos.slice(0, 5).map((t) => `ev-kw-${t.terminoNormalizado.replace(/\s/g, '-')}`));

  // ── PUJA ──
  const puja: PropuestaPuja = e.historialDeConversiones >= 30
    ? {
        estrategia: 'MAXIMIZE_CONVERSIONS',
        techoCpcClp: null,
        justificacion: `hay historial de ${e.historialDeConversiones} conversiones observadas: optimizar a conversiones tiene datos con los que aprender`,
      }
    : {
        estrategia: 'MAXIMIZE_CLICKS_WITH_CPC_CEILING',
        techoCpcClp: cpcEstimado,
        justificacion: `sin historial fiable de conversiones (${e.historialDeConversiones} observadas) optimizar a conversiones no tendría con qué aprender; se propone comprar clics con techo de costo${cpcEstimado !== null ? ` (~${cpcEstimado} CLP)` : ''} para obtener las primeras señales`,
      };
  anotar(`Estrategia de puja propuesta: ${puja.estrategia === 'MAXIMIZE_CONVERSIONS' ? 'optimizar a conversiones' : 'comprar clics con techo de costo'}`, puja.justificacion);

  // ── ESTRUCTURA ──
  const suficienteParaVarias = techoDiario !== null && cpcEstimado !== null && techoDiario >= cpcEstimado * 10 && ofertasPlanificables.length >= 2;
  const landingsDistintas = new Set(ofertasPlanificables.map((o) => landingPorOferta.get(o.slug)?.url ?? o.slug)).size === ofertasPlanificables.length;
  const estructura = suficienteParaVarias && landingsDistintas && ofertasPlanificables.length >= 3
    ? {
        tipo: 'CAMPANA_POR_OFERTA' as const,
        justificacion: `hay ${ofertasPlanificables.length} ofertas con demanda propia, páginas distintas y presupuesto suficiente (${techoDiario} CLP/día frente a un costo por clic de ~${cpcEstimado} CLP) para que cada campaña acumule datos por su cuenta`,
      }
    : {
        tipo: 'UNA_CAMPANA_VARIOS_GRUPOS' as const,
        justificacion: ofertasPlanificables.length <= 1
          ? 'sólo hay una oferta con demanda observada: una campaña con un grupo'
          : `con ${techoDiario ?? 0} CLP al día repartidos entre ${ofertasPlanificables.length} ofertas, varias campañas quedarían sin datos suficientes cada una; una campaña con un grupo por oferta mantiene la medición separada sin dividir el presupuesto`,
      };
  anotar(
    estructura.tipo === 'UNA_CAMPANA_VARIOS_GRUPOS'
      ? `Se propone UNA campaña con ${Math.max(1, ofertasPlanificables.length)} grupo(s)`
      : `Se propone una campaña por oferta (${ofertasPlanificables.length})`,
    estructura.justificacion,
  );

  // ── GRUPOS ──
  const cobertura = { negativas: negativas.length, historial: e.historialDeConversiones };
  const grupos: GrupoDelPlan[] = ofertasPlanificables.map((o) => {
    const suyos = conVolumen(o.slug).slice(0, 15);
    const landing = landingPorOferta.get(o.slug) ?? null;
    const palabras: PalabraDelPlan[] = suyos.map((t) => {
      const c = concordanciaDe(t, cobertura);
      return { termino: t.termino, concordancia: c.tipo, justificacion: c.justificacion, volumenMensual: volumenDe(t) || null };
    });
    return {
      organizationId: e.organizationId,
      planId: '', // lo fija el servicio al persistir
      id: o.slug,
      nombre: o.name,
      ofertaSlug: o.slug,
      landing: landing?.url ?? o.landingUrl ?? null,
      palabras,
      negativas,
      justificacion: `${palabras.length} término(s) con demanda observada para «${o.name}»; la página de destino está ${landing?.estado ?? 'sin revisar'}`,
    };
  });

  if (negativas.length > 0) {
    anotar(
      `Se proponen ${negativas.length} palabra(s) negativa(s)`,
      `salen de la investigación con su motivo (empleo, formación o incompatibilidad con lo que el negocio declaró). Son CANDIDATAS: aplicarlas sigue siendo una decisión humana.`,
    );
  }
  const amplias = grupos.flatMap((g) => g.palabras).filter((p) => p.concordancia === 'BROAD').length;
  if (amplias === 0) {
    anotar(
      'No se propone concordancia amplia',
      `sin historial de conversiones (${e.historialDeConversiones}) y con ${negativas.length} negativa(s) de cobertura, la concordancia amplia gastaría el presupuesto en búsquedas que nadie controla.`,
    );
  }

  // ── REQUISITOS DE CREATIVIDADES Y MEDICIÓN ──
  const requisitosCreativos: readonly RequisitoCreativo[] = ['RSA_REQUIRED'];
  anotar('Hará falta escribir anuncios de búsqueda', 'un plan de buscador necesita titulares y descripciones; esta fase no los genera, sólo declara que faltan.');

  const eventos = e.politica.eventos.map((x) => x.eventKey);
  const requisitoConversion: RequisitoConversion = eventos.length === 0
    ? 'CONVERSION_SETUP_REQUIRED'
    : e.conversionExternaVerificada
      ? 'CONVERSION_READY'
      : 'CONVERSION_TRACKING_UNVERIFIED';
  if (requisitoConversion === 'CONVERSION_SETUP_REQUIRED') {
    prerequisitos.push('declarar qué acción de un cliente cuenta como resultado');
  } else if (requisitoConversion === 'CONVERSION_TRACKING_UNVERIFIED') {
    prerequisitos.push('crear y verificar la conversión en la plataforma (SOEC todavía no las crea)');
  }

  // ── PREPARACIÓN POR DIMENSIONES ──
  const hayDemanda = candidatos.some((t) => volumenDe(t) > 0);
  const landingLista = ofertasPlanificables.length > 0 && ofertasPlanificables.every((o) => landingPorOferta.get(o.slug)?.estado === 'READY');
  const readiness: Record<DimensionPlan, boolean> = {
    RESEARCH_READY: hayDemanda && ejecutables.length > 0,
    LANDING_READY: landingLista,
    MEASUREMENT_READY: requisitoConversion === 'CONVERSION_READY',
    BUDGET_READY: techoDiario !== null && (cpcEstimado === null || techoDiario >= cpcEstimado),
    CREATIVE_READY: false, // no hay anuncios escritos: esta fase no los genera
    EXECUTION_READY: false, // se calcula abajo y NUNCA es true en esta fase
  };
  readiness.EXECUTION_READY = readiness.RESEARCH_READY && readiness.LANDING_READY && readiness.MEASUREMENT_READY && readiness.BUDGET_READY && readiness.CREATIVE_READY;
  if (!readiness.CREATIVE_READY) prerequisitos.push('escribir los anuncios (títulos y descripciones)');

  const estado: EstadoPlan = readiness.EXECUTION_READY ? 'DRAFT' : 'NON_EXECUTABLE';

  const plan: PlanCampania = {
    organizationId: e.organizationId,
    id: `plan-v${e.version}-${e.runId}`,
    version: e.version,
    researchRunId: e.runId,
    estado,
    canal,
    objetivo,
    ofertas: ofertasPlanificables.map((o) => o.slug),
    geografia: {
      targets: ejecutables.map((g) => ({ nombre: g.solicitado, targetId: g.targetId, tipo: g.targetTipo })),
      noEjecutables,
      aproximaciones,
    },
    presupuesto,
    puja,
    estructura,
    requisitosCreativos,
    requisitoConversion,
    prerequisitos: [...new Set(prerequisitos)],
    readiness,
    explicacion,
    creadoEn: e.ahora,
    staleDesde: null,
    motivoStale: null,
  };

  return { plan, grupos: grupos.map((g) => ({ ...g, planId: plan.id })) };
}
