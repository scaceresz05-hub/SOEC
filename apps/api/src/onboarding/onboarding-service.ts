/**
 * apps/api · ONBOARDING INTELIGENTE · casos de uso.
 *
 * Aquí ocurre la traducción que define el producto: **el usuario habla de su negocio y esto lo convierte en
 * configuración de marketing**. Cada respuesta escrita con naturalidad —«hacemos implantes, prótesis y
 * odontología general»— termina en la tabla canónica que le corresponde, sin que nadie escriba un slug.
 *
 * REGLAS DURAS DE ESTE SERVICIO:
 *
 *  · SÓLO SE TRADUCE LO CONFIRMADO. Una respuesta `DISCOVERED` (lo que se leyó del sitio web) se guarda y se
 *    muestra para confirmar, pero NO se escribe en el negocio hasta que la persona la confirma.
 *  · NO SE INVENTAN NÚMEROS. Si el dueño no sabe su meta, el indicador queda `TO_BE_LEARNED`; si no quiere
 *    fijar un mínimo de evidencia, se ofrece un punto de partida del sistema marcado como `SYSTEM_DEFAULT`.
 *    Ninguna cifra se presenta como decisión del negocio si no la tomó el negocio.
 *  · COMPLETAR EL ASISTENTE NO AUTORIZA NADA. Se derivan sólo capacidades de LECTURA. Mutaciones externas,
 *    gasto autónomo y ejecución de campañas siguen apagados, y el techo declarado no es un mandato financiero.
 *  · SE PUEDE VOLVER. El progreso y las respuestas se persisten: cerrar el navegador no pierde nada, y salir
 *    a conectar una cuenta (OAuth) tampoco.
 */
import type { Pool, PoolClient } from 'pg';
import { RepositorioNegocios, type CambiosPerfil, type TipoCliente, type TipoNegocio } from '../negocio/negocio-pg';
import { RepositorioConexiones } from '../conexion/conexion-pg';
import { RepositorioPolitica } from '../politica/politica-pg';
import { evaluarCompletitud } from '../politica/politica-perfil';
import { DEFAULTS_EVIDENCIA_V1, VERSION_DEFAULTS_EVIDENCIA } from '../politica/politica-tipos';
import { PoliticaService, type DocumentoPolitica } from '../politica/politica-service';
import { RepositorioOnboarding, type EstadoOnboardingPersistido, type RespuestaOnboarding } from './onboarding-pg';
import {
  ACCIONES,
  INDICADORES,
  PREGUNTAS_POR_ID,
  TEXTO_DE_OBJETIVO,
  construirPasos,
  progreso,
  siguientePaso,
  valorSabido,
  type ContextoOnboarding,
  type PasoVista,
} from './onboarding-preguntas';
import { evaluarReadiness, type BusinessReadiness } from './readiness';
import { PgMandatoRepo } from '../accion/accion-pg';
import { inspeccionarSitio, validarUrlDeSitio, type OpcionesInspeccion } from './sitio-web';
import {
  MODO_DE_PREFERENCIA,
  OnboardingInvalidoError,
  claveDesdeTexto,
  exigirPaso,
  trocearEnumeracion,
  type EstadoOnboarding,
  type ModalidadPresupuesto,
  type PasoId,
  type PreferenciaAutonomia,
} from './onboarding-tipos';

export class NegocioSinPerfilError extends Error {}

/** Moneda y zona horaria razonables por país. Se usan sólo si el país CAMBIA: nunca sobrescriben una elección. */
const POR_PAIS: Readonly<Record<string, { moneda: string; zona: string }>> = {
  CL: { moneda: 'CLP', zona: 'America/Santiago' },
  AR: { moneda: 'ARS', zona: 'America/Argentina/Buenos_Aires' },
  MX: { moneda: 'MXN', zona: 'America/Mexico_City' },
  CO: { moneda: 'COP', zona: 'America/Bogota' },
  PE: { moneda: 'PEN', zona: 'America/Lima' },
  ES: { moneda: 'EUR', zona: 'Europe/Madrid' },
};

export interface VistaOnboarding {
  readonly organizationId: string;
  readonly estado: EstadoOnboarding;
  readonly pasoActual: PasoId;
  readonly siguientePaso: PasoId;
  readonly progreso: number;
  readonly pasos: readonly PasoVista[];
  readonly readiness: BusinessReadiness;
  /** Lo que SOEC entendió, en lenguaje de negocio, para la pantalla final. */
  readonly resumen: {
    readonly empresa: string;
    readonly aQueSeDedica: string | null;
    readonly oferta: readonly string[];
    readonly objetivo: string | null;
    readonly territorio: readonly string[];
    readonly conversiones: readonly string[];
    readonly restricciones: readonly string[];
    readonly conexiones: readonly { readonly nombre: string; readonly estado: string }[];
    readonly presupuestoMaximo: string;
    readonly nivelDeAutonomia: string;
  };
  readonly sitio: { readonly url: string; readonly estado: string; readonly titulo: string | null; readonly paginas: readonly string[] } | null;
  /**
   * Cosas que el asistente intentó y no pudo, en lenguaje de negocio. La más importante: cuando alguien pide
   * que SOEC opere solo y el sistema todavía no lo permite, hay que DECÍRSELO, no dejarlo suponiendo.
   */
  readonly avisos: readonly string[];
}

