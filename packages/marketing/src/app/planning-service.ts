/**
 * Servicio de planificación autónoma (F2-MKT-01). Genera y replanifica planes
 * versionados, y ejecuta la próxima acción SIEMPRE a través del plano operacional
 * existente (autorización + adaptador simulado). El planificador no publica, no
 * accede a adaptadores, no salta autorización ni crea efectos.
 */
import type { Attribution, EventInput, EventStore, RequestContext } from '@soec/contracts';
import { PolicyService, versionVigente, type OperationalService, type AccionPropuesta } from '@soec/operacional';
import { type PlanState, EVENTOS_PLAN, planStreamId, reconstruirPlan, siguienteActividad } from '../domain/plan';
import { planificar, type PlanificarOpts } from '../domain/planner';
import { ObjectiveService } from './objective-service';
import {
  ComandoMarketingInvalidoError,
  ObjetivoNoEncontradoError,
  ObjetivoNoEvaluableError,
  PlanNoEncontradoError,
  SinAccionDisponibleError,
} from '../domain/errors';

export interface GenerarPlanCmd {
  readonly planId: string;
  readonly objetivoId: string;
  readonly policyId: string;
  readonly fechaInicio: string;
  readonly opts?: Omit<PlanificarOpts, 'fechaInicio'>;
  readonly attribution: Attribution;
  readonly occurredAt: string;
  readonly idempotencyKey?: string;
}

export class PlanningService {
  private readonly objetivos: ObjectiveService;
  private readonly policies: PolicyService;

  constructor(
    private readonly store: EventStore,
    private readonly operational: OperationalService,
  ) {
    this.objetivos = new ObjectiveService(store);
    this.policies = new PolicyService(store);
  }

  cargar(ctx: RequestContext, planId: string): Promise<PlanState> {
    return this.store.readStream(ctx, planStreamId(planId)).then((e) => reconstruirPlan(planId, ctx.organizationId, e));
  }

  private input(type: string, payload: unknown, attribution: Attribution, occurredAt: string, idem?: string): EventInput {
    const base: EventInput = { type, payload, attribution, occurredAt };
    return idem ? { ...base, idempotencyKey: idem } : base;
  }

  private async construir(ctx: RequestContext, objetivoId: string, policyId: string, fechaInicio: string, opts: Omit<PlanificarOpts, 'fechaInicio'> | undefined, planVersion: number, motivo: string) {
    const objetivo = await this.objetivos.cargar(ctx, objetivoId);
    if (!objetivo.existe || !objetivo.contenido) throw new ObjetivoNoEncontradoError(`El objetivo '${objetivoId}' no existe`);
    if (!objetivo.evaluable) throw new ObjetivoNoEvaluableError(`El objetivo no es evaluable; faltan: ${objetivo.faltantes.join(', ')}`);
    const politica = await this.policies.cargar(ctx, policyId);
    const version = versionVigente(politica);
    if (!version) throw new ComandoMarketingInvalidoError(`No hay política vigente '${policyId}'`);
    const contenido = planificar(objetivo.contenido, version, { fechaInicio, ...opts }, planVersion, motivo);
    return { ...contenido, objetivoRef: objetivoId, policyId };
  }

  async generarPlan(ctx: RequestContext, c: GenerarPlanCmd): Promise<PlanState> {
    const previo = await this.cargar(ctx, c.planId);
    if (previo.existe) return previo; // idempotente por identidad de plan
    const contenido = await this.construir(ctx, c.objetivoId, c.policyId, c.fechaInicio, c.opts, 1, 'generación inicial');
    await this.store.append(ctx, planStreamId(c.planId), previo.version, [
      this.input(EVENTOS_PLAN.generado, { contenido }, c.attribution, c.occurredAt, c.idempotencyKey),
    ]);
    return this.cargar(ctx, c.planId);
  }

