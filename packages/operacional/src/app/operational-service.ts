/**
 * Coordinador operativo (ADR-0009): ejecuta una acción de marketing SOLO si una
 * política vigente la autoriza. Flujo: solicitar → autorizar/denegar → ejecutar
 * (adaptador simulado) → verificar → registrar/auditar. Idempotente. Ningún efecto
 * externo real: el adaptador es simulado (Efecto.simulado === true, garantizado por tipo).
 */
import type { Attribution, EventInput, EventStore, RequestContext } from '@soec/contracts';
import {
  type AccionPropuesta,
  type AccionState,
  type Decision,
  EVENTOS_ACC,
  accStreamId,
  reconstruirAccion,
} from '../domain/action';
import { evaluarAutorizacion } from '../domain/authorization';
import type { CanalAdapter } from '../domain/channel';
import { AdaptadorNoDisponibleError, AccionNoEncontradaError, SolicitudOperativaInvalidaError } from '../domain/errors';
import { PolicyService } from './policy-service';

export interface EjecutarAccionCmd {
  readonly executionId: string;
  readonly policyId: string;
  readonly accion: AccionPropuesta;
  readonly attribution: Attribution;
  readonly occurredAt: string;
  readonly idempotencyKey?: string;
}

export interface ResultadoAccion {
  readonly state: AccionState;
  readonly decision: Decision;
  readonly ejecutada: boolean;
}

function idxStreamId(policyId: string): string {
  return `polidx:${policyId}`;
}

export class OperationalService {
  private readonly policies: PolicyService;

  constructor(
    private readonly store: EventStore,
    private readonly adapters: readonly CanalAdapter[],
  ) {
    this.policies = new PolicyService(store);
  }

  private cargarAccion(ctx: RequestContext, executionId: string): Promise<AccionState> {
    return this.store.readStream(ctx, accStreamId(executionId)).then((e) => reconstruirAccion(executionId, ctx.organizationId, e));
  }

  /** Presupuesto ya consumido por acciones ejecutadas bajo la política (excluye la actual). */
  private async presupuestoConsumido(ctx: RequestContext, policyId: string, exceptoExecutionId: string): Promise<number> {
    const idx = await this.store.readStream(ctx, idxStreamId(policyId));
    return idx
      .map((e) => e.payload as { executionId: string; costo: number })
      .filter((p) => p.executionId !== exceptoExecutionId)
      .reduce((sum, p) => sum + (p.costo ?? 0), 0);
  }

  private seleccionar(canal: string): CanalAdapter {
    const a = this.adapters.find((x) => x.soporta(canal));
    if (!a) throw new AdaptadorNoDisponibleError(`No hay adaptador para el canal '${canal}'`);
    return a;
  }

  private input(type: string, payload: unknown, c: EjecutarAccionCmd, suf?: string): EventInput {
    const base: EventInput = { type, payload, attribution: c.attribution, occurredAt: c.occurredAt };
    return c.idempotencyKey ? { ...base, idempotencyKey: `${c.idempotencyKey}:${suf ?? type}` } : base;
  }

  async ejecutar(ctx: RequestContext, c: EjecutarAccionCmd): Promise<ResultadoAccion> {
    if (!c.accion?.tipo || !c.accion?.canal) throw new SolicitudOperativaInvalidaError('La acción exige tipo y canal');

    const previo = await this.cargarAccion(ctx, c.executionId);
    if (previo.existe && previo.decision) {
      // Idempotencia por identidad de ejecución: no re-ejecuta ni re-autoriza.
      return { state: previo, decision: previo.decision, ejecutada: previo.estado === 'verificada' || previo.estado === 'ejecutada' };
    }

    const policy = await this.policies.cargar(ctx, c.policyId);
    const consumido = await this.presupuestoConsumido(ctx, c.policyId, c.executionId);
    const decision = evaluarAutorizacion(policy, c.accion, consumido);

    const sid = accStreamId(c.executionId);
    let version = previo.version;
    const r0 = await this.store.append(ctx, sid, version, [
      this.input(EVENTOS_ACC.solicitada, { accion: c.accion, policyId: c.policyId, policyVersion: decision.policyVersion, decision }, c, 'sol'),
    ]);
    version = r0.version;

    if (!decision.permitida) {
      await this.store.append(ctx, sid, version, [this.input(EVENTOS_ACC.denegada, { motivo: decision.motivo }, c, 'den')]);
      const state = await this.cargarAccion(ctx, c.executionId);
      return { state, decision, ejecutada: false };
    }

    // Autorizada → ejecuta el efecto SIMULADO.
    const rAuth = await this.store.append(ctx, sid, version, [this.input(EVENTOS_ACC.autorizada, {}, c, 'aut')]);
    version = rAuth.version;

    const adapter = this.seleccionar(c.accion.canal);
    const efecto = await adapter.publicar(c.accion, c.idempotencyKey ?? c.executionId);

    const rEjec = await this.store.append(ctx, sid, version, [
      this.input(EVENTOS_ACC.ejecutada, { efecto, costoConsumido: c.accion.costo, mecanismo: adapter.nombre }, c, 'eje'),
    ]);
    version = rEjec.version;
    await this.store.append(ctx, sid, version, [this.input(EVENTOS_ACC.verificada, { verificado: efecto.ok }, c, 'ver')]);

    // Índice de presupuesto de la política (append-only).
    const idx = await this.store.readStream(ctx, idxStreamId(c.policyId));
    await this.store.append(ctx, idxStreamId(c.policyId), idx.length, [
      { type: 'polidx.consumo', payload: { executionId: c.executionId, costo: c.accion.costo }, attribution: c.attribution, occurredAt: c.occurredAt },
    ]);

    const state = await this.cargarAccion(ctx, c.executionId);
    return { state, decision, ejecutada: true };
  }

  /** Revierte una acción ejecutada (donde sea posible; simulado). */
  async revertir(ctx: RequestContext, executionId: string, motivo: string, attribution: Attribution, occurredAt: string): Promise<AccionState> {
    const state = await this.cargarAccion(ctx, executionId);
    if (!state.existe) throw new AccionNoEncontradaError(`La acción '${executionId}' no existe`);
    if (state.efecto && !state.revertida) {
      const adapter = this.seleccionar(state.accion?.canal ?? '');
      await adapter.revertir(state.efecto.externalId);
      await this.store.append(ctx, accStreamId(executionId), state.version, [
        { type: EVENTOS_ACC.revertida, payload: { motivo }, attribution, occurredAt },
      ]);
    }
    return this.cargarAccion(ctx, executionId);
  }

  accion(ctx: RequestContext, executionId: string): Promise<AccionState> {
    return this.cargarAccion(ctx, executionId);
  }
}
