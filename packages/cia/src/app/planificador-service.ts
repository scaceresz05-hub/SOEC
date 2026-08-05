/**
 * @soec/cia · app · PLANIFICADOR DE ACCIONES EXTERNAS (ciclo de vida completo).
 *
 * Dado un objetivo y una capacidad AUTORIZADA, planifica una acción, elige el proveedor DETRÁS de la frontera,
 * respeta kill-switch, límite y nivel de autonomía, y —en preparación cerrada— sólo ejecuta SIMULADO por el
 * `OrquestadorAdaptadores` (composición M4). Gobierna el ciclo de vida del plan (PROPUESTO…COMPLETADO_SIMULADO)
 * distinguiendo acción lógica, intento técnico y proveedor. Idempotencia por `claveLogica`: mismo contenido
 * converge; contenido distinto = conflicto. Al ejecutar, revalida kill/límite (la pausa prevalece) y descarta
 * respuestas tardías si el plan fue cancelado u obsoleto entretanto. Nunca actúa en REAL.
 */
import { ConcurrencyError, type Attribution, type EventInput, type EventStore, type RequestContext } from '@soec/contracts';
import { buscarCapacidad } from '../dominio/catalogo';
import {
  EVENTOS_PLAN, planStreamId, reconstruirPlan, decidirPlan, elegirProveedor, huellaContenido, esPlanTerminal,
  type Decision, type PlanState,
} from '../dominio/plan';
import { estaBloqueada } from '../dominio/kill-switch';
import { assertSimulado, type ModoEjecucion } from '../dominio/guardarrailes';
import { CapacidadDesconocidaError, ComandoCiaInvalidoError, ConflictoIdempotenciaError } from '../dominio/errors';
import { AutorizacionesService } from './autorizaciones-service';
import { KillSwitchService } from './kill-switch-service';
import { EjecutorCapacidadCIA } from './ejecutor-capacidad-service';
import { PresupuestoService } from './presupuesto-service';

const EVENTOS_PLAN_INDICE = { registrada: 'cia-plan-indice.registrada' } as const;
function planIndiceStreamId(org: string): string { return `cia-plan-indice:${org}`; }
const EVENTOS_CLAVE = { registrada: 'cia-plan-clave.registrada' } as const;
function claveIndiceStreamId(org: string): string { return `cia-plan-clave:${org}`; }

export interface ResultadoPlan { readonly plan: PlanState; readonly decision: Decision }

export class PlanificadorService {
  constructor(
    private readonly store: EventStore,
    private readonly autorizaciones: AutorizacionesService,
    private readonly kill: KillSwitchService,
    private readonly ejecutor: EjecutorCapacidadCIA = new EjecutorCapacidadCIA(),
    private readonly presupuesto: PresupuestoService = new PresupuestoService(store, autorizaciones),
  ) {}

  private org(ctx: RequestContext): string { return String(ctx.organizationId); }

  cargar(ctx: RequestContext, planId: string): Promise<PlanState> {
    const org = this.org(ctx);
    return this.store.readStream(ctx, planStreamId(org, planId)).then((e) => reconstruirPlan(org, planId, e));
  }

  private async append(ctx: RequestContext, planId: string, type: string, payload: unknown, a: Attribution, o: string): Promise<void> {
    const st = await this.cargar(ctx, planId);
    const input: EventInput = { type, payload, attribution: a, occurredAt: o };
    try { await this.store.append(ctx, planStreamId(this.org(ctx), planId), st.version, [input]); }
    catch (e) { if (!(e instanceof ConcurrencyError)) throw e; }
  }