  async replanificar(
    ctx: RequestContext,
    c: { planId: string; motivo: string; evidencia: string; fechaInicio?: string; opts?: Omit<PlanificarOpts, 'fechaInicio'>; attribution: Attribution; occurredAt: string },
  ): Promise<PlanState> {
    const plan = await this.cargar(ctx, c.planId);
    if (!plan.existe) throw new PlanNoEncontradoError(`El plan '${c.planId}' no existe`);
    const fecha = c.fechaInicio ?? plan.calendario?.desde ?? c.occurredAt;
    const contenido = await this.construir(ctx, plan.objetivoRef, plan.policyId, fecha, c.opts, plan.planVersion + 1, c.motivo);
    const diferencias = {
      actividadesAntes: Object.keys(plan.actividades).length,
      actividadesDespues: contenido.actividades.length,
      versionAntes: plan.planVersion,
    };
    await this.store.append(ctx, planStreamId(c.planId), plan.version, [
      this.input(EVENTOS_PLAN.replanificado, { contenido, motivo: c.motivo, evidencia: c.evidencia, diferencias }, c.attribution, c.occurredAt),
    ]);
    return this.cargar(ctx, c.planId);
  }

  async pausar(ctx: RequestContext, planId: string, motivo: string, attribution: Attribution, occurredAt: string): Promise<PlanState> {
    const plan = await this.cargar(ctx, planId);
    if (!plan.existe) throw new PlanNoEncontradoError(`El plan '${planId}' no existe`);
    await this.store.append(ctx, planStreamId(planId), plan.version, [this.input(EVENTOS_PLAN.pausado, { motivo }, attribution, occurredAt)]);
    return this.cargar(ctx, planId);
  }
  async reanudar(ctx: RequestContext, planId: string, attribution: Attribution, occurredAt: string): Promise<PlanState> {
    const plan = await this.cargar(ctx, planId);
    if (!plan.existe) throw new PlanNoEncontradoError(`El plan '${planId}' no existe`);
    await this.store.append(ctx, planStreamId(planId), plan.version, [this.input(EVENTOS_PLAN.reanudado, {}, attribution, occurredAt)]);
    return this.cargar(ctx, planId);
  }

  siguiente(ctx: RequestContext, planId: string) {
    return this.cargar(ctx, planId).then((p) => siguienteActividad(p));
  }

  /** Ejecuta la próxima acción del plan a través del plano operacional (autorización + simulado). */
  async ejecutarSiguiente(ctx: RequestContext, planId: string, attribution: Attribution, occurredAt: string) {
    const plan = await this.cargar(ctx, planId);
    if (!plan.existe) throw new PlanNoEncontradoError(`El plan '${planId}' no existe`);
    if (plan.estado === 'pausado') throw new ComandoMarketingInvalidoError('El plan está pausado');
    const actividad = siguienteActividad(plan);
    if (!actividad) throw new SinAccionDisponibleError(`El plan '${planId}' no tiene acciones ejecutables`);

    const accion: AccionPropuesta = {
      tipo: actividad.tipo,
      canal: actividad.canal,
      contenido: actividad.contenido,
      costo: actividad.costo,
      productoIntelectualRef: `plan:${planId}#${actividad.id}`,
    };
    const execId = `${planId}:${actividad.id}`;
    const r = await this.operational.ejecutar(ctx, { executionId: execId, policyId: plan.policyId, accion, attribution, occurredAt });

    const nuevoEstado = r.decision.permitida ? 'verificada' : 'omitida';
    const resultado = r.decision.permitida ? 'ejecutada (efecto simulado)' : `denegada: ${r.decision.motivo}`;
    await this.store.append(ctx, planStreamId(planId), plan.version, [
      this.input(EVENTOS_PLAN.actividadEjecutada, { actividadId: actividad.id, accionExecutionId: execId, permitida: r.decision.permitida, resultado, nuevoEstado }, attribution, occurredAt),
    ]);
    return { actividad: actividad.id, permitida: r.decision.permitida, motivo: r.decision.motivo, resultado, plan: await this.cargar(ctx, planId) };
  }
}
