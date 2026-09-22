/**
 * apps/api · OPTIMIZACIÓN AUTÓNOMA · el ciclo y sus casos de uso.
 *
 *   OBSERVAR → EVALUAR → DECIDIR → GOBERNAR → EJECUTAR → VERIFICAR → APRENDER
 *
 * Cada etapa puede terminar el ciclo, y terminar sin hacer nada es el desenlace más frecuente y más sano.
 *
 * AISLAMIENTO: un fallo en una empresa o en una campaña no detiene a las demás — cada ciclo se abre, se cierra
 * y se registra por separado, y el error queda descrito en su propio ciclo.
 *
 * LO QUE ESTE SERVICIO NO PUEDE HACER: encender una campaña sin que se cumplan las ocho condiciones de
 * activación; superar el mandato financiero; saltarse el modo operativo; ni ejecutar en modo sombra.
 */
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { RepositorioNegocios } from '../negocio/negocio-pg';
import { RepositorioPolitica } from '../politica/politica-pg';
import { RepositorioConexiones } from '../conexion/conexion-pg';
import { RepositorioEjecucion } from '../ejecucion/ejecucion-pg';
import { estadoDeMedicion } from '../ejecucion/conversiones';
import { PgMandatoRepo } from '../accion/accion-pg';
import { esActorSistema, restanteMinor, type Mandato } from '../accion/mandato';
import { mutacionesExternasHabilitadas } from '../gobierno/kill-switch';
import type { GoogleAdsMutateHttpClient } from '../campana/google-ads-mutate-http';
import {
  POLITICA_AUTONOMIA_POR_DEFECTO,
  RepositorioOptimizacion,
  type AccionPendiente,
  type CicloOptimizacion,
  type DecisionOptimizacion,
  type PoliticaAutonomia,
  type SnapshotObservacion,
} from './optimizacion-pg';
import {
  ACCIONES,
  ACCIONES_EJECUTABLES,
  DIAS_PARA_JUZGAR_EFECTO,
  OptimizacionInvalidaError,
  OptimizacionNoEncontradaError,
  VENTANA_DIAS_POR_DEFECTO,
  type AccionOptimizacion,
  type EstadoCiclo,
  type ModoCiclo,
  type SaludMedicion,
} from './optimizacion-tipos';
import { evaluarEvidencia, type ResultadoEvidencia } from './evidencia';
import { decidir, juzgarEfecto, type Propuesta } from './reglas';
import { gobernar, puedeActivarse, type ResultadoGobierno } from './gobierno';
import { leerEstrategiaDePuja, leerNegativasExistentes, observar, ventanaDe } from './observacion';
import { aplicarDecision, claveIdempotencia } from './ejecutor-acciones';

export class NegocioSinPerfilError extends Error {}

export interface VistaOptimizacion {
  readonly organizationId: string;
  readonly ciclo: CicloOptimizacion | null;
  readonly snapshot: SnapshotObservacion | null;
  readonly decisiones: readonly (DecisionOptimizacion & { readonly gobierno?: ResultadoGobierno })[];
  readonly pendientes: readonly (AccionPendiente & { readonly decision: DecisionOptimizacion | null })[];
  readonly aplicadas: readonly { readonly accion: string; readonly resultado: string; readonly verificacion: string; readonly aplicadoEn: string }[];
  readonly politica: PoliticaAutonomia;
  readonly modoOperativo: string | null;
  readonly evidencia: ResultadoEvidencia | null;
  readonly aprendizajes: readonly { readonly accion: string; readonly efectoEsperado: string; readonly resultado: string; readonly evaluadoEn: string | null }[];
  readonly historial: readonly { readonly id: string; readonly estado: EstadoCiclo; readonly modo: ModoCiclo; readonly iniciadoEn: string; readonly decisiones: number }[];
  readonly campania: { readonly id: string | null; readonly estado: string | null; readonly puedeActivarse: boolean; readonly faltanParaActivar: readonly string[] } | null;
}

export interface DepsOptimizacion {
  readonly ahora?: () => string;
  readonly env?: NodeJS.ProcessEnv;
  readonly clienteGoogle?: (org: string) => Promise<GoogleAdsMutateHttpClient | null>;
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

const horasEntre = (a: string, b: string): number => (Date.parse(a) - Date.parse(b)) / 3_600_000;

export class OptimizacionService {
  private readonly repo: RepositorioOptimizacion;
  private readonly negocios: RepositorioNegocios;
  private readonly politicas: RepositorioPolitica;
  private readonly conexiones: RepositorioConexiones;
  private readonly ejecucion: RepositorioEjecucion;
  private readonly mandatos: PgMandatoRepo;
  private readonly ahora: () => string;
  private readonly env: NodeJS.ProcessEnv;

