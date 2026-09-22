/**
 * apps/api · EJECUCIÓN DE CAMPAÑAS · casos de uso.
 *
 * El recorrido completo, y el orden importa:
 *
 *   material aprobado → medición preparada y verificada → paquete congelado → requisitos → autorización humana
 *   → ejecución idempotente → verificación remota → campaña EN PAUSA
 *
 * Tres cosas que este servicio no hace nunca, por diseño:
 *   · activar una campaña (no existe el verbo);
 *   · ejecutar sin mandato financiero humano vigente, aunque la campaña vaya a nacer pausada — se está
 *     materializando una configuración de gasto futura;
 *   · tocar una campaña que no pertenezca a una petición de ejecución suya.
 */
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { RepositorioNegocios } from '../negocio/negocio-pg';
import { RepositorioPolitica } from '../politica/politica-pg';
import { RepositorioConexiones } from '../conexion/conexion-pg';
import { RepositorioInvestigacion } from '../investigacion/investigacion-pg';
import { RepositorioPlan } from '../investigacion/plan-pg';
import { InvestigacionService } from '../investigacion/investigacion-service';
import { PlanService } from '../investigacion/plan-service';
import { PgMandatoRepo } from '../accion/accion-pg';
import { esActorSistema, type Mandato } from '../accion/mandato';
import { mutacionesExternasHabilitadas } from '../gobierno/kill-switch';
import type { GoogleAdsMutateHttpClient } from '../campana/google-ads-mutate-http';
import {
  RepositorioEjecucion,
  type AssetCreativo,
  type AutorizacionEjecucion,
  type EstadoDeMedicion,
  type MapeoConversion,
  type PeticionEjecucion,
} from './ejecucion-pg';
import {
  EjecucionBloqueadaError,
  EjecucionInvalidaError,
  EjecucionNoEncontradaError,
  MINIMO_DESCRIPCIONES,
  MINIMO_HEADLINES,
  type EstadoEjecucion,
  type EstadoMedicion,
  type ResultadoPrerrequisito,
} from './ejecucion-tipos';
import { construirPaquete, textosDelPaquete, type MaterialAprobado, type PaqueteDeEjecucion } from './paquete';
import { validarClaims, type ResultadoClaims } from './claims';
import { bloqueantes, evaluarPrerrequisitos, puedeEjecutar } from './prerrequisitos';
import { asegurarAccionDeConversion, estadoDeMedicion, tipoComercialDe } from './conversiones';
import { ejecutarPaqueteGoogle, leerCampaniaPorNombre, compararConPaquete } from './ejecutor-google';
import { instalacionManual, type TrackingDeploymentProvider } from './tracking';

export class SinPlanError extends Error {}
export class NegocioSinPerfilError extends Error {}

export interface VistaEjecucion {
  readonly organizationId: string;
  readonly peticion: PeticionEjecucion | null;
  readonly prerrequisitos: readonly ResultadoPrerrequisito[];
  readonly puedeEjecutar: boolean;
  readonly resumen: ResumenDeLoQueSeCreara | null;
  readonly material: readonly AssetCreativo[];
  readonly medicion: readonly { readonly eventKey: string; readonly estado: EstadoMedicion; readonly externalId: string | null; readonly instrucciones: readonly { readonly titulo: string; readonly detalle: string; readonly fragmento: string | null }[] }[];
  readonly mandato: { readonly id: string; readonly topeMinor: number; readonly moneda: string; readonly hasta: string; readonly autorizadoPor: string } | null;
  readonly claims: ResultadoClaims | null;
  readonly historial: readonly { readonly id: string; readonly estado: EstadoEjecucion; readonly solicitadoEn: string; readonly planVersion: number }[];
}

/** Lo que se va a crear, en lenguaje de negocio. Es lo que la persona aprueba: nunca un JSON ni un enum. */
export interface ResumenDeLoQueSeCreara {
  readonly cuenta: string;
  readonly campania: string;
  readonly presupuestoDiario: string;
  readonly topeAutorizado: string;
  readonly ubicaciones: readonly string[];
  readonly grupos: readonly { readonly nombre: string; readonly palabras: number; readonly ejemplos: readonly string[]; readonly destino: string; readonly titulares: readonly string[]; readonly descripciones: readonly string[] }[];
  readonly negativas: number;
  readonly conversiones: readonly string[];
  readonly pendientes: readonly string[];
  readonly aviso: string;
}

export interface DepsEjecucion {
  readonly ahora?: () => string;
  readonly env?: NodeJS.ProcessEnv;
  /** Cliente de Google Ads de la organización. `null` ⇒ no hay camino de escritura y se dice por qué. */
  readonly clienteGoogle?: (org: string) => Promise<GoogleAdsMutateHttpClient | null>;
  readonly tracking?: TrackingDeploymentProvider;
  /** Señal observada de una conversión: es lo único que convierte «instalada» en «verificada». */
  readonly observarEventos?: (org: string, eventKey: string) => Promise<{ readonly observados: number; readonly desde: string | null }>;
  readonly log?: (info: Record<string, unknown>) => void;
}

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

