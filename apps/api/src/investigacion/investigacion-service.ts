/**
 * apps/api · INVESTIGACIÓN AUTÓNOMA · orquestador.
 *
 * «Investigar mi mercado» es UNA petición del dueño que produce una corrida con evidencia, hallazgos y
 * veredictos por canal. Aquí se coordina eso y —sobre todo— se cumplen las promesas incómodas:
 *
 *  · UNA FUENTE CAÍDA NO BORRA LAS DEMÁS. El resultado puede ser `PARTIAL`, y `PARTIAL` es válido.
 *  · NADA SE FABRICA. Si no hay datos de demanda, se registra `UNAVAILABLE` con su motivo y la confianza baja.
 *  · LA INVESTIGACIÓN CUESTA. Single-flight por organización, frescura configurable y tope de corridas
 *    simultáneas: abrir una pantalla no vuelve a consultar Google.
 *  · LO QUE CAMBIA, ENVEJECE. La corrida guarda la FIRMA de los datos que la sostenían; si la oferta, el
 *    territorio, las restricciones, el presupuesto o el sitio cambian, la corrida pasa a `STALE` por sí sola,
 *    sin borrar nada y diciendo qué cambió.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { RepositorioNegocios, type OfertaNegocio, type PerfilNegocio, type RestriccionNegocio, type TerritorioNegocio } from '../negocio/negocio-pg';
import { RepositorioConexiones } from '../conexion/conexion-pg';
import { RepositorioPolitica } from '../politica/politica-pg';
import { RepositorioOnboarding } from '../onboarding/onboarding-pg';
import {
  RepositorioInvestigacion,
  type CompatibilidadLanding,
  type CorridaInvestigacion,
  type EvaluacionCanal,
  type Evidencia,
  type GeoEjecutable,
  type Hallazgo,
  type TerminoInvestigado,
} from './investigacion-pg';
import {
  FRESCURA_HORAS_POR_DEFECTO,
  MAX_CORRIDAS_CONCURRENTES,
  normalizarTermino,
  type EstadoDeFuente,
  type EstadoInvestigacion,
} from './investigacion-tipos';
import { clasificarIntencion, evaluarTermino, type CandidatoNegativo } from './intencion';
import { derivarHallazgos, evaluarCanales, evaluarLandings, type ContextoAnalisis, type EstadoDemanda } from './analisis';
import {
  PRESUPUESTO_RASTREO_POR_DEFECTO,
  competidoresSinFuente,
  type AuditoriaSitio,
  type GeoTargetProvider,
  type MarketResearchProvider,
  type SearchDemandProvider,
  type WebsiteResearchProvider,
} from './proveedores';

export class NegocioSinPerfilError extends Error {}
export class InvestigacionNoPosibleError extends Error {}

export interface DepsInvestigacion {
  /** Proveedores de la composición. Ausentes ⇒ la fuente se registra como no disponible, no se simula. */
  readonly demanda?: SearchDemandProvider | null;
  readonly geo?: GeoTargetProvider | null;
  readonly sitio?: WebsiteResearchProvider | null;
  readonly mercado?: MarketResearchProvider | null;
  readonly ahora?: () => string;
  readonly log?: (info: Record<string, unknown>) => void;
  readonly frescuraHoras?: number;
  readonly maxConcurrentes?: number;
}

export interface FirmaDeEntradas {
  readonly oferta: string;
  readonly geografia: string;
  readonly restricciones: string;
  readonly presupuesto: string;
  readonly sitio: string;
  readonly conversiones: string;
}

export interface VistaInvestigacion {
  readonly organizationId: string;
  readonly corrida: CorridaInvestigacion | null;
  readonly evidencias: readonly Evidencia[];
  readonly hallazgos: readonly Hallazgo[];
  readonly terminos: readonly TerminoInvestigado[];
  readonly geos: readonly GeoEjecutable[];
  readonly canales: readonly EvaluacionCanal[];
  readonly landings: readonly CompatibilidadLanding[];
  readonly competidores: readonly { readonly nombre: string; readonly dominio: string }[];
  /** Candidatos a palabra negativa, con su motivo. Candidato ≠ negativa activa. */
  readonly candidatosNegativos: readonly CandidatoNegativo[];
  readonly frescura: { readonly horas: number; readonly vencida: boolean; readonly observadaEn: string | null };
  readonly puedeInvestigar: { readonly puede: boolean; readonly motivo: string | null };
}