  constructor(private readonly pool: Pool, private readonly deps: DepsOptimizacion = {}) {
    this.repo = new RepositorioOptimizacion(pool);
    this.negocios = new RepositorioNegocios(pool);
    this.politicas = new RepositorioPolitica(pool);
    this.conexiones = new RepositorioConexiones(pool);
    this.ejecucion = new RepositorioEjecucion(pool);
    this.mandatos = new PgMandatoRepo(pool);
    this.ahora = deps.ahora ?? (() => new Date().toISOString());
    this.env = deps.env ?? process.env;
  }

  // ── CONTEXTO ──────────────────────────────────────────────────────────────────────────────────

  private async contexto(org: string, modoOperativo: string | null) {
    const perfil = await this.negocios.perfil(org);
    if (perfil === null) throw new NegocioSinPerfilError(`el negocio '${org}' no existe`);
    const [gobiernoFila, oferta, territorios, restricciones, politicaEval, conexion, capacidades, mandato, politicaAuto, peticion] = await Promise.all([
      this.negocios.gobierno(org),
      this.negocios.oferta(org),
      this.negocios.territorios(org),
      this.negocios.restricciones(org),
      this.politicas.completa(org),
      this.conexiones.buscar(org, 'GOOGLE_ADS'),
      this.conexiones.capacidades(org),
      this.mandatos.actual(org),
      this.repo.politica(org),
      this.ejecucion.ultima(org),
    ]);
    const [mapeos, medicion] = await Promise.all([
      this.ejecucion.mapeos(org, 'GOOGLE_ADS'),
      this.ejecucion.medicion(org, 'GOOGLE_ADS'),
    ]);
    const salud: SaludMedicion = politicaEval.eventos.length === 0
      ? 'UNKNOWN'
      : politicaEval.eventos.every((e) => {
        const m = mapeos.find((x) => x.eventKey === e.eventKey) ?? null;
        const inst = medicion.find((x) => x.eventKey === e.eventKey)?.estado ?? null;
        return estadoDeMedicion(m, inst) === 'VERIFIED';
      })
        ? 'HEALTHY'
        : politicaEval.eventos.some((e) => (medicion.find((x) => x.eventKey === e.eventKey)?.estado ?? null) === 'DEGRADED')
          ? 'DEGRADED'
          : 'UNKNOWN';

    const cfg = (conexion?.configuracion ?? {}) as { customerId?: string };
    const customerId = (cfg.customerId ?? conexion?.externalAccountId ?? '').replace(/\D/g, '') || null;
    const campaignId = peticion?.recursosExternos?.campaigns?.[0]?.split('/').pop()
      ?? await this.campaniaVinculadaHistorica(org);

    return {
      perfil,
      gobierno: gobiernoFila ?? { organizationId: org, externalMutations: false, autonomousSpend: false, automaticSafetyPause: false, campaignExecution: false, updatedAt: this.ahora() },
      oferta, territorios, restricciones, politicaEval, mandato, peticion, salud,
      customerId, campaignId, modoOperativo,
      politicaAutonomia: politicaAuto ?? POLITICA_AUTONOMIA_POR_DEFECTO(org, this.ahora()),
      capacidadEscritura: capacidades.some((c) => c.capacidad === 'ESCRITURA_ADS' && c.habilitada),
      conexionValida: conexion !== null && conexion.estado === 'CONNECTED',
    };
  }

  // ── LECTURA ───────────────────────────────────────────────────────────────────────────────────

