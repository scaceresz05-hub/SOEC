/**
 * apps/api · INVESTIGACIÓN AUTÓNOMA · análisis (funciones puras).
 *
 * Tres derivaciones, todas deterministas y todas con sus motivos a la vista:
 *
 *   `evaluarLandings`  ¿existe una página capaz de recibir a quien busca esta oferta?
 *   `evaluarCanales`   ¿qué canal tiene sentido con la evidencia que HAY —no con la que nos gustaría tener?
 *   `derivarHallazgos` ¿qué frases con sentido de negocio se sostienen sobre esa evidencia?
 *
 * REGLA CENTRAL: demanda no es recomendación. Que un término tenga muchas búsquedas no significa «invertir
 * ahí»: hace falta relevancia, intención, una página donde aterrizar, una vía de contacto, territorio
 * ejecutable, presupuesto declarado y ausencia de conflictos con lo que el negocio dijo que no puede afirmar.
 * Un canal `SUITABLE` con landing ausente sería una promesa falsa; aquí eso devuelve `POSSIBLE` con el motivo.
 */
import type { OfertaNegocio, RestriccionNegocio } from '../negocio/negocio-pg';
import type { AuditoriaSitio, PaginaObservada } from './proveedores';
import type { CompatibilidadLanding, EvaluacionCanal, GeoEjecutable, Hallazgo, TerminoInvestigado } from './investigacion-pg';
import {
  INTENCIONES_DE_PAGO,
  confianzaDesdeEvidencia,
  normalizarTermino,
  raicesDeTexto,
  type CanalEvaluado,
  type ClaseEvidencia,
  type EstadoLanding,
  type VeredictoCanal,
} from './investigacion-tipos';
import { terminosDeRestriccion } from './intencion';

export type EstadoDemanda = 'SIN_FUENTE' | 'SIN_RESPUESTA' | 'SIN_IDEAS' | 'CON_DATOS';

export interface ContextoAnalisis {
  readonly organizationId: string;
  readonly runId: string;
  readonly oferta: readonly OfertaNegocio[];
  readonly restricciones: readonly RestriccionNegocio[];
  readonly auditoria: AuditoriaSitio | null;
  readonly terminos: readonly TerminoInvestigado[];
  readonly geos: readonly GeoEjecutable[];
  /** Eventos de conversión declarados en la política (Fase C). Vacío ⇒ no hay qué medir. */
  readonly eventosConversion: readonly string[];
  /** Techo de inversión declarado (Fase D). `null` ⇒ no hay presupuesto declarado. */
  readonly techoDeclarado: { readonly modalidad: string; readonly montoMinor: number | null } | null;
  /** Canales permitidos o prohibidos declarados por el negocio (Fase C). */
  readonly reglasCanal: readonly { readonly canal: string; readonly modo: string }[];
  /**
   * QUÉ PASÓ CON LA DEMANDA DE BÚSQUEDA en esta corrida. Era un booleano, y esa era su falla: agrupaba
   * «el planificador contestó con términos» con «el planificador contestó y no trajo ninguno», y del segundo
   * caso se concluía que el negocio no tiene demanda. No es lo mismo. Un planificador que devuelve una lista
   * vacía para «clínica dental» no está midiendo un mercado sin búsquedas: está callando —pasa, por ejemplo,
   * con cuentas nuevas sin historial—. Convertir ese silencio en «este canal no sirve» es inventar un
   * veredicto, y encima uno que bloquea el plan del negocio.
   *
   *  · SIN_FUENTE   — no hay cuenta conectada con la que preguntar;
   *  · SIN_RESPUESTA— se preguntó y la consulta falló;
   *  · SIN_IDEAS    — se preguntó, respondió, y no trajo ni un término: no se sabe;
   *  · CON_DATOS    — trajo términos; lo que digan sus métricas SÍ es una observación.
   */
  readonly demanda: EstadoDemanda;
  /** `true` si el proveedor de mercado devolvió competidores. */
  readonly competidoresDisponibles: boolean;
  readonly ahora: string;
}

/**
 * ¿La página habla de esta oferta? Coincidencia por ruta, título o encabezados, comparando RAÍCES: una página
 * «/implante-dental» corresponde a la oferta «Implantes dentales», y exigir la forma exacta la declararía ausente.
 */