export interface EntradaRespuestas {
  readonly paso: string;
  readonly respuestas: Readonly<Record<string, unknown>>;
  /** `false` para autoguardar sin avanzar (la interfaz guarda mientras el usuario escribe). */
  readonly avanzar?: boolean;
}

export interface DepsOnboarding {
  /** Aplica el modo operativo por la vía gobernada de identidad. Ausente ⇒ se registra la preferencia y se explica. */
  readonly aplicarModo?: (modo: string) => Promise<{ readonly ok: boolean; readonly motivo: string }>;
  /** Modo operativo vigente (identidad). Ausente ⇒ se asume el más conservador. */
  readonly leerModo?: () => Promise<string>;
  readonly refrescar?: () => Promise<void>;
  readonly ahora?: () => string;
  readonly inspeccion?: OpcionesInspeccion;
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

const comoTexto = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const comoLista = (v: unknown): readonly string[] => (Array.isArray(v) ? v.map((x) => String(x)) : []);
const comoNumero = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[^0-9.,-]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

/**
 * ¿Son el mismo valor a efectos de una respuesta? Compara listas sin importar el orden y texto sin espacios
 * sobrantes. Es lo que permite distinguir «lo escribí yo» de «me lo devolvió la pantalla tal cual».
 */
function mismoValor(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    const la = (Array.isArray(a) ? a : [a]).map((x) => String(x ?? '').trim()).filter((x) => x !== '').sort();
    const lb = (Array.isArray(b) ? b : [b]).map((x) => String(x ?? '').trim()).filter((x) => x !== '').sort();
    return la.length === lb.length && la.every((x, i) => x === lb[i]);
  }
  if (typeof a === 'string' || typeof b === 'string') return String(a ?? '').trim() === String(b ?? '').trim();
  return a === b;
}

export class OnboardingService {
  private readonly repo: RepositorioOnboarding;
  private readonly negocios: RepositorioNegocios;
  private readonly conexiones: RepositorioConexiones;
  private readonly politicaRepo: RepositorioPolitica;
  private readonly politica: PoliticaService;
  private readonly ahora: () => string;

  constructor(private readonly pool: Pool, private readonly deps: DepsOnboarding = {}) {
    this.repo = new RepositorioOnboarding(pool);
    this.negocios = new RepositorioNegocios(pool);
    this.conexiones = new RepositorioConexiones(pool);
    this.politicaRepo = new RepositorioPolitica(pool);
    this.politica = new PoliticaService(pool, { ...(deps.refrescar ? { refrescar: deps.refrescar } : {}) });
    this.ahora = deps.ahora ?? (() => new Date().toISOString());
  }

  // ── LECTURA ───────────────────────────────────────────────────────────────────────────────────

  private async contexto(org: string): Promise<{ ctx: ContextoOnboarding; estado: EstadoOnboardingPersistido | null }> {
    const perfil = await this.negocios.perfil(org);
    if (perfil === null) throw new NegocioSinPerfilError(`el negocio '${org}' no existe`);
    const [oferta, territorios, restricciones, politica, conexiones, capacidades, sitio, presupuesto, estado, respuestas] = await Promise.all([
      this.negocios.oferta(org), this.negocios.territorios(org), this.negocios.restricciones(org),
      this.politicaRepo.completa(org), this.conexiones.listar(org), this.conexiones.capacidades(org),
      this.repo.observacionSitio(org), this.repo.intencionPresupuesto(org), this.repo.estado(org), this.repo.respuestas(org),
    ]);
    const modoOperativo = (await this.deps.leerModo?.()) ?? 'PILOT';
    return {
      ctx: {
        perfil, oferta, territorios, restricciones, politica, conexiones, capacidades, sitio, presupuesto, modoOperativo,
        respuestas: new Map(respuestas.map((r) => [r.pregunta, r])),
      },
      estado,
    };
  }

  /** Estado completo del asistente + readiness + resumen. Es lo único que la interfaz necesita leer. */
  async leer(org: string): Promise<VistaOnboarding> {
    const { ctx, estado } = await this.contexto(org);
    return this.vista(org, ctx, estado);
  }

  private async vista(org: string, ctx: ContextoOnboarding, estado: EstadoOnboardingPersistido | null): Promise<VistaOnboarding> {
    const pasos = construirPasos(ctx);
    const readiness = await this.readinessDe(org, ctx);
    const siguiente = siguientePaso(pasos);
    return {
      avisos: this.avisos(ctx),
      organizationId: org,
      estado: estado?.estado ?? 'NOT_STARTED',
      pasoActual: estado?.pasoActual ?? siguiente,
      siguientePaso: siguiente,
      progreso: progreso(pasos),
      pasos,
      readiness,
      resumen: this.resumen(ctx),
      sitio: ctx.sitio === null ? null : { url: ctx.sitio.url, estado: ctx.sitio.estado, titulo: ctx.sitio.titulo, paginas: ctx.sitio.paginas },
    };
  }