  async estado(org: string, modoOperativo: string | null): Promise<VistaOptimizacion> {
    const c = await this.contexto(org, modoOperativo);
    const ciclo = await this.repo.ultimoCiclo(org);
    const decisiones = ciclo === null ? [] : await this.repo.decisiones(org, ciclo.id);
    const snapshot = ciclo?.snapshotId ? await this.repo.snapshot(org, ciclo.snapshotId) : null;
    const pendientesBase = await this.repo.pendientes(org, ['PENDING']);
    const pendientes = await Promise.all(pendientesBase.map(async (p) => ({ ...p, decision: await this.repo.decision(org, p.decisionId) })));
    const aplicadas = ciclo === null ? [] : (await this.repo.accionesDelCiclo(org, ciclo.id)).map((a) => ({ accion: a.accion, resultado: a.resultado, verificacion: a.verificacion, aplicadoEn: a.aplicadoEn }));
    const aprendizajes = (await this.repo.aprendizajes(org, 10)).map((l) => ({ accion: l.accion, efectoEsperado: l.efectoEsperado, resultado: l.resultado, evaluadoEn: l.evaluadoEn }));
    const historial = await Promise.all((await this.repo.ciclos(org, 10)).map(async (x) => ({
      id: x.id, estado: x.estado, modo: x.modo, iniciadoEn: x.iniciadoEn,
      decisiones: (await this.repo.decisiones(org, x.id)).length,
    })));

    const evidencia = snapshot === null ? null : evaluarEvidencia({
      politica: c.politicaEval, ventana: snapshot.ventana, metricas: snapshot.campania,
      saludMedicion: snapshot.saludMedicion, datosHasta: snapshot.datosHasta, ahora: this.ahora(),
      horasDesdeUltimoCambio: null, cooldownHoras: c.politicaAutonomia.cooldownHoras,
    });

    const activacion = puedeActivarse({
      reconciliacionOk: c.peticion?.reconciliacion?.coincide === true,
      medicionVerificada: c.salud === 'HEALTHY',
      mandatoVigente: this.mandatoVigente(c.mandato),
      requisitosEjecucionOk: c.peticion?.estado === 'CREATED_PAUSED',
      conexionValida: c.conexionValida,
      capacidadEscritura: c.capacidadEscritura,
      gobiernoExternalMutations: c.gobierno.externalMutations,
      killSwitchAbierto: mutacionesExternasHabilitadas(this.env),
    });

    return {
      organizationId: org, ciclo, snapshot, decisiones, pendientes, aplicadas,
      politica: c.politicaAutonomia, modoOperativo, evidencia, aprendizajes, historial,
      campania: c.campaignId === null ? null : {
        id: c.campaignId,
        estado: snapshot?.campania.estado ?? null,
        puedeActivarse: activacion.puede,
        faltanParaActivar: activacion.faltan,
      },
    };
  }

  /**
   * Campaña vinculada por el camino HISTÓRICO (antes de que existieran las peticiones de ejecución). Se usa
   * sólo para OBSERVAR: permite correr el ciclo en modo sombra sobre una campaña que SOEC creó en su día,
   * sin inventar ningún vínculo. Si no hay binding con identificador real, no hay campaña que mirar.
   */
  private async campaniaVinculadaHistorica(org: string): Promise<string | null> {
    try {
      const { rows } = await this.pool.query(
        `select payload->>'providerResourceId' as recurso
         from events
         where organization_id = $1 and type = 'provider-resource-binding.registrado'
           and payload->>'entityType' = 'campaign' and payload->>'providerResourceId' is not null
         order by sequence desc limit 1`,
        [org],
      );
      const recurso = (rows[0] as { recurso?: string } | undefined)?.recurso ?? null;
      return recurso === null ? null : (recurso.split('/').pop() ?? null);
    } catch {
      return null;
    }
  }

  private mandatoVigente(m: Mandato | null): boolean {
    return m !== null && !m.killSwitch && (m.status === 'AUTHORIZED' || m.status === 'ACTIVE')
      && Date.parse(m.periodEnd) > Date.parse(this.ahora()) && restanteMinor(m) > 0;
  }

  // ── POLÍTICA DE AUTONOMÍA ─────────────────────────────────────────────────────────────────────

  /**
   * Fija los límites de QUÉ puede hacer SOEC sola. Acto humano: el sistema no se amplía permisos a sí mismo, y
   * `activacionAutonomaPermitida` sólo puede encenderse diciéndolo — jamás se infiere del presupuesto.
   */
  async fijarPolitica(org: string, actor: string, entrada: Partial<PoliticaAutonomia>): Promise<VistaOptimizacion> {
    if (esActorSistema(actor)) throw new OptimizacionInvalidaError('estos límites los fija una persona, no el sistema');
    const actual = (await this.repo.politica(org)) ?? POLITICA_AUTONOMIA_POR_DEFECTO(org, this.ahora());
    const acciones = (entrada.accionesPermitidas ?? actual.accionesPermitidas).filter((a): a is AccionOptimizacion => ACCIONES.includes(a as AccionOptimizacion));
    const noEjecutables = acciones.filter((a) => !ACCIONES_EJECUTABLES.includes(a));
    if (noEjecutables.length > 0) {
      throw new OptimizacionInvalidaError(`esta versión todavía no ejecuta: ${noEjecutables.join(', ')}`);
    }
    const ahora = this.ahora();
    const nueva: PoliticaAutonomia = {
      organizationId: org,
      version: actual.version + 1,
      accionesPermitidas: acciones,
      maxCambioPresupuestoPct: acotar(entrada.maxCambioPresupuestoPct ?? actual.maxCambioPresupuestoPct, 0, 50),
      maxCambioCpcPct: acotar(entrada.maxCambioCpcPct ?? actual.maxCambioCpcPct, 0, 50),
      maxCambiosPorDia: acotar(entrada.maxCambiosPorDia ?? actual.maxCambiosPorDia, 0, 20),
      cooldownHoras: acotar(entrada.cooldownHoras ?? actual.cooldownHoras, 1, 168),
      horasPermitidas: entrada.horasPermitidas ?? actual.horasPermitidas,
      activacionAutonomaPermitida: entrada.activacionAutonomaPermitida ?? actual.activacionAutonomaPermitida,
      actualizadoPor: actor,
      actualizadoEn: ahora,
    };
    await enTransaccion(this.pool, async (tx) => {
      await this.repo.guardarPolitica(tx, nueva);
      await this.negocios.registrarAuditoria(tx, {
        organizationId: org, actor, action: 'AUTONOMY_POLICY_UPDATED',
        changedFields: {
          acciones: nueva.accionesPermitidas, maxPresupuestoPct: nueva.maxCambioPresupuestoPct,
          maxCpcPct: nueva.maxCambioCpcPct, maxCambiosDia: nueva.maxCambiosPorDia,
          cooldownHoras: nueva.cooldownHoras, activacionAutonoma: nueva.activacionAutonomaPermitida,
        },
      });
    });
    return this.estado(org, null);
  }