const clp = (n: number): string => `$${Math.round(n).toLocaleString('es-CL')}`;

export class EjecucionService {
  private readonly repo: RepositorioEjecucion;
  private readonly negocios: RepositorioNegocios;
  private readonly politica: RepositorioPolitica;
  private readonly conexiones: RepositorioConexiones;
  private readonly investigacion: RepositorioInvestigacion;
  private readonly planes: RepositorioPlan;
  private readonly mandatos: PgMandatoRepo;
  private readonly ahora: () => string;
  private readonly env: NodeJS.ProcessEnv;

  constructor(private readonly pool: Pool, private readonly deps: DepsEjecucion = {}) {
    this.repo = new RepositorioEjecucion(pool);
    this.negocios = new RepositorioNegocios(pool);
    this.politica = new RepositorioPolitica(pool);
    this.conexiones = new RepositorioConexiones(pool);
    this.investigacion = new RepositorioInvestigacion(pool);
    this.planes = new RepositorioPlan(pool);
    this.mandatos = new PgMandatoRepo(pool);
    this.ahora = deps.ahora ?? (() => new Date().toISOString());
    this.env = deps.env ?? process.env;
  }

  // ── CONTEXTO ──────────────────────────────────────────────────────────────────────────────────

  private async contexto(org: string, modoOperativo: string | null) {
    const perfil = await this.negocios.perfil(org);
    if (perfil === null) throw new NegocioSinPerfilError(`el negocio '${org}' no existe`);
    // VIGENCIA: la frescura la deciden los módulos de investigación y plan, no esta pantalla. Así un plan que
    // quedó viejo bloquea la ejecución aunque nadie haya abierto la pantalla de investigación.
    await new InvestigacionService(this.pool, { ahora: this.ahora }).refrescarFrescura(org).catch(() => null);
    await new PlanService(this.pool, { ahora: this.ahora }).estado(org).catch(() => null);
    const [gobierno, oferta, plan, conexion, capacidades, politica, mandato, assets, mapeos, medicion] = await Promise.all([
      this.negocios.gobierno(org),
      this.negocios.oferta(org),
      this.planes.ultimoPlan(org),
      this.conexiones.buscar(org, 'GOOGLE_ADS'),
      this.conexiones.capacidades(org),
      this.politica.completa(org),
      this.mandatos.actual(org),
      this.repo.assets(org),
      this.repo.mapeos(org, 'GOOGLE_ADS'),
      this.repo.medicion(org, 'GOOGLE_ADS'),
    ]);
    const corrida = plan === null ? null : await this.investigacion.corrida(org, plan.researchRunId);
    const [geos, landings] = plan === null ? [[], []] : await Promise.all([
      this.investigacion.geos(org, plan.researchRunId),
      this.investigacion.landings(org, plan.researchRunId),
    ]);
    const cfg = (conexion?.configuracion ?? {}) as { customerId?: string; loginCustomerId?: string };
    const customerId = (cfg.customerId ?? conexion?.externalAccountId ?? '').replace(/\D/g, '') || null;
    const loginCustomerId = (cfg.loginCustomerId ?? conexion?.loginAccountId ?? customerId ?? '').replace(/\D/g, '') || customerId;
    return {
      perfil, gobierno, oferta, plan, corrida, geos, landings, politica, mandato, assets, mapeos, medicion,
      conexion: conexion === null ? null : { estado: conexion.estado, customerId },
      cuenta: customerId === null ? null : { customerId, loginCustomerId: loginCustomerId ?? customerId },
      capacidadEscritura: capacidades.some((c) => c.capacidad === 'ESCRITURA_ADS' && c.habilitada),
      modoOperativo,
      eventos: politica.eventos,
    };
  }

  /** Material aprobado por oferta: sólo cuenta lo que una persona aprobó explícitamente. */
  private materialAprobado(assets: readonly AssetCreativo[]): readonly MaterialAprobado[] {
    const porOferta = new Map<string, { titulares: string[]; descripciones: string[]; sitelinks: { texto: string; url: string }[]; callouts: string[] }>();
    for (const a of assets) {
      if (a.estado !== 'APROBADO') continue;
      const m = porOferta.get(a.ofertaSlug) ?? { titulares: [], descripciones: [], sitelinks: [], callouts: [] };
      if (a.tipo === 'HEADLINE') m.titulares.push(a.texto);
      else if (a.tipo === 'DESCRIPTION') m.descripciones.push(a.texto);
      else if (a.tipo === 'SITELINK' && a.url !== null) m.sitelinks.push({ texto: a.texto, url: a.url });
      else if (a.tipo === 'CALLOUT') m.callouts.push(a.texto);
      porOferta.set(a.ofertaSlug, m);
    }
    return [...porOferta.entries()].map(([ofertaSlug, m]) => ({ ofertaSlug, ...m }));
  }