  async planificar(
    ctx: RequestContext,
    planId: string,
    entrada: { capacidadId: string; objetivo: string; costoEstimado: number; proveedorOverride?: string; modo?: ModoEjecucion; claveLogica?: string },
    a: Attribution,
    o: string,
  ): Promise<ResultadoPlan> {
    const modo: ModoEjecucion = entrada.modo ?? 'SIMULADO';
    assertSimulado(modo);
    if (!planId?.trim()) throw new ComandoCiaInvalidoError('planId es obligatorio.');
    const cap = buscarCapacidad(entrada.capacidadId);
    if (!cap) throw new CapacidadDesconocidaError(`Capacidad de marketing desconocida: ${entrada.capacidadId}`);

    const claveLogica = entrada.claveLogica ?? planId;
    const huella = huellaContenido(cap.id, entrada.objetivo, entrada.costoEstimado);

    // Idempotencia lógica: misma clave + mismo contenido converge; contenido distinto = conflicto.
    const existentePorClave = await this.buscarPorClave(ctx, claveLogica);
    if (existentePorClave && existentePorClave !== planId) {
      const otro = await this.cargar(ctx, existentePorClave);
      if (otro.huella === huella) { const decision = decidirPlan(await this.autorizaciones.cargar(ctx, cap.id), await this.kill.cargar(ctx), cap, entrada.costoEstimado); return { plan: otro, decision }; }
      throw new ConflictoIdempotenciaError(`la clave lógica "${claveLogica}" ya existe con otro contenido`);
    }

    const auth = await this.autorizaciones.cargar(ctx, entrada.capacidadId);
    const killSt = await this.kill.cargar(ctx);
    const decision = decidirPlan(auth, killSt, cap, entrada.costoEstimado);

    const existente = await this.cargar(ctx, planId);
    if (existente.existe && existente.huella !== huella) throw new ConflictoIdempotenciaError(`el plan "${planId}" ya existe con otro contenido`);

    if (!decision.permitido) {
      if (existente.existe && !esPlanTerminal(existente.estado)) await this.append(ctx, planId, EVENTOS_PLAN.cancelado, {}, a, o);
      return { plan: await this.cargar(ctx, planId), decision };
    }

    const proveedorElegidoRef = elegirProveedor(cap, entrada.proveedorOverride);
    if (!existente.existe) {
      await this.append(ctx, planId, EVENTOS_PLAN.propuesta, {
        capacidadId: cap.id, objetivo: entrada.objetivo, costoEstimado: entrada.costoEstimado,
        requiereAprobacion: decision.requiereAprobacion, proveedorElegidoRef, claveLogica, huella,
      }, a, o);
      await this.asegurarEnIndice(ctx, planId, a, o);
      await this.registrarClave(ctx, claveLogica, planId, a, o);
      if (decision.requiereAprobacion) await this.append(ctx, planId, EVENTOS_PLAN.aprobacionRequerida, {}, a, o);
      else await this.append(ctx, planId, EVENTOS_PLAN.autorizado, { aprobadoPor: null }, a, o);
    }

    if (decision.ejecutableAuto) await this.ejecutarSimulado(ctx, planId, a, o);
    return { plan: await this.cargar(ctx, planId), decision };
  }

  /** Acto HUMANO: aprueba un plan pendiente en la bandeja → autoriza y ejecuta simulado. */
  async aprobar(ctx: RequestContext, planId: string, actorHumano: string, a: Attribution, o: string): Promise<PlanState> {
    if (!actorHumano?.trim()) throw new ComandoCiaInvalidoError('Aprobar un plan exige un actor humano.');
    const st = await this.cargar(ctx, planId);
    if (st.estado === 'PENDIENTE_APROBACION') await this.append(ctx, planId, EVENTOS_PLAN.autorizado, { aprobadoPor: actorHumano }, a, o);
    return this.ejecutarSimulado(ctx, planId, a, o);
  }

  async rechazar(ctx: RequestContext, planId: string, a: Attribution, o: string): Promise<PlanState> { return this.cancelar(ctx, planId, a, o); }

  async cancelar(ctx: RequestContext, planId: string, a: Attribution, o: string): Promise<PlanState> {
    const st = await this.cargar(ctx, planId);
    if (st.existe && !esPlanTerminal(st.estado)) await this.append(ctx, planId, EVENTOS_PLAN.cancelado, {}, a, o);
    return this.cargar(ctx, planId);
  }

  async obsoletar(ctx: RequestContext, planId: string, a: Attribution, o: string): Promise<PlanState> {
    const st = await this.cargar(ctx, planId);
    if (st.existe && !esPlanTerminal(st.estado)) await this.append(ctx, planId, EVENTOS_PLAN.obsoleto, {}, a, o);
    return this.cargar(ctx, planId);
  }