function afinidadConLaOferta(p: PaginaObservada, oferta: OfertaNegocio): number {
  const claves = raicesDeTexto(oferta.name);
  if (claves.length === 0) return 0;
  const suyas = new Set([
    ...raicesDeTexto(p.ruta.replace(/[/\-_]/g, ' ')),
    ...raicesDeTexto(p.titulo ?? ''),
    ...raicesDeTexto([...p.h1, ...p.h2].join(' ')),
  ]);
  return claves.filter((c) => suyas.has(c)).length;
}

const paginaDeLaOferta = (p: PaginaObservada, oferta: OfertaNegocio): boolean => afinidadConLaOferta(p, oferta) > 0;

/**
 * Página que MEJOR corresponde a la oferta. Con varias páginas que comparten una palabra genérica, quedarse con
 * la primera mandaría el tráfico de una oferta a la página de otra.
 */
function mejorPagina(paginas: readonly PaginaObservada[], oferta: OfertaNegocio): PaginaObservada | null {
  let mejor: { pagina: PaginaObservada; afinidad: number } | null = null;
  for (const p of paginas) {
    const afinidad = afinidadConLaOferta(p, oferta);
    if (afinidad > 0 && (mejor === null || afinidad > mejor.afinidad)) mejor = { pagina: p, afinidad };
  }
  return mejor?.pagina ?? null;
}

/** ¿El texto de la página choca con algo que el negocio declaró que NO puede afirmar? */
function conflictoDeClaim(p: PaginaObservada, restricciones: readonly RestriccionNegocio[]): RestriccionNegocio | null {
  const texto = normalizarTermino([p.titulo ?? '', p.metaDescription ?? '', ...p.h1, ...p.h2].join(' '));
  for (const r of restricciones) {
    if (r.tipo !== 'PROHIBITED_CLAIM') continue;
    const claves = terminosDeRestriccion(r.texto);
    if (claves.some((c) => texto.includes(c))) return r;
  }
  return null;
}

/**
 * Compatibilidad de cada oferta PRIORITARIA con su página de destino. No se crea ninguna landing: se dice si
 * existe, si sirve y qué le falta.
 */
export function evaluarLandings(ctx: ContextoAnalisis): readonly CompatibilidadLanding[] {
  const prioritarias = ctx.oferta.filter((o) => o.status === 'ACTIVE').sort((a, b) => a.priority - b.priority).slice(0, 8);
  const paginas = ctx.auditoria?.paginas ?? [];
  const portada = paginas.find((p) => p.ruta === '/') ?? null;

  return prioritarias.map((oferta) => {
    const motivos: string[] = [];
    if (ctx.auditoria === null) {
      return { organizationId: ctx.organizationId, runId: ctx.runId, ofertaSlug: oferta.slug, estado: 'MISSING' as EstadoLanding, url: oferta.landingUrl, motivos: ['el negocio no tiene sitio web revisado'] };
    }
    if (!ctx.auditoria.alcanzable) {
      return { organizationId: ctx.organizationId, runId: ctx.runId, ofertaSlug: oferta.slug, estado: 'MISSING', url: oferta.landingUrl, motivos: [`el sitio no respondió: ${ctx.auditoria.error ?? 'sin detalle'}`] };
    }

    const declarada = oferta.landingUrl !== null ? paginas.find((p) => oferta.landingUrl!.includes(p.ruta) && p.ruta !== '/') ?? null : null;
    const dedicada = declarada ?? mejorPagina(paginas.filter((p) => p.ruta !== '/'), oferta);
    const mencionada = dedicada ?? (portada !== null && paginaDeLaOferta(portada, oferta) ? portada : null);

    if (mencionada === null) {
      return {
        organizationId: ctx.organizationId, runId: ctx.runId, ofertaSlug: oferta.slug, estado: 'MISSING',
        url: null, motivos: [`ninguna página del sitio habla de «${oferta.name}»`],
      };
    }

    const conflicto = conflictoDeClaim(mencionada, ctx.restricciones);
    if (conflicto !== null) {
      return {
        organizationId: ctx.organizationId, runId: ctx.runId, ofertaSlug: oferta.slug, estado: 'BLOCKED',
        url: mencionada.ruta, motivos: [`la página menciona algo que el negocio declaró que no puede afirmar: «${conflicto.texto}»`],
      };
    }
    if (!mencionada.indexable) motivos.push('la página no es indexable (no debería recibir tráfico pagado sin revisarla)');
    if (dedicada === null) motivos.push(`no hay página propia para «${oferta.name}»: sólo se menciona en la portada`);
    if (mencionada.ctas.length === 0) motivos.push('la página no invita a hacer nada (sin llamada a la acción visible)');
    if (mencionada.viasDeContacto.length === 0) motivos.push('la página no ofrece una vía de contacto');

    const estado: EstadoLanding = !mencionada.indexable
      ? 'BLOCKED'
      : motivos.length === 0
        ? 'READY'
        : 'WEAK';
    return { organizationId: ctx.organizationId, runId: ctx.runId, ofertaSlug: oferta.slug, estado, url: mencionada.ruta, motivos };
  });
}