  /** Readiness por dominios y niveles. Se expone también sola, para el panel. */
  async readiness(org: string): Promise<BusinessReadiness> {
    const { ctx } = await this.contexto(org);
    return this.readinessDe(org, ctx);
  }

  /**
   * ¿Existe una autorización de presupuesto humana y vigente? Se consulta al repositorio de mandatos; si la
   * tabla todavía no existe en este despliegue, la respuesta honesta es «no», nunca un supuesto optimista.
   */
  private async hayMandatoVigente(org: string): Promise<boolean> {
    try {
      const m = await new PgMandatoRepo(this.pool).actual(org);
      if (m === null) return false;
      const ahora = Date.parse(this.ahora());
      return Date.parse(m.periodStart) <= ahora && Date.parse(m.periodEnd) > ahora;
    } catch {
      return false;
    }
  }

  private async readinessDe(org: string, ctx: ContextoOnboarding): Promise<BusinessReadiness> {
    const gobierno = await this.negocios.gobierno(org);
    const revisadas = ctx.respuestas.has('restricciones.noOfrecemos') || ctx.respuestas.has('restricciones.noPodemosAfirmar');
    return evaluarReadiness({
      perfil: ctx.perfil,
      oferta: ctx.oferta,
      territorios: ctx.territorios,
      restricciones: ctx.restricciones,
      politica: ctx.politica,
      completitudPolitica: evaluarCompletitud({ perfil: ctx.perfil, politica: ctx.politica }),
      conexiones: ctx.conexiones,
      capacidades: ctx.capacidades,
      gobierno,
      presupuesto: ctx.presupuesto,
      modoOperativo: ctx.modoOperativo,
      restriccionesRevisadas: revisadas,
      // El mandato vive en el Safe Action Plane, no en el onboarding: aquí sólo se LEE si existe y está vigente.
      mandatoVigente: await this.hayMandatoVigente(org),
    });
  }

  /** Resultados de intentos que no se pudieron aplicar (hoy: el nivel de autonomía pedido). */
  private avisos(ctx: ContextoOnboarding): readonly string[] {
    const r = ctx.respuestas.get('autonomia.resultado')?.valor as { ok?: boolean; motivo?: string; modo?: string } | undefined;
    if (r === undefined || r.ok === true) return [];
    const pedido = r.modo === 'AUTONOMOUS_REAL' ? 'operar automáticamente' : 'cambiar el nivel de autonomía';
    return [`Pediste ${pedido} y no se pudo aplicar: ${r.motivo ?? 'motivo no disponible'}. El nivel sigue siendo el anterior.`];
  }

  private resumen(ctx: ContextoOnboarding): VistaOnboarding['resumen'] {
    const territorio = ctx.territorios.find((t) => t.ambito === 'BUSINESS');
    const nombreAccion = (eventKey: string): string => ACCIONES.find((a) => a.eventKey === eventKey)?.etiqueta ?? eventKey;
    const presupuesto = ctx.presupuesto;
    const techo = presupuesto === null
      ? 'sin declarar'
      : presupuesto.modalidad === 'NONE'
        ? 'por ahora no quiere invertir'
        : presupuesto.modalidad === 'LATER'
          ? 'lo decidirá después'
          : `${presupuesto.montoClp ?? 0} ${presupuesto.moneda} como máximo ${presupuesto.modalidad === 'DAILY' ? 'por día' : 'por mes'}`;
    const modo = ctx.modoOperativo === 'SUPERVISED_REAL'
      ? 'pide aprobación antes de cambiar algo'
      : ctx.modoOperativo === 'AUTONOMOUS_REAL'
        ? 'opera dentro de los límites'
        : 'sólo observa y avisa';
    return {
      empresa: ctx.perfil.displayName,
      aQueSeDedica: ctx.perfil.description,
      oferta: ctx.oferta.filter((o) => o.status === 'ACTIVE').map((o) => o.name),
      objetivo: ctx.politica.politica?.objectiveText ?? ctx.perfil.primaryObjective ?? null,
      territorio: territorio ? [...territorio.localities] : [],
      conversiones: ctx.politica.eventos.map((e) => `${nombreAccion(e.eventKey)}${e.rol === 'PRIMARY' ? ' (la más importante)' : ''}`),
      restricciones: ctx.restricciones.map((r) => r.texto),
      conexiones: ctx.conexiones.map((c) => ({
        nombre: c.provider === 'GOOGLE_ADS' ? 'Google Ads' : c.provider === 'META_ADS' ? 'Meta' : c.provider === 'GROWTH_M2M' ? 'Datos de tu sitio' : c.provider,
        estado: c.estado === 'CONNECTED' ? 'conectada' : c.estado === 'ERROR' ? 'con problemas' : 'sin conectar',
      })),
      presupuestoMaximo: techo,
      nivelDeAutonomia: modo,
    };
  }

  // ── ESCRITURA ─────────────────────────────────────────────────────────────────────────────────

