/**
 * @soec/cia · app · PLANIFICADOR DE ACCIONES EXTERNAS.
 *
 * Dado un objetivo y una capacidad AUTORIZADA, planifica una acción: elige el proveedor DETRÁS de la frontera,
 * respeta kill-switch, límite y nivel de autonomía, y —en preparación cerrada— sólo ejecuta de forma SIMULADA.
 * Nunca red, SDK, gasto ni efecto real (`assertSimulado`). Si el nivel exige aprobación o excede el límite, el
 * plan queda PENDIENTE en la bandeja; si el nivel es automático y hay margen, se ejecuta simulado al instante.
 * Al ejecutar, revalida kill-switch y límite (la pausa prevalece sobre un plan ya formado).
 */
import { ConcurrencyError, type Attribution, type EventInput, type EventStore, type RequestContext } from '@soec/contracts';
import { buscarCapacidad } from '../dominio/catalogo';
import {
  EVENTOS_PLAN, planStreamId, reconstruirPlan, decidirPlan, elegirProveedor, simularProveedor,
  type Decision, type PlanState,
} from '../dominio/plan';
import { estaBloqueada } from '../dominio/kill-switch';
import { disponibleSimulado } from '../dominio/autorizacion';
import { assertSimulado, type ModoEjecucion } from '../dominio/guardarrailes';
import { CapacidadDesconocidaError, ComandoCiaInvalidoError } from '../dominio/errors';
import { AutorizacionesService } from './autorizaciones-service';
import { KillSwitchService } from './kill-switch-service';

const EVENTOS_PLAN_INDICE = { registrada: 'cia-plan-indice.registrada' } as const;
function planIndiceStreamId(org: string): string { return `cia-plan-indice:${org}`; }

export interface ResultadoPlan { readonly plan: PlanState; readonly decision: Decision }