/** Demanda relevante: términos candidatos con intención de pago y volumen observado. */
export function demandaRelevante(terminos: readonly TerminoInvestigado[]): {
  readonly candidatos: readonly TerminoInvestigado[];
  readonly volumenTotal: number;
  readonly mejor: TerminoInvestigado | null;
} {
  const candidatos = terminos.filter((t) => t.elegibilidad === 'CANDIDATE' && INTENCIONES_DE_PAGO.includes(t.intencion));
  const volumen = (t: TerminoInvestigado): number => Number((t.metricas as { avgMonthlySearches?: number | null }).avgMonthlySearches ?? 0);
  const conVolumen = candidatos.filter((t) => volumen(t) > 0);
  const volumenTotal = conVolumen.reduce((a, t) => a + volumen(t), 0);
  const mejor = [...conVolumen].sort((a, b) => volumen(b) - volumen(a))[0] ?? null;
  return { candidatos, volumenTotal, mejor };
}

const reglaCanal = (ctx: ContextoAnalisis, alias: readonly string[]): string | null =>
  ctx.reglasCanal.find((r) => alias.includes(normalizarTermino(r.canal).replace(/\s/g, '_')))?.modo ?? null;

/**
 * Veredicto por canal, con motivos. Nunca un número del 1 al 10: un ranking arbitrario no se puede discutir ni
 * corregir, y esconde de qué depende la respuesta.
 */