const hash = (v: unknown): string => createHash('sha256').update(JSON.stringify(v ?? null)).digest('hex').slice(0, 16);

async function enTransaccion<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

const idDeTermino = (t: string): string => `kw-${normalizarTermino(t).replace(/\s/g, '-')}`.slice(0, 80);
const idDeEvidenciaTermino = (t: string): string => `ev-kw-${normalizarTermino(t).replace(/\s/g, '-')}`.slice(0, 80);
const idDeGeo = (n: string): string => `geo-${normalizarTermino(n).replace(/\s/g, '-')}`.slice(0, 80);
const idDeEvidenciaGeo = (n: string): string => `ev-geo-${normalizarTermino(n).replace(/\s/g, '-')}`.slice(0, 80);
const idDeEvidenciaPagina = (ruta: string): string => `ev-site-${ruta === '/' ? 'portada' : ruta.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')}`.slice(0, 80);

interface ContextoNegocio {
  readonly perfil: PerfilNegocio;
  readonly oferta: readonly OfertaNegocio[];
  readonly territorios: readonly TerritorioNegocio[];
  readonly restricciones: readonly RestriccionNegocio[];
  readonly eventosConversion: readonly string[];
  readonly reglasCanal: readonly { readonly canal: string; readonly modo: string }[];
  readonly techoDeclarado: { readonly modalidad: string; readonly montoMinor: number | null } | null;
  /** ¿Hay cuenta de publicidad conectada? Es un HECHO del negocio, no un permiso. */
  readonly conexionAdsConectada: boolean;
}

export class InvestigacionService {
  private readonly repo: RepositorioInvestigacion;
  private readonly negocios: RepositorioNegocios;
  private readonly conexiones: RepositorioConexiones;
  private readonly politica: RepositorioPolitica;
  private readonly onboarding: RepositorioOnboarding;
  private readonly ahora: () => string;
  private readonly frescuraHoras: number;
  private readonly maxConcurrentes: number;

  constructor(private readonly pool: Pool, private readonly deps: DepsInvestigacion = {}) {
    this.repo = new RepositorioInvestigacion(pool);
    this.negocios = new RepositorioNegocios(pool);
    this.conexiones = new RepositorioConexiones(pool);
    this.politica = new RepositorioPolitica(pool);
    this.onboarding = new RepositorioOnboarding(pool);
    this.ahora = deps.ahora ?? (() => new Date().toISOString());
    this.frescuraHoras = deps.frescuraHoras ?? FRESCURA_HORAS_POR_DEFECTO;
    this.maxConcurrentes = deps.maxConcurrentes ?? MAX_CORRIDAS_CONCURRENTES;
  }

  // ── CONTEXTO ──────────────────────────────────────────────────────────────────────────────────

  private async contexto(org: string): Promise<ContextoNegocio> {
    const perfil = await this.negocios.perfil(org);
    if (perfil === null) throw new NegocioSinPerfilError(`el negocio '${org}' no existe`);
    const [oferta, territorios, restricciones, politica, conexiones, presupuesto] = await Promise.all([
      this.negocios.oferta(org), this.negocios.territorios(org), this.negocios.restricciones(org),
      this.politica.completa(org), this.conexiones.listar(org),
      this.onboarding.intencionPresupuesto(org),
    ]);
    return {
      perfil,
      oferta,
      territorios,
      restricciones,
      eventosConversion: politica.eventos.map((e) => e.eventKey),
      reglasCanal: politica.canales.map((c) => ({ canal: c.canal, modo: c.modo })),
      techoDeclarado: presupuesto === null ? null : { modalidad: presupuesto.modalidad, montoMinor: presupuesto.montoMinor },
      // Investigar NO depende de ninguna capacidad: se mira lo que hay conectado, y nada de esto escribe.
      conexionAdsConectada: conexiones.some((c) => c.provider === 'GOOGLE_ADS' && c.estado === 'CONNECTED'),
    };
  }