  private ofertasConMaterialSuficiente(material: readonly MaterialAprobado[]): readonly string[] {
    return material.filter((m) => m.titulares.length >= MINIMO_HEADLINES && m.descripciones.length >= MINIMO_DESCRIPCIONES).map((m) => m.ofertaSlug);
  }

  // ── LECTURA ───────────────────────────────────────────────────────────────────────────────────

  async estado(org: string, modoOperativo: string | null): Promise<VistaEjecucion> {
    const c = await this.contexto(org, modoOperativo);
    const material = this.materialAprobado(c.assets);
    const conMaterial = this.ofertasConMaterialSuficiente(material);
    const paquete = await this.intentarPaquete(org, c, material);
    const claims = paquete === null ? null : validarClaims(textosDelPaquete(paquete), await this.negocios.restricciones(org));

    const estadosMedicion = c.eventos.map((e) => {
      const mapeo = c.mapeos.find((m) => m.eventKey === e.eventKey) ?? null;
      const instal = c.medicion.find((m) => m.eventKey === e.eventKey)?.estado ?? null;
      return { eventKey: e.eventKey, estado: estadoDeMedicion(mapeo, instal), mapeo };
    });

    // Sin fila de gobierno, la postura es la MÁS RESTRICTIVA: nada encendido.
    const gobierno = c.gobierno ?? {
      organizationId: org, externalMutations: false, autonomousSpend: false, automaticSafetyPause: false,
      campaignExecution: false, updatedAt: this.ahora(),
    };
    const prerrequisitos = evaluarPrerrequisitos({
      perfil: c.perfil, gobierno, plan: c.plan, corrida: c.corrida,
      conexion: c.conexion, capacidadEscritura: c.capacidadEscritura, modoOperativo,
      killSwitchAbierto: mutacionesExternasHabilitadas(this.env), mandato: c.mandato,
      medicion: estadosMedicion.map((m) => ({ eventKey: m.eventKey, estado: m.estado })),
      ofertasConMaterial: conMaterial,
      ofertasActivas: c.oferta.filter((o) => o.status === 'ACTIVE').length,
      geosEjecutables: c.geos.filter((g) => g.disponible && g.targetId !== null).length,
      landingsListas: c.landings.filter((l) => l.estado === 'READY' || l.estado === 'WEAK').map((l) => l.ofertaSlug),
      claims, ahora: this.ahora(),
    });

    const proveedor = this.deps.tracking ?? instalacionManual;
    const medicionVista = await Promise.all(estadosMedicion.map(async (m) => {
      const r = await proveedor.instalar({
        organizationId: org, sitio: c.perfil.website ?? 'tu sitio web',
        conversionId: m.mapeo?.externalId ?? null, conversionLabel: m.mapeo?.externalLabel ?? null, eventKey: m.eventKey,
      });
      return { eventKey: m.eventKey, estado: m.estado, externalId: m.mapeo?.externalId ?? null, instrucciones: m.estado === 'VERIFIED' ? [] : r.instrucciones };
    }));

    const peticion = await this.repo.ultima(org);
    const historial = (await this.repo.peticiones(org, 10)).map((p) => ({ id: p.id, estado: p.estado, solicitadoEn: p.solicitadoEn, planVersion: p.planVersion }));

    return {
      organizationId: org,
      peticion,
      prerrequisitos,
      puedeEjecutar: puedeEjecutar(prerrequisitos) && paquete !== null,
      resumen: paquete === null ? null : this.resumir(paquete, prerrequisitos),
      material: c.assets,
      medicion: medicionVista,
      mandato: c.mandato === null ? null : { id: c.mandato.id, topeMinor: c.mandato.authorizedBudgetMinor, moneda: c.mandato.currency, hasta: c.mandato.periodEnd, autorizadoPor: c.mandato.authorizedBy },
      claims,
      historial,
    };
  }

  /** Construye el paquete si se puede; si falta material estructural devuelve `null` (no lanza en lectura). */
  private async intentarPaquete(
    org: string,
    c: Awaited<ReturnType<EjecucionService['contexto']>>,
    material: readonly MaterialAprobado[],
  ): Promise<PaqueteDeEjecucion | null> {
    if (c.plan === null || c.cuenta === null || c.mandato === null) return null;
    const grupos = await this.planes.grupos(org, c.plan.id);
    const conversiones = c.mapeos
      .filter((m) => m.externalId !== null)
      .map((m) => ({ eventKey: m.eventKey, externalId: m.externalId!, rol: m.rol }));
    try {
      return construirPaquete({
        organizationId: org, perfil: c.perfil, oferta: c.oferta, plan: c.plan, grupos, geos: c.geos,
        cuenta: c.cuenta, mandato: c.mandato, conversiones, material, ahora: this.ahora(),
      });
    } catch {
      return null; // falta material: los requisitos lo explican mejor que una excepción
    }
  }