export function evaluarCanales(ctx: ContextoAnalisis): readonly EvaluacionCanal[] {
  const { candidatos, volumenTotal, mejor } = demandaRelevante(ctx.terminos);
  const landings = evaluarLandings(ctx);
  const hayLandingLista = landings.some((l) => l.estado === 'READY');
  const hayLandingUsable = landings.some((l) => l.estado === 'READY' || l.estado === 'WEAK');
  const geoEjecutable = ctx.geos.filter((g) => g.disponible);
  const hayContacto = (ctx.auditoria?.paginas ?? []).some((p) => p.viasDeContacto.length > 0);
  const hayConversion = ctx.eventosConversion.length > 0;
  const hayTecho = ctx.techoDeclarado !== null && (ctx.techoDeclarado.modalidad === 'DAILY' || ctx.techoDeclarado.modalidad === 'MONTHLY');
  const evidenciaIds = (ids: readonly string[]): readonly string[] => ids.filter((x) => x !== '');

  const salida: EvaluacionCanal[] = [];

  // ── GOOGLE_SEARCH: el canal donde la demanda se puede MEDIR antes de gastar ──
  {
    const motivos: string[] = [];
    let veredicto: VeredictoCanal;
    const prohibido = reglaCanal(ctx, ['google_ads', 'google_search', 'google']) === 'FORBIDDEN';
    if (prohibido) {
      veredicto = 'BLOCKED';
      motivos.push('el negocio declaró este canal como prohibido');
    } else if (ctx.demanda === 'SIN_FUENTE') {
      veredicto = 'INSUFFICIENT_EVIDENCE';
      motivos.push('no hay datos de demanda de búsqueda: falta conectar la cuenta de Google para poder medirla');
    } else if (ctx.demanda === 'SIN_RESPUESTA') {
      veredicto = 'INSUFFICIENT_EVIDENCE';
      motivos.push('se preguntó por la demanda de búsqueda y la consulta no respondió: no se pudo medir');
    } else if (ctx.demanda === 'SIN_IDEAS') {
      // El planificador contestó sin traer un solo término. Eso no dice que nadie busque esto: dice que hoy
      // no tenemos con qué afirmarlo ni negarlo, y un «no sirve» aquí sería un veredicto inventado.
      veredicto = 'INSUFFICIENT_EVIDENCE';
      motivos.push('el planificador de palabras respondió sin ningún término: no hay con qué medir la demanda, y no se concluye que no exista');
    } else if (candidatos.length === 0 || volumenTotal === 0) {
      veredicto = 'NOT_SUITABLE';
      motivos.push('se consultó la demanda y no aparecen búsquedas relevantes para lo que ofrece el negocio');
    } else {
      motivos.push(`hay demanda observada: ${volumenTotal} búsquedas mensuales en ${candidatos.length} términos relevantes`);
      if (mejor !== null) motivos.push(`el término con más volumen es «${mejor.termino}»`);
      if (!hayLandingUsable) {
        veredicto = 'POSSIBLE';
        motivos.push('falta una página donde aterrizar a quien haga clic');
      } else if (geoEjecutable.length === 0) {
        veredicto = 'POSSIBLE';
        motivos.push('todavía no se sabe qué parte del territorio se puede segmentar en la plataforma');
      } else if (!hayConversion) {
        veredicto = 'POSSIBLE';
        motivos.push('falta declarar qué acción cuenta como resultado para poder medir');
      } else if (!hayTecho) {
        veredicto = 'POSSIBLE';
        motivos.push('falta declarar cuánto se está dispuesto a invertir');
      } else if (!hayLandingLista) {
        veredicto = 'POSSIBLE';
        motivos.push('la página de destino existe pero le falta algo (ver compatibilidad de landings)');
      } else {
        veredicto = 'SUITABLE';
      }
    }
    salida.push({
      organizationId: ctx.organizationId, runId: ctx.runId, canal: 'GOOGLE_SEARCH', veredicto, motivos,
      evidenciaIds: evidenciaIds(candidatos.slice(0, 5).map((t) => `ev-kw-${t.terminoNormalizado.replace(/\s/g, '-')}`)),
    });
  }

  // ── META_PAID: sin saber si hay material visual, la respuesta honesta es que falta evidencia ──
  {
    const motivos: string[] = [];
    let veredicto: VeredictoCanal;
    const prohibido = reglaCanal(ctx, ['meta', 'meta_ads', 'facebook', 'instagram']) === 'FORBIDDEN';
    if (prohibido) {
      veredicto = 'BLOCKED';
      motivos.push('el negocio declaró este canal como prohibido');
    } else {
      veredicto = 'INSUFFICIENT_EVIDENCE';
      motivos.push('no sabemos si hay material visual (fotos o vídeo) disponible para anunciar');
      if (!hayContacto) motivos.push('tampoco se detectó una vía de contacto clara en el sitio');
      if (!hayConversion) motivos.push('falta declarar qué acción cuenta como resultado');
      if (hayContacto && hayConversion) motivos.push('el resto de las condiciones sí se cumplen: con material visual pasaría a evaluable');
    }
    salida.push({ organizationId: ctx.organizationId, runId: ctx.runId, canal: 'META_PAID', veredicto, motivos, evidenciaIds: [] });
  }

  // ── ORGANIC_SEARCH: se juzga con lo que el propio sitio ya demuestra ──
  {
    const motivos: string[] = [];
    let veredicto: VeredictoCanal;
    const paginas = ctx.auditoria?.paginas ?? [];
    const indexables = paginas.filter((p) => p.indexable);
    if (ctx.auditoria === null || !ctx.auditoria.alcanzable) {
      veredicto = 'NOT_SUITABLE';
      motivos.push('sin un sitio que responda no hay posicionamiento orgánico posible');
    } else if (indexables.length === 0) {
      veredicto = 'NOT_SUITABLE';
      motivos.push('ninguna página revisada es indexable');
    } else {
      const conTitulo = indexables.filter((p) => (p.titulo ?? '') !== '').length;
      const conDescripcion = indexables.filter((p) => (p.metaDescription ?? '') !== '').length;
      motivos.push(`${indexables.length} páginas indexables revisadas; ${conTitulo} con título y ${conDescripcion} con descripción`);
      veredicto = conTitulo === indexables.length && conDescripcion >= Math.ceil(indexables.length / 2) ? 'SUITABLE' : 'POSSIBLE';
      if (veredicto === 'POSSIBLE') motivos.push('faltan títulos o descripciones en parte del sitio');
    }
    salida.push({
      organizationId: ctx.organizationId, runId: ctx.runId, canal: 'ORGANIC_SEARCH', veredicto, motivos,
      evidenciaIds: evidenciaIds((ctx.auditoria?.paginas ?? []).slice(0, 5).map((p) => `ev-site-${p.ruta === '/' ? 'portada' : p.ruta.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')}`)),
    });
  }

  // ── ORGANIC_SOCIAL: no se ha observado ninguna cuenta; no se inventa una ──
  salida.push({
    organizationId: ctx.organizationId, runId: ctx.runId, canal: 'ORGANIC_SOCIAL', veredicto: 'INSUFFICIENT_EVIDENCE',
    motivos: ['no se ha observado ninguna cuenta social del negocio en esta investigación'], evidenciaIds: [],
  });

  return salida;
}

