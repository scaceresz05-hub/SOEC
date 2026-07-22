/**
 * Servicio de optimización (F2-MET-01 §16, §19, §25). Traduce la evaluación en una
 * decisión, la AUTORIZA (política de optimización + motor de autorización operacional)
 * y, si procede, la aplica como un cambio VERSIONADO del plan por el contrato público
 * de marketing. No se autoautoriza, no publica, no gasta, no aumenta su autonomía.
 */
import type { Attribution, EventInput, EventStore, RequestContext } from '@soec/contracts';
import { PolicyService, evaluarAutorizacion, type AccionPropuesta } from '@soec/operacional';
import { PlanningService } from '@soec/marketing';
import { medStreamId, reconstruirMed } from '../domain/med';
import {
  EVENTOS_OPT,
  type OptimizacionState,
  type PoliticaOptimizacion,
  generarDecision,
  optStreamId,
  reconstruirOpt,
} from '../domain/optimization';
import { ComandoMedicionInvalidoError, OptimizacionNoEncontradaError } from '../domain/errors';

export interface OptimizarCmd {
  readonly publicationId: string;
  readonly planId: string;
  readonly campaniaId: string;
  readonly actividadId: string;
  readonly canal: string;
  readonly objetivoId: string;
  readonly policyIdOperacional: string;
  readonly policyOpt: PoliticaOptimizacion;
  readonly attribution: Attribution;
  readonly occurredAt: string;
}

const SIN_EFECTO = new Set(['mantener', 'esperar_datos']);
const ESCALAMIENTO = new Set(['aumentar_frecuencia', 'reasignar_presupuesto', 'prolongar_campania', 'crear_variante']);

export class OptimizationService {
  private readonly policies: PolicyService;

  constructor(
    private readonly store: EventStore,
    private readonly planning: PlanningService,
  ) {
    this.policies = new PolicyService(store);
  }

  cargar(ctx: RequestContext, optId: string): Promise<OptimizacionState> {
    return this.store.readStream(ctx, optStreamId(optId)).then((e) => reconstruirOpt(optId, ctx.organizationId, e));
  }
  private input(type: string, payload: unknown, a: Attribution, o: string): EventInput {
    return { type, payload, attribution: a, occurredAt: o };
  }

  async optimizar(ctx: RequestContext, cmd: OptimizarCmd): Promise<OptimizacionState> {
    const med = reconstruirMed(cmd.publicationId, ctx.organizationId, await this.store.readStream(ctx, medStreamId(cmd.publicationId)));
    if (!med.existe || !med.evaluacion) throw new ComandoMedicionInvalidoError(`No hay evaluación para la publicación '${cmd.publicationId}'`);

    const optId = `${cmd.publicationId}__opt${med.sincronizaciones}`;
    const previo = await this.cargar(ctx, optId);
    if (previo.existe) return previo; // idempotente por medición/sincronización

    const tasaConv = med.indicadores.find((i) => i.tipo === 'tasa_conversion')?.valor ?? null;
    const decision = generarDecision(med.evaluacion, med.atribucion!, med.anomalias, cmd.policyOpt, {
      campaniaId: cmd.campaniaId,
      actividadId: cmd.actividadId,
      canal: cmd.canal,
      tasaConversion: tasaConv,
    });

    await this.store.append(ctx, optStreamId(optId), previo.version, [this.input(EVENTOS_OPT.propuesta, { decision }, cmd.attribution, cmd.occurredAt)]);
    let state = await this.cargar(ctx, optId);

    // Sin efecto operativo (mantener / esperar datos): se autoriza trivialmente, sin cambio de plan.
    if (SIN_EFECTO.has(decision.tipo)) {
      await this.store.append(ctx, optStreamId(optId), state.version, [this.input(EVENTOS_OPT.autorizada, {}, cmd.attribution, cmd.occurredAt)]);
      return this.cargar(ctx, optId);
    }

    // Escalamiento que requiere aprobación → denegado (no se escala automáticamente).
    if (decision.requiereAprobacion || (ESCALAMIENTO.has(decision.tipo) && cmd.policyOpt.escalamientoRequiereAprobacion)) {
      await this.store.append(ctx, optStreamId(optId), state.version, [this.input(EVENTOS_OPT.denegada, { motivo: 'escalamiento requiere aprobación humana explícita' }, cmd.attribution, cmd.occurredAt)]);
      return this.cargar(ctx, optId);
    }

    // Autorización por el plano operacional (única puerta al efecto).
    const policyState = await this.policies.cargar(ctx, cmd.policyIdOperacional);
    const accion: AccionPropuesta = { tipo: 'publicar_organico', canal: cmd.canal, contenido: '', costo: 0, productoIntelectualRef: `opt:${optId}` };
    const autz = evaluarAutorizacion(policyState, accion, 0);
    if (!autz.permitida) {
      await this.store.append(ctx, optStreamId(optId), state.version, [this.input(EVENTOS_OPT.denegada, { motivo: `autorizacion:${autz.motivo}` }, cmd.attribution, cmd.occurredAt)]);
      return this.cargar(ctx, optId);
    }

    await this.store.append(ctx, optStreamId(optId), state.version, [this.input(EVENTOS_OPT.autorizada, {}, cmd.attribution, cmd.occurredAt)]);
    state = await this.cargar(ctx, optId);

    // Aplicar como cambio versionado del plan (por contrato público de marketing).
    const nuevoEstadoActividad = decision.tipo === 'pausar_actividad' ? 'omitida' : null;
    const plan = await this.planning.aplicarOptimizacion(
      ctx,
      cmd.planId,
      { tipo: decision.tipo, actividadId: cmd.actividadId, valorAnterior: decision.valorAnterior, valorNuevo: decision.valorPropuesto, motivo: decision.motivo, optRef: optId, nuevoEstadoActividad },
      cmd.attribution,
      cmd.occurredAt,
    );
    await this.store.append(ctx, optStreamId(optId), state.version, [this.input(EVENTOS_OPT.aplicada, { planVersion: plan.planVersion }, cmd.attribution, cmd.occurredAt)]);
    return this.cargar(ctx, optId);
  }

  /** Registra la evaluación posterior (tras re-medir el efecto del ajuste). */
  async registrarEvaluacionPosterior(ctx: RequestContext, optId: string, resultado: string, a: Attribution, o: string): Promise<OptimizacionState> {
    const state = await this.cargar(ctx, optId);
    if (!state.existe) throw new OptimizacionNoEncontradaError(`La optimización '${optId}' no existe`);
    await this.store.append(ctx, optStreamId(optId), state.version, [this.input(EVENTOS_OPT.evaluada, { resultado }, a, o)]);
    return this.cargar(ctx, optId);
  }
}