  /**
   * Ejecución SIMULADA por el orquestador M4. Revalida la frontera (kill/autorización/límite) al ejecutar —
   * la pausa prevalece sobre un plan ya formado— y descarta respuestas tardías si el plan quedó terminal.
   * Idempotente en el resultado.
   */
  private async ejecutarSimulado(ctx: RequestContext, planId: string, a: Attribution, o: string): Promise<PlanState> {
    assertSimulado('SIMULADO');
    const st = await this.cargar(ctx, planId);
    if (!st.existe) throw new ComandoCiaInvalidoError(`Plan inexistente: ${planId}`);
    if (esPlanTerminal(st.estado)) return st; // idempotente / cancelado / obsoleto
    if (st.estado !== 'AUTORIZADO') return st; // aún requiere aprobación

    const cap = buscarCapacidad(st.capacidadId);
    if (!cap) throw new CapacidadDesconocidaError(`Capacidad desconocida: ${st.capacidadId}`);
    const auth = await this.autorizaciones.cargar(ctx, st.capacidadId);
    const killSt = await this.kill.cargar(ctx);
    if (estaBloqueada(killSt, cap.id) || auth.estado !== 'AUTORIZADA') { await this.append(ctx, planId, EVENTOS_PLAN.cancelado, {}, a, o); return this.cargar(ctx, planId); }

    // Presupuesto: estimar → validar → RESERVAR (bloquea disponibilidad; captura reservas concurrentes).
    const conGasto = cap.unidadLimite !== 'SIN_GASTO' && st.costoEstimado > 0;
    if (conGasto) {
      const reservado = await this.presupuesto.reservar(ctx, planId, cap.id, st.costoEstimado, a, o);
      if (!reservado) { await this.append(ctx, planId, EVENTOS_PLAN.cancelado, {}, a, o); return this.cargar(ctx, planId); }
    }

    await this.append(ctx, planId, EVENTOS_PLAN.programado, {}, a, o);
    await this.append(ctx, planId, EVENTOS_PLAN.enEjecucion, {}, a, o);

    const res = await this.ejecutor.ejecutar(ctx, {
      capacidadTipoPCE: cap.capacidadTipoPCE, proveedorElegidoRef: st.proveedorElegidoRef ?? elegirProveedor(cap),
      operacion: 'ejecutar', instante: o,
    });

    // Cancelación/obsolescencia tardía: si el plan dejó de estar EN_EJECUCION, liberar la reserva y descartar.
    const actual = await this.cargar(ctx, planId);
    if (actual.estado !== 'EN_EJECUCION') { if (conGasto) await this.presupuesto.liberar(ctx, planId, a, o); return actual; }

    if (!res.ejecutado) {
      if (conGasto) await this.presupuesto.liberar(ctx, planId, a, o); // no se ejecutó → libera el presupuesto
      await this.append(ctx, planId, EVENTOS_PLAN.abstenido, { evidenciaSimulada: res.mensajeProducto }, a, o);
      return this.cargar(ctx, planId);
    }
    if (conGasto) { // ejecutó → CONFIRMAR consumo
      await this.presupuesto.confirmar(ctx, planId, a, o);
      await this.autorizaciones.registrarConsumoSimulado(ctx, cap.id, st.costoEstimado, a, o);
    }
    await this.append(ctx, planId, EVENTOS_PLAN.completadoSimulado, { evidenciaSimulada: res.mensajeProducto }, a, o);
    return this.cargar(ctx, planId);
  }

  async listarPlanes(ctx: RequestContext): Promise<readonly string[]> {
    const eventos = await this.store.readStream(ctx, planIndiceStreamId(this.org(ctx)));
    const set = new Set<string>();
    for (const e of eventos) if (e.type === EVENTOS_PLAN_INDICE.registrada) set.add((e.payload as { planId: string }).planId);
    return [...set];
  }

  private async buscarPorClave(ctx: RequestContext, claveLogica: string): Promise<string | null> {
    const eventos = await this.store.readStream(ctx, claveIndiceStreamId(this.org(ctx)));
    for (const e of eventos) { const p = e.payload as { claveLogica: string; planId: string }; if (e.type === EVENTOS_CLAVE.registrada && p.claveLogica === claveLogica) return p.planId; }
    return null;
  }

  private async registrarClave(ctx: RequestContext, claveLogica: string, planId: string, a: Attribution, o: string): Promise<void> {
    const org = this.org(ctx);
    const eventos = await this.store.readStream(ctx, claveIndiceStreamId(org));
    if (eventos.some((e) => e.type === EVENTOS_CLAVE.registrada && (e.payload as { claveLogica: string }).claveLogica === claveLogica)) return;
    const input: EventInput = { type: EVENTOS_CLAVE.registrada, payload: { claveLogica, planId }, attribution: a, occurredAt: o };
    try { await this.store.append(ctx, claveIndiceStreamId(org), eventos.length, [input]); }
    catch (e) { if (!(e instanceof ConcurrencyError)) throw e; }
  }

  private async asegurarEnIndice(ctx: RequestContext, planId: string, a: Attribution, o: string): Promise<void> {
    const org = this.org(ctx);
    const eventos = await this.store.readStream(ctx, planIndiceStreamId(org));
    if (eventos.some((e) => e.type === EVENTOS_PLAN_INDICE.registrada && (e.payload as { planId: string }).planId === planId)) return;
    const input: EventInput = { type: EVENTOS_PLAN_INDICE.registrada, payload: { planId }, attribution: a, occurredAt: o };
    try { await this.store.append(ctx, planIndiceStreamId(org), eventos.length, [input]); }
    catch (e) { if (!(e instanceof ConcurrencyError)) throw e; }
  }
}