/**
 * Hallazgos: frases con sentido de negocio, cada una apuntando a las evidencias que la sostienen. Nunca prosa
 * suelta: si no hay evidencia detrás, no se guarda el hallazgo.
 */
export function derivarHallazgos(ctx: ContextoAnalisis, landings: readonly CompatibilidadLanding[]): readonly Hallazgo[] {
  const salida: Hallazgo[] = [];
  const añadir = (
    id: string,
    tipo: Hallazgo['tipo'],
    statement: string,
    evidenciaIds: readonly string[],
    clases: readonly ClaseEvidencia[],
    areaImpacto: Hallazgo['areaImpacto'],
  ): void => {
    salida.push({
      organizationId: ctx.organizationId, runId: ctx.runId, id, tipo, statement, evidenciaIds,
      confianza: confianzaDesdeEvidencia(clases), areaImpacto, descubiertoEn: ctx.ahora, expiraEn: null,
    });
  };

  const { candidatos, volumenTotal, mejor } = demandaRelevante(ctx.terminos);
  if (ctx.demanda === 'SIN_FUENTE') {
    añadir('h-demanda-sin-datos', 'DATA_INSUFFICIENT', 'No se pudo medir la demanda de búsqueda: el negocio no tiene una cuenta de Google Ads conectada.', [], ['UNKNOWN'], 'DEMAND');
  } else if (ctx.demanda === 'SIN_RESPUESTA') {
    añadir('h-demanda-sin-respuesta', 'DATA_INSUFFICIENT', 'Se preguntó por la demanda de búsqueda y la consulta no respondió: queda sin medir.', [], ['UNKNOWN'], 'DEMAND');
  } else if (ctx.demanda === 'SIN_IDEAS') {
    añadir('h-demanda-sin-ideas', 'DATA_INSUFFICIENT', 'El planificador de palabras respondió sin ningún término para la oferta declarada. No se sabe si hay demanda: no se concluye que no la haya.', [], ['UNKNOWN'], 'DEMAND');
  } else if (mejor !== null) {
    añadir(
      'h-demanda-existe',
      'SEARCH_DEMAND_EXISTS',
      `Existe demanda de búsqueda observada: ${volumenTotal} búsquedas mensuales en ${candidatos.length} términos relevantes; el mayor es «${mejor.termino}».`,
      candidatos.slice(0, 5).map((t) => `ev-kw-${t.terminoNormalizado.replace(/\s/g, '-')}`),
      ['OBSERVED'],
      'DEMAND',
    );
  } else {
    añadir('h-demanda-baja', 'OFFER_HAS_LOW_SEARCH_VOLUME', 'Se consultó la demanda y no se observaron búsquedas relevantes con volumen para la oferta declarada.', [], ['OBSERVED'], 'DEMAND');
  }

  // Ofertas concretas sin volumen: es distinto de «no hay demanda en general».
  for (const oferta of ctx.oferta.filter((o) => o.status === 'ACTIVE')) {
    const suyos = ctx.terminos.filter((t) => t.ofertaSlug === oferta.slug);
    const volumen = suyos.reduce((a, t) => a + Number((t.metricas as { avgMonthlySearches?: number | null }).avgMonthlySearches ?? 0), 0);
    if (ctx.demanda === 'CON_DATOS' && suyos.length > 0 && volumen === 0) {
      añadir(`h-oferta-sin-volumen-${oferta.slug}`, 'OFFER_HAS_LOW_SEARCH_VOLUME', `«${oferta.name}» aparece en las búsquedas pero sin volumen medible en el territorio declarado.`, suyos.slice(0, 3).map((t) => `ev-kw-${t.terminoNormalizado.replace(/\s/g, '-')}`), ['OBSERVED'], 'OFFER');
    }
  }

  for (const l of landings) {
    if (l.estado === 'MISSING') {
      añadir(`h-landing-falta-${l.ofertaSlug}`, 'LANDING_MISSING', `No hay página de destino para «${l.ofertaSlug}»: ${l.motivos[0] ?? 'no se encontró ninguna'}.`, [], ['OBSERVED'], 'LANDING');
    } else if (l.estado === 'WEAK') {
      añadir(`h-landing-debil-${l.ofertaSlug}`, 'LANDING_WEAK', `La página de «${l.ofertaSlug}» existe pero le falta algo: ${l.motivos.join('; ')}.`, [], ['OBSERVED'], 'LANDING');
    } else if (l.estado === 'BLOCKED') {
      añadir(`h-claim-conflicto-${l.ofertaSlug}`, 'CLAIM_CONFLICT', `La página de «${l.ofertaSlug}» choca con una restricción del negocio: ${l.motivos.join('; ')}.`, [], ['USER_CONFIRMED', 'OBSERVED'], 'COMPLIANCE');
    }
  }

  const noEjecutables = ctx.geos.filter((g) => !g.disponible);
  if (noEjecutables.length > 0) {
    añadir('h-geo-no-ejecutable', 'GEO_NOT_TARGETABLE', `Hay territorio comercial que la plataforma no permite segmentar: ${noEjecutables.map((g) => g.solicitado).join(', ')}.`, noEjecutables.slice(0, 5).map((g) => `ev-geo-${normalizarTermino(g.solicitado).replace(/\s/g, '-')}`), ['OBSERVED'], 'GEOGRAPHY');
  }
  const aproximados = ctx.geos.filter((g) => g.disponible && g.aproximacion);
  if (aproximados.length > 0) {
    añadir('h-geo-aproximado', 'GEO_APPROXIMATION_REQUIRED', `Parte del territorio sólo se alcanza con una unidad más amplia (${aproximados.map((g) => g.solicitado).join(', ')}), con riesgo de salir del área autorizada.`, aproximados.slice(0, 5).map((g) => `ev-geo-${normalizarTermino(g.solicitado).replace(/\s/g, '-')}`), ['OBSERVED'], 'GEOGRAPHY');
  }

  const hayContacto = (ctx.auditoria?.paginas ?? []).some((p) => p.viasDeContacto.length > 0);
  if (ctx.eventosConversion.length === 0) {
    añadir('h-conversion-sin-declarar', 'CONVERSION_PATH_MISSING', 'No hay ninguna acción declarada como resultado: sin eso no se puede saber si la inversión funciona.', [], ['USER_CONFIRMED'], 'MEASUREMENT');
  } else if (!hayContacto && ctx.auditoria !== null) {
    añadir('h-conversion-sin-via', 'CONVERSION_PATH_MISSING', 'El sitio revisado no ofrece una vía de contacto clara, así que la acción declarada difícilmente puede ocurrir.', [], ['OBSERVED'], 'MEASUREMENT');
  }

  if (!ctx.competidoresDisponibles) {
    añadir('h-competidores-insuficiente', 'COMPETITOR_DATA_INSUFFICIENT', 'No hay una fuente confiable de competidores en este despliegue: no se inventa ninguno.', [], ['UNKNOWN'], 'DEMAND');
  }

  return salida;
}

/** Veredicto de un canal concreto, para que el planificador no repita la evaluación. */
export function veredictoDe(canales: readonly EvaluacionCanal[], canal: CanalEvaluado): VeredictoCanal {
  return canales.find((c) => c.canal === canal)?.veredicto ?? 'INSUFFICIENT_EVIDENCE';
}