  // ── CICLO ─────────────────────────────────────────────────────────────────────────────────────

  /**
   * Corre un ciclo completo. `modo` decide hasta dónde llega: en `SHADOW` se registra qué se habría hecho; en
   * `SUPERVISED` las decisiones van a la cola de aprobación; en `AUTONOMOUS` se ejecutan las que la política
   * permita y el mandato aguante.
   */
  async correrCiclo(org: string, opciones: { readonly modo?: ModoCiclo; readonly modoOperativo?: string | null; readonly ventanaDias?: number } = {}): Promise<VistaOptimizacion> {
    const modoOperativo = opciones.modoOperativo ?? null;
    const c = await this.contexto(org, modoOperativo);
    const modo: ModoCiclo = opciones.modo ?? (modoOperativo === 'AUTONOMOUS_REAL' ? 'AUTONOMOUS' : modoOperativo === 'SUPERVISED_REAL' ? 'SUPERVISED' : 'SHADOW');
    const ahora = this.ahora();
    const id = `ciclo-${ahora.slice(0, 10)}-${randomUUID().slice(0, 8)}`;
    const ventana = ventanaDe(ahora, opciones.ventanaDias ?? VENTANA_DIAS_POR_DEFECTO);

    const base: CicloOptimizacion = {
      organizationId: org, id, proveedor: 'GOOGLE_ADS', campaignId: c.campaignId, modo, estado: 'OBSERVING',
      ventana, snapshotId: null,
      politicaEvaluacionVersion: c.politicaEval.politica?.updatedAt ?? null,
      politicaAutonomiaVersion: c.politicaAutonomia.version,
      mandatoId: c.mandato?.id ?? null, mandatoVersion: c.mandato?.version ?? null,
      modoOperativo, resumen: {}, motivo: null, iniciadoEn: ahora, completadoEn: null,
    };
    await enTransaccion(this.pool, async (tx) => { await this.repo.crearCiclo(tx, base); });

    // Sin campaña que observar no hay ciclo: se cierra diciéndolo, sin inventar nada.
    if (c.campaignId === null || c.customerId === null) {
      await this.cerrar(org, id, 'NO_ACTION', 'todavía no hay una campaña creada que observar');
      return this.estado(org, modoOperativo);
    }
    const cliente = await this.deps.clienteGoogle?.(org);
    if (!cliente) {
      await this.cerrar(org, id, 'NO_ACTION', 'no hay acceso de lectura a la cuenta de publicidad');
      return this.estado(org, modoOperativo);
    }

    try {
      // ── OBSERVAR ──
      const snapshot = await observar({
        organizationId: org, cicloId: id, cliente, customerId: c.customerId, campaignId: c.campaignId,
        ventana, saludMedicion: c.salud, ahora, ...(this.deps.log ? { log: this.deps.log } : {}),
      });
      await enTransaccion(this.pool, async (tx) => {
        await this.repo.guardarSnapshot(tx, snapshot);
        await this.repo.actualizarCiclo(tx, org, id, { estado: 'EVALUATING', snapshotId: snapshot.id });
      });

      // ── EVALUAR ──
      const ultimoCambio = await this.repo.ultimaAccionSobre(org, 'ADJUST_DAILY_BUDGET', c.campaignId);
      const evidencia = evaluarEvidencia({
        politica: c.politicaEval, ventana, metricas: snapshot.campania, saludMedicion: c.salud,
        datosHasta: snapshot.datosHasta, ahora,
        horasDesdeUltimoCambio: ultimoCambio === null ? null : horasEntre(ahora, ultimoCambio.aplicadoEn),
        cooldownHoras: c.politicaAutonomia.cooldownHoras,
      });
      if (evidencia.veredicto !== 'SUFFICIENT') {
        await this.cerrar(org, id, 'WAITING_FOR_EVIDENCE', evidencia.motivo, { evidencia: evidencia.veredicto });
        return this.estado(org, modoOperativo);
      }

      // ── DECIDIR ──
      const [negativas, estrategia] = await Promise.all([
        leerNegativasExistentes(cliente, c.customerId, c.campaignId),
        leerEstrategiaDePuja(cliente, c.customerId, c.campaignId),
      ]);
      const propuestas = decidir({
        snapshot, politica: c.politicaEval, restricciones: c.restricciones,
        ofertas: c.oferta.filter((o) => o.status === 'ACTIVE').map((o) => o.name),
        localidades: c.territorios.find((t) => t.ambito === 'BUSINESS')?.localities ?? [],
        marca: c.perfil.displayName,
        permiteDecisionesDeConversion: evidencia.permiteDecisionesDeConversion,
        topeDiarioMandatoClp: this.topeDiario(c.mandato, ahora),
        negativasExistentes: negativas,
        cambiosRecientes: await this.cambiosRecientes(org, c.campaignId, ahora),
        ahora,
        maxCambioPresupuestoPct: c.politicaAutonomia.maxCambioPresupuestoPct,
        maxCambioCpcPct: c.politicaAutonomia.maxCambioCpcPct,
        estrategiaPuja: estrategia,
      });

      if (propuestas.length === 0) {
        await this.cerrar(org, id, 'NO_ACTION', 'no hay nada que convenga cambiar con la evidencia de esta ventana', { evidencia: 'SUFFICIENT' });
        return this.estado(org, modoOperativo);
      }

      // ── GOBERNAR y EJECUTAR ──
      const cambiosHoy = await this.repo.cambiosDesde(org, new Date(Date.parse(ahora) - 24 * 3_600_000).toISOString());
      let ejecutadas = 0; let pendientes = 0; let bloqueadas = 0; let registradas = 0;

      for (const [i, p] of propuestas.entries()) {
        const decision = await this.persistirDecision(org, id, p, `${id}-d${i + 1}`, ahora);
        const ultima = p.objetivo.id === null ? null : await this.repo.ultimaAccionSobre(org, p.accion, p.objetivo.id);
        const veredicto = gobernar(p, {
          modo, modoOperativo, politica: c.politicaAutonomia, mandato: c.mandato,
          capacidadEscritura: c.capacidadEscritura,
          gobiernoExternalMutations: c.gobierno.externalMutations,
          gobiernoCampaignExecution: c.gobierno.campaignExecution,
          killSwitchAbierto: mutacionesExternasHabilitadas(this.env),
          cambiosHoy,
          horasDesdeUltimoCambioDeLaPalanca: ultima === null ? null : horasEntre(ahora, ultima.aplicadoEn),
          horaLocal: new Date(ahora).getUTCHours(),
          ahora,
        });

        if (veredicto.veredicto === 'SOLO_REGISTRAR') { registradas += 1; continue; }
        if (veredicto.veredicto === 'BLOQUEAR') { bloqueadas += 1; continue; }
        if (veredicto.veredicto === 'PEDIR_APROBACION') {
          await this.encolar(org, id, decision, veredicto.motivo, ahora);
          pendientes += 1;
          continue;
        }
        const r = await this.ejecutarDecision(org, id, decision, cliente, c.customerId, c.campaignId, snapshot, ahora);
        if (r) ejecutadas += 1;
      }

      const estado: EstadoCiclo = ejecutadas > 0 ? 'VERIFIED' : pendientes > 0 ? 'WAITING_FOR_APPROVAL' : 'DECIDED';
      await this.cerrar(org, id, estado, null, { propuestas: propuestas.length, ejecutadas, pendientes, bloqueadas, registradas, modo });
      this.deps.log?.({ optimizacion: 'ciclo', org, id, modo, propuestas: propuestas.length, ejecutadas, pendientes, bloqueadas, registradas });
    } catch (e) {
      // AISLAMIENTO: el fallo se queda en este ciclo, con su motivo. Las demás empresas siguen su curso.
      await this.cerrar(org, id, 'FAILED', e instanceof Error ? e.message.slice(0, 200) : 'error inesperado');
      this.deps.log?.({ optimizacion: 'ciclo_fallido', org, id, error: e instanceof Error ? e.message : String(e) });
    }
    return this.estado(org, modoOperativo);
  }