  /**
   * Guarda las respuestas de UN paso y las traduce a los datos del negocio. Idempotente: responder dos veces
   * lo mismo deja el mismo resultado, y corregir una respuesta actualiza el dato correspondiente.
   */
  async responder(org: string, actor: string, entrada: EntradaRespuestas): Promise<VistaOnboarding> {
    const paso = exigirPaso(entrada.paso);
    const { ctx: antes, estado: estadoAntes } = await this.contexto(org);
    const nuevas = this.validarRespuestas(paso, entrada.respuestas);

    const primeraVez = await enTransaccion(this.pool, async (c) => {
      const iniciado = await this.repo.iniciarSiFalta(c, org, paso);
      for (const [pregunta, valor] of nuevas) {
        // PASAR POR UNA PANTALLA NO ES RESPONDERLA. La interfaz precarga lo que SOEC ya sabe para que se
        // corrija, no para que se confirme sin mirarlo: si lo que llega es EXACTAMENTE ese valor precargado,
        // nadie ha decidido nada y la procedencia se conserva. Sólo un valor DISTINTO del que ya teníamos es
        // una respuesta de una persona. Sin esta regla, navegar congelaría como «confirmado por el dueño»
        // todo lo que el sistema había deducido, y lo escribiría en el negocio.
        const yaEstaba = antes.respuestas.get(pregunta) ?? null;
        const sabido = yaEstaba === null ? valorSabido(pregunta, antes) : null;
        if (yaEstaba !== null && mismoValor(yaEstaba.valor, valor)) continue; // idéntico a lo guardado: no se toca
        if (sabido !== null && mismoValor(sabido.valor, valor)) {
          await this.repo.guardarRespuesta(c, {
            organizationId: org, pregunta, valor, procedencia: sabido.procedencia, confirmacion: 'DISCOVERED',
          });
          continue;
        }
        await this.repo.guardarRespuesta(c, {
          organizationId: org, pregunta, valor, procedencia: 'USER', confirmacion: 'USER_CONFIRMED',
        });
      }
      return iniciado;
    });

    // Contexto con las respuestas nuevas ya dentro: la traducción usa lo último que dijo la persona.
    const { ctx } = await this.contexto(org);
    await this.traducir(org, actor, paso, ctx);
    await this.derivarCapacidadesSeguras(org, ctx);

    const { ctx: despues, estado } = await this.contexto(org);
    const pasos = construirPasos(despues);
    const completados = new Set<PasoId>(estado?.pasosCompletados ?? []);
    for (const p of pasos) {
      if (p.estado === 'COMPLETO') completados.add(p.id);
      else completados.delete(p.id);
    }
    const destino = entrada.avanzar === false ? paso : siguientePaso(pasos);
    await this.repo.guardarProgreso(this.pool, org, {
      pasoActual: destino,
      pasosCompletados: [...completados],
      ...(estado?.estado === 'COMPLETE' ? {} : { estado: 'IN_PROGRESS' as EstadoOnboarding }),
    });

    await this.auditar(org, actor, primeraVez ? 'ONBOARDING_STARTED' : 'ONBOARDING_PROGRESS_UPDATED', {
      paso,
      preguntas: [...nuevas.keys()],
      progreso: progreso(pasos),
    });
    void antes;
    void estadoAntes;
    await this.deps.refrescar?.();
    return this.leer(org);
  }

  /**
   * Inspección mínima del propio sitio. Lo observado queda como `DISCOVERED`: se ofrece para confirmar y NO
   * se escribe en el negocio por su cuenta.
   */
  async inspeccionarSitioDeclarado(org: string, actor: string, url?: string): Promise<VistaOnboarding> {
    const { ctx } = await this.contexto(org);
    const direccion = comoTexto(url) !== '' ? comoTexto(url) : (ctx.perfil.website ?? '');
    if (direccion === '') throw new OnboardingInvalidoError('no hay ninguna dirección de sitio que revisar');
    const r = await inspeccionarSitio(direccion, this.deps.inspeccion ?? {});
    await enTransaccion(this.pool, async (c) => {
      await this.repo.guardarObservacionSitio(c, { organizationId: org, ...r });
      // La descripción leída del sitio se PROPONE (nunca se confirma sola) y sólo si la persona no escribió una.
      if (r.estado === 'OK' && !ctx.respuestas.has('negocio.aQueSeDedica')) {
        const propuesta = (r.metaDescription ?? r.titulo ?? '').trim();
        if (propuesta !== '') {
          await this.repo.guardarRespuesta(c, {
            organizationId: org, pregunta: 'negocio.aQueSeDedica', valor: propuesta,
            procedencia: 'WEBSITE', confirmacion: 'DISCOVERED',
          });
        }
      }
    });
    await this.auditar(org, actor, 'ONBOARDING_PROGRESS_UPDATED', { sitio: r.estado, url: r.url });
    return this.leer(org);
  }