  /** Firma de los datos que sostienen una investigación. Si cambia, la investigación envejece. */
  private firma(ctx: ContextoNegocio): FirmaDeEntradas {
    return {
      oferta: hash(ctx.oferta.filter((o) => o.status === 'ACTIVE').map((o) => [o.slug, o.name, o.priority])),
      geografia: hash(ctx.territorios.map((t) => [t.ambito, t.country, t.region, t.province, [...t.localities].sort()])),
      restricciones: hash([...ctx.restricciones].map((r) => [r.tipo, r.texto]).sort()),
      presupuesto: hash(ctx.techoDeclarado),
      sitio: hash(ctx.perfil.website),
      conversiones: hash([...ctx.eventosConversion].sort()),
    };
  }

  /** Qué dimensión cambió respecto de la corrida guardada, en lenguaje de negocio. */
  private cambios(anterior: Partial<FirmaDeEntradas>, actual: FirmaDeEntradas): readonly string[] {
    const nombres: Record<keyof FirmaDeEntradas, string> = {
      oferta: 'la oferta', geografia: 'el territorio', restricciones: 'las restricciones',
      presupuesto: 'el presupuesto declarado', sitio: 'el sitio web', conversiones: 'las conversiones declaradas',
    };
    return (Object.keys(nombres) as Array<keyof FirmaDeEntradas>)
      .filter((k) => anterior[k] !== undefined && anterior[k] !== actual[k])
      .map((k) => nombres[k]);
  }

  // ── LECTURA ───────────────────────────────────────────────────────────────────────────────────

  /**
   * Comprueba la FRESCURA de la última corrida y la marca `STALE` si sus datos de entrada cambiaron. Es la
   * misma comprobación que hace `estado()`, aislada para que otros módulos (p. ej. la EJECUCIÓN) no dependan de
   * que alguien abra la pantalla de investigación para enterarse de que el plan quedó viejo.
   */
  async refrescarFrescura(org: string): Promise<CorridaInvestigacion | null> {
    const ctx = await this.contexto(org);
    const corrida = await this.repo.ultimaCorrida(org);
    if (corrida === null) return null;
    if (corrida.estado !== 'COMPLETE' && corrida.estado !== 'PARTIAL') return corrida;
    const previa = (corrida.alcance.firma ?? {}) as Partial<FirmaDeEntradas>;
    const cambiadas = this.cambios(previa, this.firma(ctx));
    if (cambiadas.length === 0) return corrida;
    const motivo = `cambió ${cambiadas.join(', ')} desde esta investigación`;
    await this.repo.marcarStale(this.pool, org, motivo);
    return { ...corrida, estado: 'STALE', motivoStale: motivo };
  }

  /**
   * Estado de la investigación. Antes de devolverla comprueba la FIRMA: una corrida cuyos datos de entrada
   * cambiaron se marca `STALE` aquí mismo, sin esperar a que alguien se acuerde de invalidarla.
   */
  async estado(org: string): Promise<VistaInvestigacion> {
    const ctx = await this.contexto(org);
    const firmaActual = this.firma(ctx);
    let corrida = await this.repo.ultimaCorrida(org);

    if (corrida !== null && (corrida.estado === 'COMPLETE' || corrida.estado === 'PARTIAL')) {
      const previa = (corrida.alcance.firma ?? {}) as Partial<FirmaDeEntradas>;
      const cambiadas = this.cambios(previa, firmaActual);
      if (cambiadas.length > 0) {
        const motivo = `cambió ${cambiadas.join(', ')} desde esta investigación`;
        await this.repo.marcarStale(this.pool, org, motivo);
        corrida = { ...corrida, estado: 'STALE', motivoStale: motivo };
      }
    }

    const vacio = { evidencias: [], hallazgos: [], terminos: [], geos: [], canales: [], landings: [] } as const;
    const datos = corrida === null
      ? vacio
      : {
          evidencias: await this.repo.evidencias(org, corrida.id),
          hallazgos: await this.repo.hallazgos(org, corrida.id),
          terminos: await this.repo.terminos(org, corrida.id),
          geos: await this.repo.geos(org, corrida.id),
          canales: await this.repo.canales(org, corrida.id),
          landings: await this.repo.landings(org, corrida.id),
        };
    const competidores = (await this.repo.competidores(org)).map((c) => ({ nombre: c.nombre, dominio: c.dominio }));

    const observadaEn = corrida?.completadoEn ?? corrida?.iniciadoEn ?? null;
    const vencida = corrida === null
      || corrida.estado === 'STALE'
      || (observadaEn !== null && Date.parse(this.ahora()) - Date.parse(observadaEn) > corrida.frescuraHoras * 3600_000);

    return {
      organizationId: org,
      corrida,
      ...datos,
      competidores,
      candidatosNegativos: datos.terminos
        .filter((t) => t.elegibilidad === 'EXCLUDED' && t.motivoExclusion !== null)
        .map((t) => ({ termino: t.termino, motivo: t.motivoExclusion ?? '', evidencia: t.intencionEvidencia ?? '' })),
      frescura: { horas: corrida?.frescuraHoras ?? this.frescuraHoras, vencida, observadaEn },
      puedeInvestigar: this.puedeInvestigar(ctx),
    };
  }

