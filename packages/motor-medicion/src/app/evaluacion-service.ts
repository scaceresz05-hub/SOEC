/**
 * @soec/motor-medicion · aplicación · SERVICIO DE EVALUACIÓN (M8).
 *
 * Compone, POR PASOS event-sourced (medición→resultado→atribución→hipótesis→recomendación→cierre), la
 * evaluación de una observación VALIDADA. Cada paso es idempotente: un fallo entre pasos deja estado parcial
 * y el reintento repara sólo lo faltante. Usa el veredicto epistémico CANÓNICO de M5 (no una máquina
 * paralela) y motores puros. Persiste `EvaluacionOperacion` con explicación. Invalida (REQUIERE_REVISION/
 * OBSOLETA) ante cambios de supuestos; nunca en silencio. Determinista, multi-tenant.
 */
import { ConcurrencyError, type Attribution, type EventInput, type EventStore, type RequestContext } from '@soec/contracts';
import type { LecturaConocimiento } from '@soec/motor-estrategico';
import {
  EVENTOS_EVALUACION, type EvaluacionOperacionState, type MedicionSnapshot,
  evaluacionStreamId, reconstruirEvaluacion,
} from '../dominio/evaluacion-operacion';
import { type ExpectativaResultado, type EstadoResultado, evaluarResultado } from '../dominio/evaluacion-resultado';
import { type EntradaEvaluacionHipotesis, evaluarHipotesis } from '../dominio/evaluacion-hipotesis';
import { type EntradaAtribucion, atribuir } from '../dominio/atribucion-op';
import { recomendar } from '../dominio/recomendacion';
import { ObservacionService } from './observacion-service';
import { MemoriaService } from './memoria-service';
import { ComandoMedicionInvalidoError } from '../dominio/errors';

const EVENTOS_EVAL_INDICE = { registrada: 'evaluacion-indice.registrada' } as const;
function evalIndiceStreamId(org: string): string { return `evaluacion-indice:${org}`; }

export interface EntradaEvaluacion {
  readonly observacionId: string;
  readonly segmento: string;
  readonly contexto?: string;
  readonly expectativa: ExpectativaResultado;
  readonly hipotesisVersion: number;
  readonly evidenciaAFavor: number;
  readonly evidenciaEnContra: number;
  readonly observacionesExcluidas: number;
  readonly suficiente: boolean;
  readonly pertinente: boolean;
  readonly atribucion: EntradaAtribucion;
}

export class EvaluacionService {
  private readonly memoria: MemoriaService;
  constructor(
    private readonly store: EventStore,
    private readonly observaciones: ObservacionService,
    private readonly conocimientoM5: LecturaConocimiento,
    memoria?: MemoriaService,
  ) { this.memoria = memoria ?? new MemoriaService(store); }

  private org(ctx: RequestContext): string { return String(ctx.organizationId); }

  cargar(ctx: RequestContext, evaluacionId: string): Promise<EvaluacionOperacionState> {
    const org = this.org(ctx);
    return this.store.readStream(ctx, evaluacionStreamId(org, evaluacionId)).then((e) => reconstruirEvaluacion(org, evaluacionId, e));
  }

  /** Evalúa por pasos idempotentes. Idempotente/convergente por `evaluacionId`. Persiste memoria + índice. */
  async evaluar(ctx: RequestContext, evaluacionId: string, e: EntradaEvaluacion, a: Attribution, o: string): Promise<EvaluacionOperacionState> {
    if (!evaluacionId?.trim()) throw new ComandoMedicionInvalidoError('evaluacionId es obligatorio');

    const obs = await this.observaciones.cargar(ctx, e.observacionId);
    const d = obs.datos;
    const kpiCoincide = d !== null && d.kpiId === e.expectativa.kpiId;
    const medible = obs.existe && obs.estado === 'VALIDADA' && d !== null && d.valor !== null;
    const medicion: MedicionSnapshot = {
      valor: medible && kpiCoincide ? (d!.valor as number) : null, calidad: d?.calidad ?? 'no_disponible',
      cobertura: d?.cobertura ?? 0, unidad: d?.unidad ?? 'ratio', naturaleza: d?.naturaleza ?? 'SIMULADA',
    };
    const observado = { valor: medicion.valor, calidad: d?.calidad ?? 'no_disponible', cobertura: d?.cobertura ?? 0, muestra: medible ? Math.max(1, Math.round((d!.cobertura ?? 0) * 1000)) : 0 };
    const resultado = evaluarResultado(e.expectativa, observado);

    let hipotesis = null;
    if (d?.hipotesisId) {
      const evM5 = await this.conocimientoM5.evaluar(ctx, d.hipotesisId).catch(() => null);
      const estadoM5 = evM5?.afirmacion.existe ? evM5.evaluacion.estado : 'NO_EVALUABLE';
      const entradaH: EntradaEvaluacionHipotesis = {
        hipotesisId: d.hipotesisId, hipotesisVersion: e.hipotesisVersion, estadoM5, resultado: resultado.estado,
        evidenciaAFavor: e.evidenciaAFavor, evidenciaEnContra: e.evidenciaEnContra, observacionesExcluidas: e.observacionesExcluidas,
        suficiente: e.suficiente, pertinente: e.pertinente,
      };
      hipotesis = evaluarHipotesis(entradaH);
    }
    const atribucion = atribuir(e.atribucion);
    const estadoResultado: EstadoResultado = resultado.estado;
    const recomendacion = recomendar({
      estadoHipotesis: hipotesis?.estado ?? 'NO_EVALUABLE', estadoResultado, confianza: hipotesis?.confianza ?? 'nula',
      evidencia: [resultado.explicacion, ...(hipotesis ? [hipotesis.explicacion] : [])], contraevidencia: resultado.contradicciones, datosFaltantes: resultado.faltantes,
    });
    const explicacion = kpiCoincide
      ? `resultado ${resultado.estado}; hipótesis ${hipotesis?.estado ?? 'sin hipótesis'}; recomendación ${recomendacion.estado}`
      : 'la métrica observada no corresponde al KPI esperado (no comparable)';

    // Pasos event-sourced idempotentes (cada uno es una frontera de fallo/recuperación).
    await this.paso(ctx, evaluacionId, EVENTOS_EVALUACION.medicion, { observacionId: e.observacionId, hipotesisId: d?.hipotesisId ?? null, kpiId: e.expectativa.kpiId, segmento: e.segmento, contexto: e.contexto ?? 'ctx1', medicion }, (s) => s.cuerpo.medicion !== null, a, o);
    await this.paso(ctx, evaluacionId, EVENTOS_EVALUACION.resultado, { resultado }, (s) => s.cuerpo.resultado !== null, a, o);
    await this.paso(ctx, evaluacionId, EVENTOS_EVALUACION.atribucion, { atribucion }, (s) => s.cuerpo.atribucion !== null, a, o);
    await this.paso(ctx, evaluacionId, EVENTOS_EVALUACION.hipotesis, { hipotesis }, (s) => s.cuerpo.hipotesis !== null || !d?.hipotesisId, a, o);
    await this.paso(ctx, evaluacionId, EVENTOS_EVALUACION.recomendacion, { recomendacion, explicacion }, (s) => s.cuerpo.recomendacion !== null, a, o);
    await this.paso(ctx, evaluacionId, EVENTOS_EVALUACION.cerrada, {}, (s) => s.estado !== 'ABIERTA', a, o);
    await this.asegurarEnIndice(ctx, evaluacionId, a, o);
    await this.memoria.registrar(ctx, evaluacionId, { hipotesisId: d?.hipotesisId ?? null, kpiId: e.expectativa.kpiId, segmento: e.segmento }, a, o);
    return this.cargar(ctx, evaluacionId);
  }