  /** Marca el asistente como terminado, o dice qué falta. No cambia ningún permiso. */
  async completar(org: string, actor: string): Promise<VistaOnboarding> {
    const { ctx } = await this.contexto(org);
    const pasos = construirPasos(ctx);
    const readiness = await this.readinessDe(org, ctx);
    const negocioListo = readiness.niveles.find((n) => n.nivel === 'BUSINESS_READY')?.listo === true;
    const pendientes = pasos.filter((p) => p.estado === 'PENDIENTE' && p.preguntas.length > 0);
    // NEEDS_ACTION va ANTES que COMPLETE: si la persona ya respondió todo y lo que falta es un acto suyo
    // —conectar una cuenta—, decir «completo» sería mentir sobre el estado real de su empresa.
    const estado: EstadoOnboarding = pendientes.length === 0 && readiness.resumen === 'REQUIERE_TU_ACCION'
      ? 'NEEDS_ACTION'
      : negocioListo && pendientes.length === 0
        ? 'COMPLETE'
        : 'IN_PROGRESS';
    await this.repo.guardarProgreso(this.pool, org, {
      estado,
      pasoActual: estado === 'COMPLETE' ? 'resumen' : siguientePaso(pasos),
      ...(estado === 'COMPLETE' ? { completadoEn: this.ahora() } : {}),
    });
    if (estado === 'COMPLETE' || estado === 'NEEDS_ACTION') {
      await this.auditar(org, actor, estado === 'COMPLETE' ? 'ONBOARDING_COMPLETED' : 'ONBOARDING_PROGRESS_UPDATED', {
        progreso: progreso(pasos), estado, pendientes: pendientes.map((p) => p.id),
      });
    }
    if (estado === 'COMPLETE') {
      // El estado del negocio pasa de borrador a activo: ya está entendido. Sigue sin permisos de gasto.
      if (ctx.perfil.status === 'DRAFT' || ctx.perfil.status === 'CONFIGURING') {
        await this.negocios.actualizarPerfil(org, { status: 'READY' });
      }
    }
    await this.deps.refrescar?.();
    return this.leer(org);
  }

  /** Reabre el asistente para revisar o corregir respuestas. Nada se borra. */
  async reabrir(org: string, actor: string): Promise<VistaOnboarding> {
    await this.contexto(org);
    await this.repo.iniciarSiFalta(this.pool, org, 'negocio');
    await this.repo.guardarProgreso(this.pool, org, { estado: 'IN_PROGRESS', reabiertoEn: this.ahora() });
    await this.auditar(org, actor, 'ONBOARDING_REOPENED', {});
    return this.leer(org);
  }

  // ── VALIDACIÓN Y TRADUCCIÓN ───────────────────────────────────────────────────────────────────

  /** Acepta sólo preguntas del paso indicado y normaliza el valor según su tipo. */
  private validarRespuestas(paso: PasoId, respuestas: Readonly<Record<string, unknown>>): Map<string, unknown> {
    const salida = new Map<string, unknown>();
    for (const [id, valor] of Object.entries(respuestas)) {
      const def = PREGUNTAS_POR_ID.get(id);
      if (def === undefined) throw new OnboardingInvalidoError(`pregunta desconocida: ${id}`);
      if (def.paso !== paso) throw new OnboardingInvalidoError(`la pregunta '${id}' no pertenece a este paso`);
      switch (def.tipo) {
        case 'NUMERO': {
          const n = comoNumero(valor);
          salida.set(id, n);
          break;
        }
        case 'SI_NO':
          salida.set(id, valor === true || valor === 'true' || valor === 'si');
          break;
        case 'OPCIONES':
          salida.set(id, comoLista(valor).slice(0, 20));
          break;
        default: {
          const t = comoTexto(valor);
          if (t.length > 4000) throw new OnboardingInvalidoError(`la respuesta de '${id}' es demasiado larga`);
          salida.set(id, t);
        }
      }
    }
    return salida;
  }

  /** Traduce el paso a los datos canónicos. Cada rama toca SÓLO su tabla. */
  private async traducir(org: string, actor: string, paso: PasoId, ctx: ContextoOnboarding): Promise<void> {
    /** Sólo lo CONFIRMADO por una persona se escribe en el negocio (lo descubierto se propone). */
    const valor = (id: string): unknown => {
      const r = ctx.respuestas.get(id);
      return r !== undefined && r.confirmacion === 'USER_CONFIRMED' ? r.valor : null;
    };

    if (paso === 'negocio') await this.traducirNegocio(org, ctx, valor);
    if (paso === 'oferta') await this.traducirOferta(org, ctx, valor);
    if (paso === 'territorio') await this.traducirTerritorio(org, ctx, valor);
    if (paso === 'objetivo') await this.traducirObjetivo(org, actor, valor);
    if (paso === 'contacto') await this.traducirContacto(org, actor, ctx, valor);
    if (paso === 'restricciones') await this.traducirRestricciones(org, ctx);
    if (paso === 'medicion') await this.traducirMedicion(org, actor, ctx, valor);
    if (paso === 'presupuesto') await this.traducirPresupuesto(org, actor, valor);
    if (paso === 'autonomia') await this.traducirAutonomia(org, actor, valor);
    // `conexiones` no escribe nada: conectar una cuenta es un acto aparte (OAuth) y la respuesta sólo
    // sirve para saber qué esperar. `resumen` tampoco: es una pantalla de revisión.
  }