  private puedeInvestigar(ctx: ContextoNegocio): { puede: boolean; motivo: string | null } {
    if (ctx.oferta.filter((o) => o.status === 'ACTIVE').length === 0) {
      return { puede: false, motivo: 'primero hay que declarar qué vende el negocio' };
    }
    return { puede: true, motivo: null };
  }

  // ── EJECUCIÓN ─────────────────────────────────────────────────────────────────────────────────

  /**
   * Lanza una investigación. Reutiliza la anterior si sigue fresca (y nadie pidió forzarla), comparte la que ya
   * está en marcha y respeta el tope de corridas simultáneas del despliegue.
   */
  async investigar(org: string, actor: string, opciones: { readonly forzar?: boolean } = {}): Promise<VistaInvestigacion> {
    const ctx = await this.contexto(org);
    const permiso = this.puedeInvestigar(ctx);
    if (!permiso.puede) throw new InvestigacionNoPosibleError(permiso.motivo ?? 'no se puede investigar todavía');

    // SINGLE-FLIGHT: si ya hay una corrida en marcha para esta empresa, se comparte.
    const enMarcha = (await this.repo.corridas(org, 5)).find((c) => c.estado === 'RUNNING') ?? null;
    if (enMarcha !== null) return this.estado(org);

    const firmaActual = this.firma(ctx);
    if (opciones.forzar !== true) {
      const aprovechable = await this.repo.ultimaAprovechable(org);
      if (aprovechable !== null) {
        const previa = (aprovechable.alcance.firma ?? {}) as Partial<FirmaDeEntradas>;
        const sinCambios = this.cambios(previa, firmaActual).length === 0;
        const observadaEn = aprovechable.completadoEn ?? aprovechable.iniciadoEn;
        const fresca = Date.parse(this.ahora()) - Date.parse(observadaEn) <= aprovechable.frescuraHoras * 3600_000;
        // FRESCA Y SIN CAMBIOS ⇒ no se vuelve a consultar a nadie. La investigación cuesta cuota.
        if (sinCambios && fresca) return this.estado(org);
      }
    }

    const alcance = {
      firma: firmaActual,
      ofertas: ctx.oferta.filter((o) => o.status === 'ACTIVE').map((o) => o.slug),
      territorio: ctx.territorios.find((t) => t.ambito === 'BUSINESS')?.localities ?? [],
      pedidaPor: actor,
    };
    const id = `run-${this.ahora().slice(0, 10)}-${randomUUID().slice(0, 8)}`;

    // Tope de concurrencia: la corrida queda ENCOLADA y se dice por qué, en lugar de golpear las cuotas.
    if ((await this.repo.corridasEnMarcha()) >= this.maxConcurrentes) {
      await enTransaccion(this.pool, async (c) => {
        await this.repo.crearCorrida(c, {
          organizationId: org, id, estado: 'QUEUED', alcance, fuentes: [], fallos: ['hay demasiadas investigaciones en marcha ahora mismo: se retomará en cuanto se libere una'],
          frescuraHoras: this.frescuraHoras, version: 1, motivoStale: null,
        });
      });
      return this.estado(org);
    }

    await enTransaccion(this.pool, async (c) => {
      await this.repo.crearCorrida(c, {
        organizationId: org, id, estado: 'RUNNING', alcance, fuentes: [], fallos: [],
        frescuraHoras: this.frescuraHoras, version: 1, motivoStale: null,
      });
    });

    try {
      await this.ejecutar(org, id, ctx);
    } catch (e) {
      // Un fallo inesperado NO deja la corrida colgada en RUNNING: se cierra como FAILED con su motivo.
      await this.repo.actualizarCorrida(this.pool, org, id, {
        estado: 'FAILED', completadoEn: this.ahora(), fallos: [e instanceof Error ? e.message.slice(0, 200) : 'error inesperado'],
      });
      this.deps.log?.({ investigacion: 'corrida_fallida', org, id, error: e instanceof Error ? e.message : String(e) });
    }
    return this.estado(org);
  }