  private topeDiario(m: Mandato | null, ahora: string): number | null {
    if (m === null) return null;
    const dias = Math.max(1, Math.ceil((Date.parse(m.periodEnd) - Date.parse(ahora)) / 86_400_000));
    return Math.floor(restanteMinor(m) / dias);
  }

  private async cambiosRecientes(org: string, campaignId: string, ahora: string): Promise<Record<string, { horas: number; deltaPct: number | null }>> {
    const salida: Record<string, { horas: number; deltaPct: number | null }> = {};
    for (const accion of ['ADJUST_DAILY_BUDGET', 'ADJUST_MAX_CPC'] as const) {
      const a = await this.repo.ultimaAccionSobre(org, accion, campaignId);
      if (a !== null) salida[accion] = { horas: horasEntre(ahora, a.aplicadoEn), deltaPct: (a.detalle.deltaPct as number | undefined) ?? null };
    }
    return salida;
  }

  private async persistirDecision(org: string, cicloId: string, p: Propuesta, id: string, ahora: string): Promise<DecisionOptimizacion> {
    const d: DecisionOptimizacion = { organizationId: org, id, cicloId, creadoEn: ahora, ...p };
    await enTransaccion(this.pool, async (tx) => { await this.repo.guardarDecision(tx, d); });
    return d;
  }