  private resumir(p: PaqueteDeEjecucion, rs: readonly ResultadoPrerrequisito[]): ResumenDeLoQueSeCreara {
    return {
      cuenta: p.cuenta.customerId,
      campania: p.campania.nombre,
      presupuestoDiario: `${clp(p.campania.presupuestoDiarioClp)} al día`,
      topeAutorizado: `${clp(p.mandato.topeMinor)} ${p.mandato.moneda} hasta ${new Date(p.mandato.hasta).toLocaleDateString('es-CL')}`,
      ubicaciones: p.campania.geo.filter((g) => !g.negativo).map((g) => g.nombre),
      grupos: p.grupos.map((g) => ({
        nombre: g.nombre,
        palabras: g.palabras.length,
        ejemplos: g.palabras.slice(0, 5).map((k) => k.texto),
        destino: g.urlFinal,
        titulares: g.anuncios[0]?.titulares ?? [],
        descripciones: g.anuncios[0]?.descripciones ?? [],
      })),
      negativas: p.negativas.length,
      conversiones: p.conversiones.map((c) => c.eventKey),
      pendientes: bloqueantes(rs).map((r) => r.motivo),
      aviso: 'La campaña se creará pausada y no generará gasto.',
    };
  }

  // ── MATERIAL DE ANUNCIOS ──────────────────────────────────────────────────────────────────────

  /** Guarda y aprueba textos de anuncio. Aprobar es un acto humano: el actor queda registrado. */
  async guardarMaterial(org: string, actor: string, entrada: {
    readonly ofertaSlug: string;
    readonly titulares?: readonly string[];
    readonly descripciones?: readonly string[];
    readonly sitelinks?: readonly { readonly texto: string; readonly url: string }[];
    readonly callouts?: readonly string[];
    readonly aprobar?: boolean;
  }): Promise<VistaEjecucion> {
    if (esActorSistema(actor)) throw new EjecucionInvalidaError('los anuncios los aprueba una persona, no el sistema');
    if (!entrada.ofertaSlug.trim()) throw new EjecucionInvalidaError('falta indicar el servicio');
    const ahora = this.ahora();
    const aprobado = entrada.aprobar !== false;
    const existentes = (await this.repo.assets(org)).filter((a) => a.ofertaSlug === entrada.ofertaSlug);

    await enTransaccion(this.pool, async (c) => {
      const guardar = async (tipo: AssetCreativo['tipo'], texto: string, url: string | null, i: number): Promise<void> => {
        const id = `${entrada.ofertaSlug}:${tipo.toLowerCase()}:${i}`;
        await this.repo.guardarAsset(c, {
          organizationId: org, id, ofertaSlug: entrada.ofertaSlug, tipo, texto: texto.trim(), url,
          estado: aprobado ? 'APROBADO' : 'PROPUESTO',
          aprobadoPor: aprobado ? actor : null, aprobadoEn: aprobado ? ahora : null,
          creadoEn: existentes.find((a) => a.id === id)?.creadoEn ?? ahora,
        });
      };
      const limpiar = async (tipo: AssetCreativo['tipo'], cuantos: number): Promise<void> => {
        for (const a of existentes.filter((x) => x.tipo === tipo)) {
          const indice = Number(a.id.split(':').pop() ?? '0');
          if (indice >= cuantos) await this.repo.borrarAsset(c, org, a.id);
        }
      };
      if (entrada.titulares) {
        const ts = entrada.titulares.map((t) => t.trim()).filter((t) => t !== '');
        for (const [i, t] of ts.entries()) await guardar('HEADLINE', t, null, i);
        await limpiar('HEADLINE', ts.length);
      }
      if (entrada.descripciones) {
        const ds = entrada.descripciones.map((t) => t.trim()).filter((t) => t !== '');
        for (const [i, t] of ds.entries()) await guardar('DESCRIPTION', t, null, i);
        await limpiar('DESCRIPTION', ds.length);
      }
      if (entrada.sitelinks) {
        for (const [i, s] of entrada.sitelinks.entries()) await guardar('SITELINK', s.texto, s.url, i);
        await limpiar('SITELINK', entrada.sitelinks.length);
      }
      if (entrada.callouts) {
        const cs = entrada.callouts.map((t) => t.trim()).filter((t) => t !== '');
        for (const [i, t] of cs.entries()) await guardar('CALLOUT', t, null, i);
        await limpiar('CALLOUT', cs.length);
      }
      await this.negocios.registrarAuditoria(c, {
        organizationId: org, actor, action: 'CAMPAIGN_CREATIVE_APPROVED',
        changedFields: { oferta: entrada.ofertaSlug, titulares: entrada.titulares?.length ?? 0, descripciones: entrada.descripciones?.length ?? 0, aprobado },
      });
    });
    return this.estado(org, null);
  }

  // ── MEDICIÓN ──────────────────────────────────────────────────────────────────────────────────