  /** Recoge de cada fuente, deriva y PERSISTE todo junto. Ninguna fuente puede borrar el trabajo de otra. */
  private async ejecutar(org: string, runId: string, ctx: ContextoNegocio): Promise<void> {
    const ahora = this.ahora();
    const fuentes: EstadoDeFuente[] = [];
    const fallos: string[] = [];
    const evidencias: Evidencia[] = [];
    const activas = ctx.oferta.filter((o) => o.status === 'ACTIVE');
    const comercial = ctx.territorios.find((t) => t.ambito === 'BUSINESS') ?? null;
    const localidades = comercial?.localities ?? [];
    const excluidas = ctx.territorios.filter((t) => t.ambito === 'EXCLUSION').flatMap((t) => t.localities);

    // ── 1. SITIO PROPIO ──
    let auditoria: AuditoriaSitio | null = null;
    if (ctx.perfil.website === null || ctx.perfil.website.trim() === '') {
      fuentes.push({ fuente: 'WEBSITE_AUDIT', disponibilidad: 'SKIPPED', motivo: 'el negocio no declaró sitio web', versionDatos: null });
    } else if (this.deps.sitio === null || this.deps.sitio === undefined) {
      fuentes.push({ fuente: 'WEBSITE_AUDIT', disponibilidad: 'UNAVAILABLE', motivo: 'este despliegue no tiene auditoría de sitio configurada', versionDatos: null });
    } else {
      auditoria = await this.deps.sitio.auditar(ctx.perfil.website, PRESUPUESTO_RASTREO_POR_DEFECTO);
      if (auditoria === null || !auditoria.alcanzable) {
        fuentes.push({ fuente: 'WEBSITE_AUDIT', disponibilidad: 'FAILED', motivo: auditoria?.error ?? 'el sitio no respondió', versionDatos: null });
        fallos.push(`sitio web: ${auditoria?.error ?? 'no respondió'}`);
      } else {
        fuentes.push({ fuente: 'WEBSITE_AUDIT', disponibilidad: 'USED', motivo: null, versionDatos: auditoria.observadoEn });
        for (const p of auditoria.paginas) {
          evidencias.push({
            organizationId: org, id: idDeEvidenciaPagina(p.ruta), runId, clase: 'OBSERVED', fuente: 'WEBSITE_AUDIT',
            statement: `Página ${p.ruta}: ${p.titulo ?? 'sin título'}`,
            datos: { ruta: p.ruta, httpStatus: p.httpStatus, titulo: p.titulo, metaDescription: p.metaDescription, h1: p.h1, ctas: p.ctas, viasDeContacto: p.viasDeContacto, indexable: p.indexable, datosEstructurados: p.tieneDatosEstructurados },
            periodo: null, geografia: null, observadoEn: auditoria.observadoEn,
          });
        }
      }
    }

    // ── 2. TERRITORIO EJECUTABLE ──
    const geos: GeoEjecutable[] = [];
    if (localidades.length === 0) {
      fuentes.push({ fuente: 'GOOGLE_ADS_GEO_TARGETS', disponibilidad: 'SKIPPED', motivo: 'el negocio no declaró comunas o ciudades', versionDatos: null });
    } else if (this.deps.geo === null || this.deps.geo === undefined) {
      fuentes.push({ fuente: 'GOOGLE_ADS_GEO_TARGETS', disponibilidad: 'UNAVAILABLE', motivo: 'sin conexión de Google no se puede comprobar qué territorio es segmentable', versionDatos: null });
    } else {
      const resueltos = await this.deps.geo.resolver(localidades, ctx.perfil.country, ctx.perfil.language);
      if (resueltos === null) {
        fuentes.push({ fuente: 'GOOGLE_ADS_GEO_TARGETS', disponibilidad: 'FAILED', motivo: 'la consulta de territorios no respondió', versionDatos: null });
        fallos.push('territorios: la consulta a la plataforma falló');
      } else {
        fuentes.push({ fuente: 'GOOGLE_ADS_GEO_TARGETS', disponibilidad: 'USED', motivo: null, versionDatos: ahora });
        for (const g of resueltos) {
          geos.push({
            organizationId: org, id: idDeGeo(g.solicitado), runId, solicitado: g.solicitado, disponible: g.disponible,
            targetId: g.targetId, targetTipo: g.targetTipo, nombreCanonico: g.nombreCanonico,
            aproximacion: g.aproximacion, riesgoDerrame: g.riesgoDerrame,
          });
          evidencias.push({
            organizationId: org, id: idDeEvidenciaGeo(g.solicitado), runId, clase: 'OBSERVED', fuente: 'GOOGLE_ADS_GEO_TARGETS',
            statement: g.disponible
              ? `«${g.solicitado}» es segmentable en la plataforma${g.aproximacion ? ' sólo mediante una unidad más amplia' : ''}`
              : `«${g.solicitado}» no está disponible como territorio de la plataforma`,
            datos: { solicitado: g.solicitado, targetId: g.targetId, targetTipo: g.targetTipo, aproximacion: g.aproximacion, riesgoDerrame: g.riesgoDerrame },
            periodo: null, geografia: g.solicitado, observadoEn: ahora,
          });
        }
      }
    }

    // ── 3. DEMANDA DE BÚSQUEDA ──
    const terminos: TerminoInvestigado[] = [];
    let demanda: EstadoDemanda = 'SIN_FUENTE';
    const semillas = activas.map((o) => o.name);
    if (this.deps.demanda === null || this.deps.demanda === undefined) {
      fuentes.push({ fuente: 'GOOGLE_ADS_KEYWORD_DATA', disponibilidad: 'UNAVAILABLE', motivo: 'no hay una cuenta de Google Ads conectada con la que consultar la demanda', versionDatos: null });
    } else {
      const geoIds = geos.filter((g) => g.disponible && g.targetId !== null).map((g) => g.targetId!);
      const respuesta = await this.deps.demanda.demanda({
        semillas, urlSitio: ctx.perfil.website, geoTargetIds: geoIds, idioma: ctx.perfil.language, pais: ctx.perfil.country,
      });
      if (respuesta === null) {
        demanda = 'SIN_RESPUESTA';
        fuentes.push({ fuente: 'GOOGLE_ADS_KEYWORD_DATA', disponibilidad: 'FAILED', motivo: 'la consulta de demanda no respondió', versionDatos: null });
        fallos.push('demanda de búsqueda: la consulta no respondió');
      } else {
        // UNA RESPUESTA VACÍA NO ES UN DATO. Se registra tal cual —se consultó, no trajo nada— en vez de
        // dejarla pasar como una medición que después se lee como «este negocio no tiene demanda».
        demanda = respuesta.ideas.length > 0 ? 'CON_DATOS' : 'SIN_IDEAS';
        fuentes.push({
          fuente: 'GOOGLE_ADS_KEYWORD_DATA',
          disponibilidad: 'USED',
          motivo: demanda === 'SIN_IDEAS' ? 'la consulta respondió sin ningún término: no hay con qué medir la demanda' : null,
          versionDatos: respuesta.periodo ?? respuesta.observadoEn,
        });
        const ctxClasificacion = {
          ofertas: activas.map((o) => o.name),
          localidades,
          localidadesExcluidas: excluidas,
          restricciones: ctx.restricciones,
          marca: ctx.perfil.displayName,
        };
        const vistos = new Set<string>();
        for (const idea of respuesta.ideas) {
          const normalizado = normalizarTermino(idea.termino);
          if (normalizado === '' || vistos.has(normalizado)) continue;
          vistos.add(normalizado);
          const clasificacion = clasificarIntencion(idea.termino, ctxClasificacion);
          const veredicto = evaluarTermino(idea.termino, clasificacion);
          const oferta = clasificacion.ofertaRelacionada !== null
            ? activas.find((o) => o.name === clasificacion.ofertaRelacionada)?.slug ?? null
            : null;
          terminos.push({
            organizationId: org, id: idDeTermino(idea.termino), runId, termino: idea.termino, terminoNormalizado: normalizado,
            intencion: clasificacion.intencion, intencionMetodo: clasificacion.metodo, intencionConfianza: clasificacion.confianza,
            intencionEvidencia: clasificacion.evidencia, ofertaSlug: oferta, geografia: localidades.join(', ') || null,
            idioma: ctx.perfil.language, metricas: { ...idea.metricas }, clase: 'OBSERVED', fuente: respuesta.fuente,
            elegibilidad: veredicto.elegibilidad, motivoExclusion: veredicto.motivoExclusion, observadoEn: respuesta.observadoEn,
          });
          evidencias.push({
            organizationId: org, id: idDeEvidenciaTermino(idea.termino), runId, clase: 'OBSERVED', fuente: respuesta.fuente,
            statement: `«${idea.termino}»: ${idea.metricas.avgMonthlySearches ?? 'sin dato'} búsquedas mensuales promedio`,
            datos: { termino: idea.termino, ...idea.metricas },
            periodo: respuesta.periodo, geografia: localidades.join(', ') || null, observadoEn: respuesta.observadoEn,
          });
        }
      }
    }

    // ── 4. COMPETIDORES ──
    const proveedorMercado: MarketResearchProvider = this.deps.mercado ?? competidoresSinFuente;
    const competidores = await proveedorMercado.competidores({ semillas, pais: ctx.perfil.country, territorio: localidades });
    if (competidores === null) {
      fuentes.push({ fuente: 'MARKET_PROVIDER', disponibilidad: 'UNAVAILABLE', motivo: 'no hay una fuente confiable de competidores en este despliegue', versionDatos: null });
    } else {
      fuentes.push({ fuente: 'MARKET_PROVIDER', disponibilidad: 'USED', motivo: null, versionDatos: ahora });
    }

    // ── 5. DERIVACIONES ──
    const ctxAnalisis: ContextoAnalisis = {
      organizationId: org, runId, oferta: ctx.oferta, restricciones: ctx.restricciones, auditoria,
      terminos, geos, eventosConversion: ctx.eventosConversion, techoDeclarado: ctx.techoDeclarado,
      reglasCanal: ctx.reglasCanal, demanda, competidoresDisponibles: competidores !== null, ahora,
    };
    const landings = evaluarLandings(ctxAnalisis);
    const canales = evaluarCanales(ctxAnalisis);
    const hallazgos = derivarHallazgos(ctxAnalisis, landings);

    // ── 6. PERSISTENCIA (una transacción: o queda todo, o no queda nada a medias) ──
    const usadas = fuentes.filter((f) => f.disponibilidad === 'USED').length;
    const estado: EstadoInvestigacion = usadas === 0 ? 'FAILED' : fuentes.some((f) => f.disponibilidad === 'FAILED' || f.disponibilidad === 'UNAVAILABLE') ? 'PARTIAL' : 'COMPLETE';

    await enTransaccion(this.pool, async (c) => {
      for (const e of evidencias) await this.repo.guardarEvidencia(c, e);
      for (const t of terminos) await this.repo.guardarTermino(c, t);
      for (const g of geos) await this.repo.guardarGeo(c, g);
      for (const l of landings) await this.repo.guardarLanding(c, l);
      for (const ca of canales) await this.repo.guardarCanal(c, ca);
      for (const h of hallazgos) await this.repo.guardarHallazgo(c, h);
      for (const comp of competidores ?? []) {
        await this.repo.guardarCompetidor(c, {
          organizationId: org, id: `comp-${normalizarTermino(comp.dominio).replace(/\s/g, '-')}`.slice(0, 80),
          nombre: comp.nombre, dominio: comp.dominio, evidencia: comp.evidencia,
          metodoDescubrimiento: comp.metodoDescubrimiento, observadoEn: comp.observadoEn,
        });
      }
      await this.repo.actualizarCorrida(c, org, runId, { estado, fuentes, fallos, completadoEn: this.ahora() });
      await this.negocios.registrarAuditoria(c, {
        organizationId: org, actor: 'investigacion',
        action: 'RESEARCH_RUN_COMPLETED',
        changedFields: { runId, estado, fuentes: fuentes.map((f) => `${f.fuente}:${f.disponibilidad}`), terminos: terminos.length, hallazgos: hallazgos.length },
      });
    });

    this.deps.log?.({ investigacion: 'corrida', org, id: runId, estado, terminos: terminos.length, hallazgos: hallazgos.length, fuentes: fuentes.map((f) => `${f.fuente}:${f.disponibilidad}`) });
  }
}