  private async traducirNegocio(org: string, ctx: ContextoOnboarding, valor: (id: string) => unknown): Promise<void> {
    const cambios: Record<string, unknown> = {};
    const descripcion = comoTexto(valor('negocio.aQueSeDedica'));
    if (descripcion !== '') cambios.description = descripcion;
    const tipo = comoTexto(valor('negocio.tipo'));
    if (tipo !== '') cambios.businessType = tipo as TipoNegocio;
    const cliente = comoTexto(valor('negocio.tipoCliente'));
    if (cliente !== '') cambios.customerType = cliente as TipoCliente;
    const sitio = comoTexto(valor('negocio.sitio'));
    if (sitio !== '') {
      // Se valida con la MISMA regla que usa la inspección: https y dominio de verdad. Un texto escrito por
      // error no puede quedar guardado como si fuera el sitio de la empresa.
      const v = validarUrlDeSitio(sitio);
      if (!v.ok) throw new OnboardingInvalidoError(`la dirección del sitio no es válida: ${v.motivo}`);
      cambios.website = v.url.toString();
    }
    const pais = comoTexto(valor('negocio.pais')).toUpperCase();
    if (pais !== '' && pais !== ctx.perfil.country) {
      cambios.country = pais;
      const d = POR_PAIS[pais];
      if (d) {
        cambios.currency = d.moneda;
        cambios.timezone = d.zona;
      }
    }
    if (Object.keys(cambios).length === 0) return;
    await enTransaccion(this.pool, async (c) => {
      await this.negocios.actualizarPerfil(org, cambios as CambiosPerfil, c);
    });
  }

  private async traducirOferta(org: string, ctx: ContextoOnboarding, valor: (id: string) => unknown): Promise<void> {
    const escrito = comoTexto(valor('oferta.queVendes'));
    const prioritarios = new Set(comoLista(valor('oferta.prioritarios')));
    const nombres = escrito !== '' ? trocearEnumeracion(escrito) : ctx.oferta.map((o) => o.name);
    if (nombres.length === 0 && prioritarios.size === 0) return;

    await enTransaccion(this.pool, async (c) => {
      const vistos = new Set<string>();
      for (const nombre of nombres) {
        const slug = claveDesdeTexto(nombre);
        if (slug === '' || vistos.has(slug)) continue;
        vistos.add(slug);
        const existente = ctx.oferta.find((o) => o.slug === slug) ?? null;
        const prioridad = prioritarios.size > 0 ? (prioritarios.has(slug) ? 10 : 50) : existente?.priority ?? 100;
        await this.negocios.guardarOferta(c, {
          organizationId: org,
          id: existente?.id ?? slug,
          slug,
          name: nombre,
          description: existente?.description ?? null,
          category: existente?.category ?? null,
          status: 'ACTIVE',
          landingUrl: existente?.landingUrl ?? null,
          priority: prioridad,
          geographicScope: existente?.geographicScope ?? null,
          // Declarada por el dueño; promocionarla sigue siendo una decisión aparte.
          advertisingEligibility: existente?.advertisingEligibility ?? 'REQUIRES_APPROVAL',
          restrictions: existente?.restrictions ?? [],
        });
      }
      // Lo que el dueño ya no menciona se RETIRA (no se borra): su historia se conserva.
      if (escrito !== '') {
        for (const o of ctx.oferta) {
          if (!vistos.has(o.slug) && o.status === 'ACTIVE') {
            await this.negocios.guardarOferta(c, { ...o, status: 'RETIRED' });
          }
        }
      }
    });
  }

  private async traducirTerritorio(org: string, ctx: ContextoOnboarding, valor: (id: string) => unknown): Promise<void> {
    const donde = comoTexto(valor('territorio.donde'));
    const region = comoTexto(valor('territorio.region'));
    const paisesSaas = comoTexto(valor('territorio.alcanceSaas'));
    if (donde === '' && region === '' && paisesSaas === '') return;
    const localidades = donde !== '' ? trocearEnumeracion(donde) : (ctx.territorios.find((t) => t.ambito === 'BUSINESS')?.localities ?? []);
    const existente = ctx.territorios.find((t) => t.ambito === 'BUSINESS') ?? null;
    await enTransaccion(this.pool, async (c) => {
      await this.negocios.guardarTerritorio(c, {
        organizationId: org,
        id: existente?.id ?? 'business',
        ambito: 'BUSINESS',
        country: existente?.country ?? ctx.perfil.country,
        region: region !== '' ? region : existente?.region ?? null,
        province: existente?.province ?? null,
        localities: [...localidades],
        criterio: existente?.criterio ?? null,
        nota: paisesSaas !== '' ? `países declarados: ${paisesSaas}` : existente?.nota ?? 'territorio declarado en la incorporación',
      });
    });
  }

  private async traducirObjetivo(org: string, actor: string, valor: (id: string) => unknown): Promise<void> {
    const elegido = comoTexto(valor('objetivo.queQuieres'));
    const horizonte = comoNumero(valor('objetivo.enCuantoTiempo'));
    const doc: DocumentoPolitica = {
      ...(elegido !== '' && TEXTO_DE_OBJETIVO[elegido] ? { objetivoText: TEXTO_DE_OBJETIVO[elegido] } : {}),
      ...(horizonte !== null ? { evaluationHorizonDays: horizonte } : {}),
    };
    if (Object.keys(doc).length > 0) await this.politica.guardar(org, actor, doc);
    if (elegido !== '' && TEXTO_DE_OBJETIVO[elegido]) {
      // El objetivo en lenguaje de negocio vive en el perfil comercial: es lo que el panel muestra.
      await this.negocios.actualizarPerfil(org, { primaryObjective: TEXTO_DE_OBJETIVO[elegido]! });
    }
  }