  /**
   * Prepara la medición: crea (o ADOPTA) la acción de conversión en la plataforma. Es una escritura externa, y
   * por eso exige la misma cadena de autorización que crear una campaña salvo el mandato financiero: definir
   * qué cuenta como resultado no gasta dinero.
   */
  async prepararMedicion(org: string, actor: string, modoOperativo: string | null): Promise<VistaEjecucion> {
    if (esActorSistema(actor)) throw new EjecucionInvalidaError('esta acción la realiza una persona');
    const c = await this.contexto(org, modoOperativo);
    if (!mutacionesExternasHabilitadas(this.env)) throw new EjecucionInvalidaError('las operaciones externas están apagadas en este despliegue');
    if (!c.capacidadEscritura) throw new EjecucionInvalidaError('falta activar el permiso «crear campañas» en Conexiones');
    if (modoOperativo !== 'SUPERVISED_REAL') throw new EjecucionInvalidaError('tu empresa está en modo observación: cámbialo a supervisado');
    if (c.cuenta === null) throw new EjecucionInvalidaError('no hay una cuenta de Google Ads conectada');
    if (c.eventos.length === 0) throw new EjecucionInvalidaError('primero declara qué acción de un cliente cuenta como resultado');

    const cliente = await this.deps.clienteGoogle?.(org);
    if (!cliente) throw new EjecucionInvalidaError('este despliegue no tiene configurado el acceso de escritura a Google Ads');

    const ahora = this.ahora();
    const resultados: { eventKey: string; creada: boolean }[] = [];
    for (const evento of c.eventos) {
      const existente = c.mapeos.find((m) => m.eventKey === evento.eventKey) ?? null;
      const r = await asegurarAccionDeConversion({
        cliente, customerId: c.cuenta.customerId, organizationId: org, proveedor: 'GOOGLE_ADS',
        eventKey: evento.eventKey, rol: evento.rol === 'SECONDARY' ? 'SECONDARY' : 'PRIMARY',
        nombreNegocio: c.perfil.displayName, moneda: c.perfil.currency, existente, ahora,
      });
      await enTransaccion(this.pool, async (tx) => {
        await this.repo.guardarMapeo(tx, r.mapeo);
        await this.repo.registrarPaso(tx, {
          organizationId: org, requestId: 'conversion-setup',
          paso: r.creada ? 'CONVERSION_CREATE' : 'CONVERSION_LOOKUP',
          clave: `${evento.eventKey}`,
          resultado: r.creada ? 'OK' : 'SKIPPED_IDEMPOTENT',
          recursoExterno: r.mapeo.externalId, providerRequestId: r.providerRequestId,
          detalle: { tipo: tipoComercialDe(evento.eventKey), nombre: r.mapeo.nombreExterno }, at: ahora,
        });
        const estado: EstadoDeMedicion = {
          organizationId: org, proveedor: 'GOOGLE_ADS', eventKey: evento.eventKey,
          estado: 'TRACKING_MISSING', metodo: 'MANUAL', detalle: 'acción creada; falta instalar la medición en el sitio',
          actualizadoEn: ahora,
        };
        const previo = c.medicion.find((m) => m.eventKey === evento.eventKey);
        if (previo === undefined || previo.estado === 'ACTION_MISSING') await this.repo.guardarMedicion(tx, estado);
        await this.negocios.registrarAuditoria(tx, {
          organizationId: org, actor, action: r.creada ? 'CONVERSION_ACTION_CREATED' : 'CONVERSION_ACTION_ADOPTED',
          changedFields: { eventKey: evento.eventKey, externalId: r.mapeo.externalId },
        });
      });
      resultados.push({ eventKey: evento.eventKey, creada: r.creada });
    }
    this.deps.log?.({ ejecucion: 'medicion_preparada', org, acciones: resultados });
    return this.estado(org, modoOperativo);
  }

  /** Declara instalada la medición (acto de la persona) o la verifica contra la señal observada. */
  async actualizarMedicion(org: string, actor: string, entrada: { readonly eventKey: string; readonly accion: 'INSTALADA' | 'VERIFICAR' }): Promise<VistaEjecucion> {
    if (esActorSistema(actor)) throw new EjecucionInvalidaError('esta acción la realiza una persona');
    const ahora = this.ahora();
    const mapeo = await this.repo.mapeo(org, 'GOOGLE_ADS', entrada.eventKey);
    if (mapeo === null || mapeo.externalId === null) throw new EjecucionInvalidaError('primero hay que preparar la medición en la plataforma');

    if (entrada.accion === 'INSTALADA') {
      await enTransaccion(this.pool, async (tx) => {
        await this.repo.guardarMedicion(tx, {
          organizationId: org, proveedor: 'GOOGLE_ADS', eventKey: entrada.eventKey, estado: 'TRACKING_INSTALLED',
          metodo: 'MANUAL', detalle: `declarada instalada por ${actor}`, actualizadoEn: ahora,
        });
      });
      return this.estado(org, null);
    }

    // VERIFICAR: no se cree la palabra de nadie, se busca la señal.
    const observar = this.deps.observarEventos;
    const senal = observar ? await observar(org, entrada.eventKey) : { observados: 0, desde: null };
    await enTransaccion(this.pool, async (tx) => {
      await this.repo.guardarMedicion(tx, {
        organizationId: org, proveedor: 'GOOGLE_ADS', eventKey: entrada.eventKey,
        estado: senal.observados > 0 ? 'VERIFIED' : 'TRACKING_MISSING',
        metodo: 'SENAL_OBSERVADA',
        detalle: senal.observados > 0 ? `${senal.observados} eventos observados` : 'todavía no llega ninguna señal de esta acción',
        actualizadoEn: ahora,
      });
      await this.repo.guardarMapeo(tx, {
        ...mapeo,
        verificacion: senal.observados > 0 ? 'VERIFICADA' : 'NO_VERIFICADA',
        verificadaEn: senal.observados > 0 ? ahora : mapeo.verificadaEn,
        estado: senal.observados > 0 ? 'VERIFIED' : mapeo.estado,
        actualizadoEn: ahora,
      });
    });
    return this.estado(org, null);
  }