  /** Append idempotente de un paso: sólo si `yaHecho` es falso; convergente ante concurrencia. */
  private async paso(ctx: RequestContext, evaluacionId: string, type: string, payload: unknown, yaHecho: (s: EvaluacionOperacionState) => boolean, a: Attribution, o: string): Promise<void> {
    const st = await this.cargar(ctx, evaluacionId);
    if (yaHecho(st)) return;
    const input: EventInput = { type, payload, attribution: a, occurredAt: o };
    try {
      await this.store.append(ctx, evaluacionStreamId(this.org(ctx), evaluacionId), st.version, [input]);
    } catch (err) { if (!(err instanceof ConcurrencyError)) throw err; } // otro evaluador avanzó: converge
  }

  /** Marca REQUIERE_REVISION (revisión pendiente por un cambio de supuestos). Idempotente. */
  async marcarRevision(ctx: RequestContext, evaluacionId: string, motivo: string, a: Attribution, o: string): Promise<EvaluacionOperacionState> {
    await this.paso(ctx, evaluacionId, EVENTOS_EVALUACION.revision, { motivo }, (s) => s.estado !== 'EMITIDA', a, o);
    return this.cargar(ctx, evaluacionId);
  }

  /** Invalida (OBSOLETA) por cambio de supuestos (hipótesis/KPI/segmento/pieza/variante/evidencia/atribución). */
  async invalidar(ctx: RequestContext, evaluacionId: string, motivo: string, a: Attribution, o: string): Promise<EvaluacionOperacionState> {
    await this.paso(ctx, evaluacionId, EVENTOS_EVALUACION.obsoleta, { motivo }, (s) => s.estado !== 'EMITIDA' && s.estado !== 'REQUIERE_REVISION', a, o);
    return this.cargar(ctx, evaluacionId);
  }

  private async asegurarEnIndice(ctx: RequestContext, evaluacionId: string, a: Attribution, o: string): Promise<void> {
    const org = this.org(ctx);
    const events = await this.store.readStream(ctx, evalIndiceStreamId(org));
    if (events.some((ev) => ev.type === EVENTOS_EVAL_INDICE.registrada && (ev.payload as { evaluacionId: string }).evaluacionId === evaluacionId)) return;
    try {
      await this.store.append(ctx, evalIndiceStreamId(org), events.length, [{ type: EVENTOS_EVAL_INDICE.registrada, payload: { evaluacionId }, attribution: a, occurredAt: o }]);
    } catch (e) { if (!(e instanceof ConcurrencyError)) throw e; }
  }

  async listarIds(ctx: RequestContext): Promise<readonly string[]> {
    const events = await this.store.readStream(ctx, evalIndiceStreamId(this.org(ctx)));
    return events.filter((e) => e.type === EVENTOS_EVAL_INDICE.registrada).map((e) => (e.payload as { evaluacionId: string }).evaluacionId);
  }

  async estaEnIndice(ctx: RequestContext, evaluacionId: string): Promise<boolean> {
    const events = await this.store.readStream(ctx, evalIndiceStreamId(this.org(ctx)));
    return events.some((e) => e.type === EVENTOS_EVAL_INDICE.registrada && (e.payload as { evaluacionId: string }).evaluacionId === evaluacionId);
  }
}