  private async traducirContacto(org: string, actor: string, ctx: ContextoOnboarding, valor: (id: string) => unknown): Promise<void> {
    const elegidas = comoLista(valor('contacto.como'));
    if (elegidas.length === 0) return;
    const principal = comoTexto(valor('contacto.principal'));
    const clave = principal !== '' && elegidas.includes(principal) ? principal : elegidas[0]!;
    const eventos = elegidas
      .map((v) => ACCIONES.find((a) => a.valor === v) ?? null)
      .filter((a): a is (typeof ACCIONES)[number] => a !== null)
      .map((a, i) => ({
        eventKey: a.eventKey,
        rol: (a.valor === clave ? 'PRIMARY' : 'SECONDARY') as 'PRIMARY' | 'SECONDARY',
        orden: a.valor === clave ? 0 : i + 1,
        displayName: a.etiqueta,
      }));
    const vigentes = new Set(eventos.map((e) => e.eventKey));
    const eliminados = ctx.politica.eventos.filter((e) => !vigentes.has(e.eventKey)).map((e) => e.eventKey);
    await this.politica.guardar(org, actor, { eventos, ...(eliminados.length > 0 ? { eventosEliminados: eliminados } : {}) });
  }

  /**
   * Los límites comerciales se leen de la RESPUESTA del paso (no del filtro de confirmadas) porque una
   * respuesta vacía también es información: significa «no hay nada que ocultar», y deja el dominio resuelto.
   */
  private async traducirRestricciones(org: string, ctx: ContextoOnboarding): Promise<void> {
    const porTipo: ReadonlyArray<{ id: string; tipo: 'RESTRICTION' | 'PROHIBITED_CLAIM'; prefijo: string }> = [
      { id: 'restricciones.noOfrecemos', tipo: 'RESTRICTION', prefijo: 'onb-restriccion' },
      { id: 'restricciones.noPodemosAfirmar', tipo: 'PROHIBITED_CLAIM', prefijo: 'onb-claim' },
    ];
    await enTransaccion(this.pool, async (c) => {
      for (const grupo of porTipo) {
        const respuesta = ctx.respuestas.get(grupo.id);
        if (respuesta === undefined) continue; // no se preguntó: no se toca nada
        const textos = trocearEnumeracion(comoTexto(respuesta.valor));
        const ids = new Set<string>();
        for (const texto of textos) {
          const id = `${grupo.prefijo}-${claveDesdeTexto(texto).slice(0, 40)}`;
          ids.add(id);
          await this.negocios.guardarRestriccion(c, { organizationId: org, id, tipo: grupo.tipo, texto, alcance: null });
        }
        // Sólo se retiran las que creó el asistente: lo que puso otra fuente no se toca.
        for (const r of ctx.restricciones) {
          if (r.id.startsWith(`${grupo.prefijo}-`) && !ids.has(r.id)) {
            await this.negocios.borrarRestriccion(c, org, r.id);
          }
        }
      }
    });
  }

  private async traducirMedicion(org: string, actor: string, ctx: ContextoOnboarding, valor: (id: string) => unknown): Promise<void> {
    const elegido = comoTexto(valor('medicion.indicador'));
    const indicador = INDICADORES.find((i) => i.valor === elegido) ?? null;
    const conoceMeta = valor('medicion.conoceMeta') === true;
    const meta = conoceMeta ? comoNumero(valor('medicion.meta')) : null;
    const modoEvidencia = comoTexto(valor('medicion.evidencia'));
    const evidenciaPropia = comoNumero(valor('medicion.evidenciaValor'));
    const eventoPrincipal = ctx.politica.eventos.find((e) => e.rol === 'PRIMARY')?.eventKey ?? null;

    const doc: DocumentoPolitica = {};
    if (indicador !== null) {
      (doc as { kpis?: unknown }).kpis = [{
        id: 'principal',
        rol: 'PRIMARY',
        clave: indicador.clave,
        displayName: indicador.etiqueta,
        tipo: indicador.tipo,
        unidad: indicador.unidad,
        direccion: indicador.direccion,
        eventKey: eventoPrincipal,
        targetValue: meta,
        baselineValue: 0,
        tolerance: 0.2,
        // Sin meta conocida NO se inventa una: se declara que está por aprender con datos reales.
        estado: meta !== null ? 'CONFIGURED' : 'UNKNOWN',
        procedencia: meta !== null ? 'USER_DEFINED' : 'TO_BE_LEARNED',
        ...(meta === null ? { nota: 'el negocio aún no conoce la meta; se aprenderá observando los primeros datos' } : {}),
      }];
    }
    if (modoEvidencia === 'prudente') {
      const base = DEFAULTS_EVIDENCIA_V1.IMPRESSIONS ?? null;
      if (base !== null) {
        (doc as { reglas?: unknown }).reglas = [{
          id: 'evidencia-impresiones', tipo: 'EVIDENCE_MINIMUM', metrica: 'IMPRESSIONS', comparador: 'GTE',
          valor: base, estado: 'CONFIGURED', procedencia: 'SYSTEM_DEFAULT',
          nota: `punto de partida del sistema (${VERSION_DEFAULTS_EVIDENCIA}); el negocio puede cambiarlo cuando quiera`,
        }];
      }
    } else if (modoEvidencia === 'propio' && evidenciaPropia !== null) {
      (doc as { reglas?: unknown }).reglas = [{
        id: 'evidencia-impresiones', tipo: 'EVIDENCE_MINIMUM', metrica: 'IMPRESSIONS', comparador: 'GTE',
        valor: evidenciaPropia, estado: 'CONFIGURED', procedencia: 'USER_DEFINED', nota: null,
      }];
    }
    if (Object.keys(doc).length > 0) await this.politica.guardar(org, actor, doc);
  }