  // ── PREPARAR ──────────────────────────────────────────────────────────────────────────────────

  /**
   * Congela el paquete y evalúa los requisitos. Si ya existe una petición viva con el mismo paquete, se
   * REUTILIZA: preparar dos veces no crea dos peticiones, y por tanto no puede crear dos campañas.
   */
  async preparar(org: string, actor: string, modoOperativo: string | null): Promise<VistaEjecucion> {
    const c = await this.contexto(org, modoOperativo);
    if (c.plan === null) throw new SinPlanError('primero hay que preparar un plan de marketing');
    const material = this.materialAprobado(c.assets);
    const paquete = await this.intentarPaquete(org, c, material);
    const vista = await this.estado(org, modoOperativo);
    if (paquete === null) return vista; // los requisitos ya explican qué falta

    const viva = await this.repo.porPaquete(org, paquete.hash);
    const ahora = this.ahora();
    if (viva !== null) {
      await enTransaccion(this.pool, async (tx) => {
        await this.repo.actualizar(tx, org, viva.id, {
          prerrequisitos: vista.prerrequisitos,
          estado: this.estadoSegunRequisitos(viva.estado, vista.prerrequisitos),
          ahora,
        });
      });
      return this.estado(org, modoOperativo);
    }

    const id = `exec-${ahora.slice(0, 10)}-${randomUUID().slice(0, 8)}`;
    const estado: EstadoEjecucion = puedeEjecutar(vista.prerrequisitos) ? 'READY' : 'BLOCKED';
    await enTransaccion(this.pool, async (tx) => {
      await this.repo.crear(tx, {
        organizationId: org, id, proveedor: 'GOOGLE_ADS', planId: paquete.planId, planVersion: paquete.planVersion,
        paqueteHash: paquete.hash, estado, actor, solicitadoEn: ahora, paquete,
        prerrequisitos: vista.prerrequisitos, autorizacion: null, recursosExternos: {}, reconciliacion: null,
        motivo: estado === 'BLOCKED' ? bloqueantes(vista.prerrequisitos).map((r) => r.motivo).join(' · ') : null,
        actualizadoEn: ahora,
      });
      await this.negocios.registrarAuditoria(tx, {
        organizationId: org, actor, action: 'CAMPAIGN_EXECUTION_PREPARED',
        changedFields: { requestId: id, planVersion: paquete.planVersion, paqueteHash: paquete.hash, estado },
      });
    });
    return this.estado(org, modoOperativo);
  }

  private estadoSegunRequisitos(actual: EstadoEjecucion, rs: readonly ResultadoPrerrequisito[]): EstadoEjecucion | undefined {
    if (actual === 'CREATED_PAUSED' || actual === 'CANCELLED' || actual === 'EXECUTING' || actual === 'PARTIAL') return undefined;
    return puedeEjecutar(rs) ? 'READY' : 'BLOCKED';
  }

  // ── AUTORIZAR ─────────────────────────────────────────────────────────────────────────────────

  /**
   * Aprobación humana explícita. Guarda QUIÉN, CUÁNDO, QUÉ versión del plan y con qué mandato: sin ese registro
   * no hay forma de responder «¿quién autorizó esto?» seis meses después.
   */
  async autorizar(org: string, actor: string, requestId: string, modoOperativo: string | null): Promise<VistaEjecucion> {
    if (esActorSistema(actor)) throw new EjecucionInvalidaError('la autorización la firma una persona, nunca el sistema');
    const peticion = await this.repo.peticion(org, requestId);
    if (peticion === null) throw new EjecucionNoEncontradaError('no existe esa preparación de campaña');
    if (peticion.estado === 'CREATED_PAUSED') return this.estado(org, modoOperativo);

    const vista = await this.estado(org, modoOperativo);
    if (!puedeEjecutar(vista.prerrequisitos)) {
      throw new EjecucionBloqueadaError('todavía falta algo antes de poder crear la campaña', bloqueantes(vista.prerrequisitos));
    }
    const mandato = await this.mandatos.actual(org);
    if (mandato === null) throw new EjecucionBloqueadaError('falta una autorización de presupuesto', bloqueantes(vista.prerrequisitos));

    const ahora = this.ahora();
    const autorizacion: AutorizacionEjecucion = {
      actor, autorizadoEn: ahora, accion: 'CREAR_CAMPANA_EN_PAUSA', mandatoId: mandato.id,
      mandatoTopeMinor: mandato.authorizedBudgetMinor, mandatoMoneda: mandato.currency,
      modoOperativo: modoOperativo ?? 'DESCONOCIDO',
    };
    await enTransaccion(this.pool, async (tx) => {
      await this.repo.actualizar(tx, org, requestId, { estado: 'READY', autorizacion, prerrequisitos: vista.prerrequisitos, ahora });
      await this.negocios.registrarAuditoria(tx, {
        organizationId: org, actor, action: 'CAMPAIGN_EXECUTION_AUTHORIZED',
        changedFields: { requestId, planVersion: peticion.planVersion, mandatoId: mandato.id, accion: autorizacion.accion },
      });
    });
    return this.estado(org, modoOperativo);
  }