export class PlanificadorService {
  constructor(
    private readonly store: EventStore,
    private readonly autorizaciones: AutorizacionesService,
    private readonly kill: KillSwitchService,
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

  /**
   * Planifica una acción para una capacidad autorizada. `modo` por defecto SIMULADO; REAL está bloqueado.
   * `proveedorOverride` permite forzar un candidato (sustitución de proveedor) sin cambiar la experiencia.
   */
  async planificar(
    ctx: RequestContext,
    planId: string,
    entrada: { capacidadId: string; objetivo: string; costoEstimado: number; proveedorOverride?: string; modo?: ModoEjecucion },
    a: Attribution,
    o: string,
  ): Promise<ResultadoPlan> {
    const modo: ModoEjecucion = entrada.modo ?? 'SIMULADO';
    assertSimulado(modo);
    if (!planId?.trim()) throw new ComandoCiaInvalidoError('planId es obligatorio.');
    const cap = buscarCapacidad(entrada.capacidadId);
    if (!cap) throw new CapacidadDesconocidaError(`Capacidad de marketing desconocida: ${entrada.capacidadId}`);

    const auth = await this.autorizaciones.cargar(ctx, entrada.capacidadId);
    const killSt = await this.kill.cargar(ctx);
    const decision = decidirPlan(auth, killSt, cap, entrada.costoEstimado);

    const existente = await this.cargar(ctx, planId);
    if (!decision.permitido) {
      if (existente.existe && existente.estado === 'PLANIFICADA') await this.append(ctx, planId, EVENTOS_PLAN.rechazada, {}, a, o);
      return { plan: await this.cargar(ctx, planId), decision };
    }

    const proveedorElegidoRef = elegirProveedor(cap, entrada.proveedorOverride);
    if (!existente.existe) {
      await this.append(ctx, planId, EVENTOS_PLAN.planificada, {
        capacidadId: cap.id, objetivo: entrada.objetivo, costoEstimado: entrada.costoEstimado,
        requiereAprobacion: decision.requiereAprobacion, proveedorElegidoRef,
      }, a, o);
      await this.asegurarEnIndice(ctx, planId, a, o);
    }

    // Nivel automático con margen: ejecuta simulado de inmediato (revalidando la frontera al ejecutar).
    if (decision.ejecutableAuto) await this.ejecutarSimulado(ctx, planId, a, o);
    return { plan: await this.cargar(ctx, planId), decision };
  }

  /** Lista los ids de plan de la organización (para las vistas de HOME/Decisiones). */
  async listarPlanes(ctx: RequestContext): Promise<readonly string[]> {
    const eventos = await this.store.readStream(ctx, planIndiceStreamId(this.org(ctx)));
    const set = new Set<string>();
    for (const e of eventos) if (e.type === EVENTOS_PLAN_INDICE.registrada) set.add((e.payload as { planId: string }).planId);
    return [...set];
  }

  private async asegurarEnIndice(ctx: RequestContext, planId: string, a: Attribution, o: string): Promise<void> {
    const org = this.org(ctx);
    const eventos = await this.store.readStream(ctx, planIndiceStreamId(org));
    const ya = eventos.some((e) => e.type === EVENTOS_PLAN_INDICE.registrada && (e.payload as { planId: string }).planId === planId);
    if (ya) return;
    const input: EventInput = { type: EVENTOS_PLAN_INDICE.registrada, payload: { planId }, attribution: a, occurredAt: o };
    try { await this.store.append(ctx, planIndiceStreamId(org), eventos.length, [input]); }
    catch (e) { if (!(e instanceof ConcurrencyError)) throw e; }
  }

  /** Acto HUMANO: aprueba un plan pendiente en la bandeja → ejecución simulada. */
  async aprobar(ctx: RequestContext, planId: string, actorHumano: string, a: Attribution, o: string): Promise<PlanState> {
    if (!actorHumano?.trim()) throw new ComandoCiaInvalidoError('Aprobar un plan exige un actor humano.');
    return this.ejecutarSimulado(ctx, planId, a, o);
  }

  async rechazar(ctx: RequestContext, planId: string, a: Attribution, o: string): Promise<PlanState> {
    const st = await this.cargar(ctx, planId);
    if (st.existe && st.estado === 'PLANIFICADA') await this.append(ctx, planId, EVENTOS_PLAN.rechazada, {}, a, o);
    return this.cargar(ctx, planId);
  }

  /**
   * Ejecución SIMULADA con revalidación de frontera: la pausa (kill) prevalece sobre un plan ya formado, y el
   * límite se revalida al momento de ejecutar. Idempotente: si ya está ejecutada, no duplica.
   */
  private async ejecutarSimulado(ctx: RequestContext, planId: string, a: Attribution, o: string): Promise<PlanState> {
    assertSimulado('SIMULADO');
    const st = await this.cargar(ctx, planId);
    if (!st.existe) throw new ComandoCiaInvalidoError(`Plan inexistente: ${planId}`);
    if (st.estado === 'EJECUTADA_SIMULADA') return st;
    if (st.estado === 'RECHAZADA') return st;

    const cap = buscarCapacidad(st.capacidadId);
    if (!cap) throw new CapacidadDesconocidaError(`Capacidad desconocida: ${st.capacidadId}`);
    const auth = await this.autorizaciones.cargar(ctx, st.capacidadId);
    const killSt = await this.kill.cargar(ctx);

    // Revalidación al ejecutar: kill prevalece; sin autorización o sin margen no se ejecuta.
    const bloqueada = estaBloqueada(killSt, cap.id) || auth.estado !== 'AUTORIZADA';
    const sinMargen = cap.unidadLimite !== 'SIN_GASTO' && st.costoEstimado > disponibleSimulado(auth);
    if (bloqueada || sinMargen) {
      await this.append(ctx, planId, EVENTOS_PLAN.rechazada, {}, a, o);
      return this.cargar(ctx, planId);
    }

    const evidencia = simularProveedor(st.proveedorElegidoRef ?? elegirProveedor(cap), cap, st.costoEstimado);
    await this.append(ctx, planId, EVENTOS_PLAN.ejecutadaSimulada, { evidenciaSimulada: evidencia }, a, o);
    if (cap.unidadLimite !== 'SIN_GASTO' && st.costoEstimado > 0) {
      await this.autorizaciones.registrarConsumoSimulado(ctx, cap.id, st.costoEstimado, a, o);
    }
    return this.cargar(ctx, planId);
  }
}