  private async traducirPresupuesto(org: string, actor: string, valor: (id: string) => unknown): Promise<void> {
    const modalidad = comoTexto(valor('presupuesto.modalidad')) as ModalidadPresupuesto;
    if (modalidad === '' as ModalidadPresupuesto) return;
    const monto = comoNumero(valor('presupuesto.monto'));
    await enTransaccion(this.pool, async (c) => {
      await this.repo.guardarIntencionPresupuesto(c, {
        organizationId: org, modalidad, montoClp: modalidad === 'DAILY' || modalidad === 'MONTHLY' ? monto : null,
        moneda: 'CLP', declaradoPor: actor,
      });
    });
    // Un máximo POR DÍA es exactamente el tope operativo que SOEC no puede pasar: va a su tabla canónica.
    // Guardar un techo NO autoriza gastar: la autorización financiera es un mandato y la crea una persona
    // en un acto aparte.
    if (modalidad === 'DAILY' && monto !== null) {
      await this.politica.guardar(org, actor, { limites: { maxDailyBudgetClp: monto } });
    }
  }

  private async traducirAutonomia(org: string, actor: string, valor: (id: string) => unknown): Promise<void> {
    const preferencia = comoTexto(valor('autonomia.preferencia')) as PreferenciaAutonomia;
    const modo = MODO_DE_PREFERENCIA[preferencia];
    if (modo === undefined) return;
    const r = (await this.deps.aplicarModo?.(modo)) ?? { ok: false, motivo: 'el cambio de modo se aplica desde la configuración de la empresa' };
    await enTransaccion(this.pool, async (c) => {
      await this.repo.guardarRespuesta(c, {
        organizationId: org, pregunta: 'autonomia.resultado', valor: { modo, ok: r.ok, motivo: r.motivo },
        procedencia: 'DERIVED', confirmacion: 'DISCOVERED',
      });
    });
    void actor;
  }

  /**
   * CAPACIDADES DERIVADAS — sólo de LECTURA y sólo cuando hay una conexión válida que las sostiene.
   *
   * Lo que se deriva: leer los datos del propio sitio (`INGESTA_GROWTH`) y ver medición real
   * (`MEDICION_REAL`). Lo que NUNCA se deriva: el ciclo del director y el monitor de seguridad (consumen
   * cuota y tocan el camino de seguridad), la autonomía de anuncios, cualquier escritura externa y el gasto
   * autónomo. Eso exige un acto explícito del dueño y las puertas de gobierno.
   *
   * Se usa `fijarCapacidadSiFalta`: si una persona ya la apagó, sigue apagada.
   */
  private async derivarCapacidadesSeguras(org: string, ctx: ContextoOnboarding): Promise<void> {
    const conectado = (p: string): boolean => ctx.conexiones.some((c) => c.provider === p && c.estado === 'CONNECTED');
    const derivadas: Array<{ capacidad: 'INGESTA_GROWTH' | 'MEDICION_REAL'; nota: string }> = [];
    if (conectado('GROWTH_M2M')) derivadas.push({ capacidad: 'INGESTA_GROWTH', nota: 'derivada: el sitio del negocio está conectado y envía su actividad' });
    if (conectado('GROWTH_M2M') || conectado('GOOGLE_ADS') || conectado('META_ADS')) {
      derivadas.push({ capacidad: 'MEDICION_REAL', nota: 'derivada: hay al menos una fuente de datos conectada' });
    }
    if (derivadas.length === 0) return;
    await enTransaccion(this.pool, async (c) => {
      for (const d of derivadas) {
        await this.conexiones.fijarCapacidadSiFalta(c, {
          organizationId: org, capacidad: d.capacidad, habilitada: true, origen: 'SISTEMA', nota: d.nota,
          actor: 'onboarding',
        });
      }
    });
  }

  private async auditar(org: string, actor: string, accion: string, campos: Record<string, unknown>): Promise<void> {
    // Sin secretos y sin cada pulsación: se registran hitos, no teclas.
    await this.negocios.registrarAuditoria(this.pool, {
      organizationId: org, actor, action: accion, changedFields: { ...campos, at: this.ahora() },
    });
  }
}

export type { RespuestaOnboarding };