  // ── EJECUTAR ──────────────────────────────────────────────────────────────────────────────────

  /**
   * Crea la campaña. Vuelve a comprobar TODO antes de escribir (la autorización pudo quedar vieja), ejecuta de
   * forma idempotente y verifica contra la plataforma. Devuelve el estado con la campaña ya en pausa.
   */
  async ejecutar(org: string, actor: string, requestId: string, modoOperativo: string | null): Promise<VistaEjecucion> {
    const peticion = await this.repo.peticion(org, requestId);
    if (peticion === null) throw new EjecucionNoEncontradaError('no existe esa preparación de campaña');
    if (peticion.estado === 'CREATED_PAUSED') return this.estado(org, modoOperativo); // ya está: no se repite
    if (peticion.estado === 'CANCELLED') throw new EjecucionInvalidaError('esa preparación fue cancelada');
    if (peticion.autorizacion === null) throw new EjecucionInvalidaError('falta la aprobación de una persona');

    // GATE FINAL, fail-closed: se reevalúa con los datos de AHORA, no con los de la aprobación.
    const vista = await this.estado(org, modoOperativo);
    if (!puedeEjecutar(vista.prerrequisitos)) {
      const rs = bloqueantes(vista.prerrequisitos);
      const ahora = this.ahora();
      await enTransaccion(this.pool, async (tx) => {
        await this.repo.actualizar(tx, org, requestId, { estado: 'BLOCKED', prerrequisitos: vista.prerrequisitos, motivo: rs.map((r) => r.motivo).join(' · '), ahora });
      });
      throw new EjecucionBloqueadaError('algo cambió desde la aprobación: la campaña no se creó', rs);
    }
    // El paquete CONGELADO manda: si el plan cambió, el hash ya no coincide y hay que preparar de nuevo.
    const actual = await this.intentarPaquete(org, await this.contexto(org, modoOperativo), this.materialAprobado(vista.material));
    if (actual === null || actual.hash !== peticion.paqueteHash) {
      const ahora = this.ahora();
      await enTransaccion(this.pool, async (tx) => {
        await this.repo.actualizar(tx, org, requestId, { estado: 'BLOCKED', motivo: 'el plan o el material cambiaron desde que se preparó: vuelve a prepararla', ahora });
      });
      throw new EjecucionBloqueadaError('el plan o el material cambiaron desde que se preparó esta campaña', [
        { requisito: 'PLAN_CURRENT', veredicto: 'ACTION_REQUIRED', motivo: 'vuelve a preparar la campaña con el plan vigente' },
      ]);
    }

    const cliente = await this.deps.clienteGoogle?.(org);
    if (!cliente) throw new EjecucionInvalidaError('este despliegue no tiene configurado el acceso de escritura a Google Ads');

    const ahora = this.ahora();
    await enTransaccion(this.pool, async (tx) => {
      await this.repo.actualizar(tx, org, requestId, { estado: 'EXECUTING', ahora });
    });

    const previos = await this.repo.pasos(org, requestId);
    let resultado;
    try {
      resultado = await ejecutarPaqueteGoogle({
        paquete: peticion.paquete, cliente, pasosPrevios: previos.map((p) => ({ paso: p.paso, clave: p.clave, resultado: p.resultado })),
        ahora: this.ahora, ...(this.deps.log ? { log: this.deps.log } : {}),
      });
    } catch (e) {
      const at = this.ahora();
      await enTransaccion(this.pool, async (tx) => {
        await this.repo.registrarPaso(tx, {
          organizationId: org, requestId, paso: 'CAMPAIGN_CREATE', clave: `${peticion.paqueteHash}:excepcion`,
          resultado: 'FAILED', recursoExterno: null, providerRequestId: null,
          detalle: { error: e instanceof Error ? e.message.slice(0, 200) : 'error inesperado' }, at,
        });
        await this.repo.actualizar(tx, org, requestId, { estado: 'PARTIAL', motivo: 'la ejecución se interrumpió; se puede reanudar sin duplicar', ahora: at });
      });
      throw e;
    }

    const at = this.ahora();
    await enTransaccion(this.pool, async (tx) => {
      for (const p of resultado.pasos) {
        await this.repo.registrarPaso(tx, {
          organizationId: org, requestId, paso: p.paso, clave: p.clave, resultado: p.resultado,
          recursoExterno: p.recursoExterno, providerRequestId: p.providerRequestId, detalle: p.detalle, at,
        });
      }
      await this.repo.actualizar(tx, org, requestId, {
        estado: resultado.estado, recursosExternos: resultado.recursosExternos,
        reconciliacion: resultado.reconciliacion, motivo: resultado.motivo, ahora: at,
      });
      if (resultado.reconciliacion !== null) {
        await this.repo.guardarReconciliacion(tx, org, requestId, resultado.reconciliacion, { recursos: resultado.recursosExternos });
      }
      await this.negocios.registrarAuditoria(tx, {
        organizationId: org, actor, action: resultado.estado === 'CREATED_PAUSED' ? 'CAMPAIGN_CREATED_PAUSED' : `CAMPAIGN_EXECUTION_${resultado.estado}`,
        changedFields: {
          requestId, planVersion: peticion.planVersion, estado: resultado.estado,
          escriturasProveedor: resultado.escriturasProveedor,
          campaña: resultado.recursosExternos.campaigns?.[0] ?? null,
          divergencias: resultado.reconciliacion?.divergencias.length ?? 0,
        },
      });
    });
    this.deps.log?.({ ejecucion: 'terminada', org, requestId, estado: resultado.estado, escrituras: resultado.escriturasProveedor });
    return this.estado(org, modoOperativo);
  }