  private async encolar(org: string, cicloId: string, d: DecisionOptimizacion, motivo: string, ahora: string): Promise<void> {
    await enTransaccion(this.pool, async (tx) => {
      await this.repo.guardarPendiente(tx, {
        organizationId: org, id: `pend-${d.id}`, cicloId, decisionId: d.id, estado: 'PENDING',
        resueltoPor: null, resueltoEn: null, ajuste: null, nota: motivo,
        expiraEn: new Date(Date.parse(ahora) + 7 * 24 * 3_600_000).toISOString(), creadoEn: ahora,
      });
      await this.repo.actualizarCiclo(tx, org, cicloId, { estado: 'WAITING_FOR_APPROVAL' });
    });
  }

  /** Aplica una decisión ya gobernada: idempotencia, escritura, verificación y registro de aprendizaje. */
  private async ejecutarDecision(
    org: string, cicloId: string, d: DecisionOptimizacion, cliente: GoogleAdsMutateHttpClient,
    customerId: string, campaignId: string, snapshot: SnapshotObservacion | null, ahora: string,
  ): Promise<boolean> {
    const clave = claveIdempotencia(d, campaignId);
    const previa = await this.repo.accionPorClave(org, clave);
    const r = await aplicarDecision({
      decision: d, cliente, customerId, campaignId, yaAplicado: previa !== null,
      ...(this.deps.log ? { log: this.deps.log } : {}),
    });

    await enTransaccion(this.pool, async (tx) => {
      await this.repo.registrarAccionSiNueva(tx, {
        organizationId: org, id: `acc-${d.id}`, cicloId, decisionId: d.id, accion: d.accion,
        claveIdempotencia: clave, resultado: r.resultado, verificacion: r.verificacion,
        recursoExterno: r.recursoExterno, providerRequestId: r.providerRequestId,
        detalle: { ...r.detalle, escrituras: r.escrituras }, aplicadoEn: ahora,
      });
      if (r.resultado === 'APPLIED') {
        // APRENDIZAJE: se guarda el antes y cuándo se podrá juzgar. El después llega solo, más tarde.
        await this.repo.guardarAprendizaje(tx, {
          organizationId: org, id: `apr-${d.id}`, decisionId: d.id, accion: d.accion,
          efectoEsperado: d.efectoEsperado,
          metricasAntes: snapshot?.campania ?? { spend: null, impressions: null, clicks: null, ctr: null, cpc: null, conversions: null, conversionValue: null, cpa: null, cvr: null },
          metricasDespues: null, resultado: 'NOT_ENOUGH_TIME', nota: null,
          evaluableDesde: new Date(Date.parse(ahora) + DIAS_PARA_JUZGAR_EFECTO * 24 * 3_600_000).toISOString(),
          evaluadoEn: null,
        });
        await this.negocios.registrarAuditoria(tx, {
          organizationId: org, actor: 'optimizador', action: 'OPTIMIZATION_ACTION_APPLIED',
          changedFields: { accion: d.accion, objetivo: d.objetivo.nombre, de: d.estadoActual, a: d.estadoPropuesto, verificacion: r.verificacion },
        });
      }
    });
    return r.resultado === 'APPLIED';
  }

  private async cerrar(org: string, id: string, estado: EstadoCiclo, motivo: string | null, resumen: Record<string, unknown> = {}): Promise<void> {
    const ahora = this.ahora();
    await enTransaccion(this.pool, async (tx) => {
      await this.repo.actualizarCiclo(tx, org, id, { estado, motivo, resumen, completadoEn: ahora });
    });
  }

  // ── COLA DE APROBACIÓN ────────────────────────────────────────────────────────────────────────