  // ── RECONCILIAR Y CANCELAR ────────────────────────────────────────────────────────────────────

  /**
   * Vuelve a comparar con la plataforma. Si alguien cambió la campaña por fuera, se registra la DIVERGENCIA —
   * no se sobrescribe: decidir qué hacer con un cambio ajeno no es una decisión automática.
   */
  async reconciliar(org: string, requestId: string, modoOperativo: string | null): Promise<VistaEjecucion> {
    const peticion = await this.repo.peticion(org, requestId);
    if (peticion === null) throw new EjecucionNoEncontradaError('no existe esa preparación de campaña');
    const cliente = await this.deps.clienteGoogle?.(org);
    if (!cliente) throw new EjecucionInvalidaError('no hay acceso a la plataforma para comprobar el estado');
    const remota = await leerCampaniaPorNombre(cliente, peticion.paquete.cuenta.customerId, peticion.paquete.campania.nombre);
    const rec = compararConPaquete(peticion.paquete, remota, this.ahora());
    const ahora = this.ahora();
    await enTransaccion(this.pool, async (tx) => {
      await this.repo.guardarReconciliacion(tx, org, requestId, rec, { estado: remota?.estado ?? null, id: remota?.id ?? null });
      await this.repo.actualizar(tx, org, requestId, {
        reconciliacion: rec,
        motivo: rec.coincide ? null : `la campaña cambió fuera de SOEC: ${rec.divergencias.map((d) => `${d.campo} (${d.encontrado})`).join(', ')}`,
        ahora,
      });
      await this.repo.registrarPaso(tx, {
        organizationId: org, requestId, paso: 'VERIFY_REMOTE_STATE', clave: `drift:${ahora}`,
        resultado: 'OK', recursoExterno: remota?.id ?? null, providerRequestId: null,
        detalle: { coincide: rec.coincide, divergencias: rec.divergencias }, at: ahora,
      });
    });
    return this.estado(org, modoOperativo);
  }

  async cancelar(org: string, actor: string, requestId: string, modoOperativo: string | null): Promise<VistaEjecucion> {
    const peticion = await this.repo.peticion(org, requestId);
    if (peticion === null) throw new EjecucionNoEncontradaError('no existe esa preparación de campaña');
    if (peticion.estado === 'CREATED_PAUSED') throw new EjecucionInvalidaError('esta campaña ya existe en la plataforma: cancelarla aquí no la borraría de allá');
    const ahora = this.ahora();
    await enTransaccion(this.pool, async (tx) => {
      await this.repo.actualizar(tx, org, requestId, { estado: 'CANCELLED', motivo: `cancelada por ${actor}`, ahora });
      await this.negocios.registrarAuditoria(tx, { organizationId: org, actor, action: 'CAMPAIGN_EXECUTION_CANCELLED', changedFields: { requestId } });
    });
    return this.estado(org, modoOperativo);
  }

  /** Libro de ejecución de una petición: qué se hizo, en qué orden y con qué identificador externo. */
  async libro(org: string, requestId: string): Promise<readonly { readonly paso: string; readonly resultado: string; readonly recurso: string | null; readonly at: string }[]> {
    return (await this.repo.pasos(org, requestId)).map((p) => ({ paso: p.paso, resultado: p.resultado, recurso: p.recursoExterno, at: p.at }));
  }
}

/** Mandato vigente de una organización, para el resumen de la interfaz. */
export type MandatoVigente = Mandato | null;
export type { MapeoConversion };