  /** Aprueba una acción propuesta y la aplica. La persona autoriza ESTA acción, no una categoría. */
  async resolverPendiente(
    org: string, actor: string, id: string,
    entrada: { readonly decision: 'APROBAR' | 'RECHAZAR' | 'AJUSTAR'; readonly nota?: string; readonly ajuste?: Record<string, unknown> },
    modoOperativo: string | null,
  ): Promise<VistaOptimizacion> {
    if (esActorSistema(actor)) throw new OptimizacionInvalidaError('esta decisión la toma una persona');
    const p = await this.repo.pendiente(org, id);
    if (p === null) throw new OptimizacionNoEncontradaError('no existe esa acción pendiente');
    if (p.estado !== 'PENDING') throw new OptimizacionInvalidaError('esa acción ya fue resuelta');
    const d = await this.repo.decision(org, p.decisionId);
    if (d === null) throw new OptimizacionNoEncontradaError('no existe la decisión de esa acción');
    const ahora = this.ahora();

    if (entrada.decision === 'RECHAZAR') {
      await enTransaccion(this.pool, async (tx) => {
        await this.repo.guardarPendiente(tx, { ...p, estado: 'REJECTED', resueltoPor: actor, resueltoEn: ahora, nota: entrada.nota ?? null });
        await this.negocios.registrarAuditoria(tx, { organizationId: org, actor, action: 'OPTIMIZATION_ACTION_REJECTED', changedFields: { accion: d.accion, objetivo: d.objetivo.nombre } });
      });
      return this.estado(org, modoOperativo);
    }

    const c = await this.contexto(org, modoOperativo);
    // La aprobación vale para el mundo de AHORA: si algo cambió, no se ejecuta una decisión vieja.
    if (!mutacionesExternasHabilitadas(this.env)) throw new OptimizacionInvalidaError('las operaciones externas están apagadas en este despliegue');
    if (!c.capacidadEscritura) throw new OptimizacionInvalidaError('falta el permiso para modificar campañas en Conexiones');
    if (!c.gobierno.externalMutations) throw new OptimizacionInvalidaError('tu empresa tiene desactivadas las operaciones externas');
    if (c.campaignId === null || c.customerId === null) throw new OptimizacionInvalidaError('no hay campaña sobre la que actuar');
    if (d.impactoMaximoClp !== null && d.impactoMaximoClp > 0 && !this.mandatoVigente(c.mandato)) {
      throw new OptimizacionInvalidaError('no hay una autorización de presupuesto vigente para un cambio que compromete gasto');
    }
    const cliente = await this.deps.clienteGoogle?.(org);
    if (!cliente) throw new OptimizacionInvalidaError('no hay acceso de escritura a la cuenta de publicidad');

    const decisionFinal = entrada.decision === 'AJUSTAR' && entrada.ajuste?.estadoPropuesto
      ? { ...d, estadoPropuesto: String(entrada.ajuste.estadoPropuesto) }
      : d;

    const aplicada = await this.ejecutarDecision(org, p.cicloId, decisionFinal, cliente, c.customerId, c.campaignId, null, ahora);
    await enTransaccion(this.pool, async (tx) => {
      await this.repo.guardarPendiente(tx, {
        ...p, estado: aplicada ? 'APPLIED' : 'ADJUSTED', resueltoPor: actor, resueltoEn: ahora,
        ajuste: entrada.ajuste ?? null, nota: entrada.nota ?? null,
      });
      await this.negocios.registrarAuditoria(tx, {
        organizationId: org, actor, action: 'OPTIMIZATION_ACTION_APPROVED',
        changedFields: { accion: decisionFinal.accion, objetivo: decisionFinal.objetivo.nombre, aplicada },
      });
    });
    return this.estado(org, modoOperativo);
  }

  // ── ACTIVACIÓN DE CAMPAÑA ─────────────────────────────────────────────────────────────────────

  /**
   * Enciende una campaña creada en pausa. Es la única acción que convierte una configuración en gasto real, y
   * por eso tiene su propia puerta: ocho condiciones y, en modo supervisado, la firma de una persona.
   */
  async activarCampana(org: string, actor: string, modoOperativo: string | null): Promise<VistaOptimizacion> {
    const c = await this.contexto(org, modoOperativo);
    if (c.campaignId === null || c.customerId === null) throw new OptimizacionInvalidaError('no hay una campaña creada que encender');

    const requisitos = puedeActivarse({
      reconciliacionOk: c.peticion?.reconciliacion?.coincide === true,
      medicionVerificada: c.salud === 'HEALTHY',
      mandatoVigente: this.mandatoVigente(c.mandato),
      requisitosEjecucionOk: c.peticion?.estado === 'CREATED_PAUSED',
      conexionValida: c.conexionValida,
      capacidadEscritura: c.capacidadEscritura,
      gobiernoExternalMutations: c.gobierno.externalMutations,
      killSwitchAbierto: mutacionesExternasHabilitadas(this.env),
    });
    if (!requisitos.puede) throw new OptimizacionInvalidaError(`todavía no se puede encender: ${requisitos.faltan.join(' · ')}`);

    if (modoOperativo === 'AUTONOMOUS_REAL') {
      // En automático, encender exige un permiso EXPLÍCITO. El presupuesto no lo concede.
      if (!c.politicaAutonomia.activacionAutonomaPermitida) {
        throw new OptimizacionInvalidaError('el modo automático no puede encender campañas: actívalo explícitamente en tus límites de autonomía');
      }
    } else if (modoOperativo === 'SUPERVISED_REAL') {
      if (esActorSistema(actor)) throw new OptimizacionInvalidaError('encender la campaña exige la aprobación de una persona');
    } else {
      throw new OptimizacionInvalidaError('tu empresa está en modo observación: cámbialo antes de encender una campaña');
    }

    const cliente = await this.deps.clienteGoogle?.(org);
    if (!cliente) throw new OptimizacionInvalidaError('no hay acceso de escritura a la cuenta de publicidad');

    const ahora = this.ahora();
    const id = `ciclo-act-${randomUUID().slice(0, 8)}`;
    await enTransaccion(this.pool, async (tx) => {
      await this.repo.crearCiclo(tx, {
        organizationId: org, id, proveedor: 'GOOGLE_ADS', campaignId: c.campaignId, modo: modoOperativo === 'AUTONOMOUS_REAL' ? 'AUTONOMOUS' : 'SUPERVISED',
        estado: 'EXECUTING', ventana: ventanaDe(ahora, 1), snapshotId: null,
        politicaEvaluacionVersion: null, politicaAutonomiaVersion: c.politicaAutonomia.version,
        mandatoId: c.mandato?.id ?? null, mandatoVersion: c.mandato?.version ?? null, modoOperativo,
        resumen: { activacion: true }, motivo: null, iniciadoEn: ahora, completadoEn: null,
      });
    });

    const decision: DecisionOptimizacion = {
      organizationId: org, id: `${id}-d1`, cicloId: id, accion: 'ENABLE_CAMPAIGN',
      objetivo: { tipo: 'CAMPAIGN', id: c.campaignId, nombre: 'tu campaña' },
      estadoActual: 'PAUSED', estadoPropuesto: 'ENABLED',
      evidenciaRefs: [`peticion:${c.peticion?.id ?? ''}`], politicaRefs: [`autonomia:v${c.politicaAutonomia.version}`],
      efectoEsperado: 'empezar a mostrar los anuncios y a gastar el presupuesto autorizado',
      riesgo: 'HIGH_RISK', confianza: 'ALTA', reversible: true,
      motivo: `activación autorizada por ${actor}`,
      impactoMaximoClp: this.topeDiario(c.mandato, ahora),
      creadoEn: ahora,
    };
    await enTransaccion(this.pool, async (tx) => { await this.repo.guardarDecision(tx, decision); });
    const aplicada = await this.ejecutarDecision(org, id, decision, cliente, c.customerId, c.campaignId, null, ahora);
    await this.cerrar(org, id, aplicada ? 'VERIFIED' : 'FAILED', aplicada ? null : 'la plataforma no confirmó el encendido', { activacion: true });
    await enTransaccion(this.pool, async (tx) => {
      await this.negocios.registrarAuditoria(tx, {
        organizationId: org, actor, action: aplicada ? 'CAMPAIGN_ACTIVATED' : 'CAMPAIGN_ACTIVATION_FAILED',
        changedFields: { campaignId: c.campaignId, modoOperativo },
      });
    });
    return this.estado(org, modoOperativo);
  }

  // ── APRENDIZAJE ───────────────────────────────────────────────────────────────────────────────

  /** Cierra los registros de aprendizaje cuyo plazo venció, comparando el antes con lo observado ahora. */
  async evaluarAprendizajes(org: string, snapshotActual: SnapshotObservacion | null): Promise<number> {
    const ahora = this.ahora();
    const pendientes = await this.repo.aprendizajesPendientes(org, ahora);
    let cerrados = 0;
    for (const l of pendientes) {
      const despues = snapshotActual?.campania ?? null;
      const resultado = juzgarEfecto(l.metricasAntes, despues);
      await enTransaccion(this.pool, async (tx) => {
        await this.repo.guardarAprendizaje(tx, {
          ...l, metricasDespues: despues, resultado,
          nota: despues === null ? 'todavía no hay una observación posterior con la que comparar' : null,
          evaluadoEn: despues === null ? null : ahora,
        });
      });
      if (despues !== null) cerrados += 1;
    }
    return cerrados;
  }
}

function acotar(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(Number(v) || 0)));
}
