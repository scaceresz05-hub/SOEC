/**
 * @soec/motor-medicion · aplicación · SERVICIO DE EVALUACIÓN (M8).
 *
 * Para una observación VALIDADA compone: evaluación de RESULTADO (puro) + evaluación de HIPÓTESIS (usando el
 * veredicto epistémico CANÓNICO de M5 vía `LecturaConocimiento`, NO una máquina paralela) + ATRIBUCIÓN cauta
 * + RECOMENDACIÓN explicable. Persiste una `EvaluacionOperacion` inmutable con explicación. Determinista.
 * No aprende aquí (eso es el servicio de aprendizaje) y no ejecuta nada.
 */
import { ConcurrencyError, type Attribution, type EventInput, type EventStore, type RequestContext } from '@soec/contracts';
import type { LecturaConocimiento } from '@soec/motor-estrategico';
import {
  EVENTOS_EVALUACION, type CuerpoEvaluacion, type EvaluacionOperacionState,
  evaluacionStreamId, reconstruirEvaluacion,
} from '../dominio/evaluacion-operacion';
import { type ExpectativaResultado, type EstadoResultado, evaluarResultado } from '../dominio/evaluacion-resultado';
import { type EntradaEvaluacionHipotesis, evaluarHipotesis } from '../dominio/evaluacion-hipotesis';
import { type EntradaAtribucion, atribuir } from '../dominio/atribucion-op';
import { recomendar } from '../dominio/recomendacion';
import { ObservacionService } from './observacion-service';
import { ComandoMedicionInvalidoError } from '../dominio/errors';

const EVENTOS_EVAL_INDICE = { registrada: 'evaluacion-indice.registrada' } as const;
function evalIndiceStreamId(org: string): string { return `evaluacion-indice:${org}`; }

export interface EntradaEvaluacion {
  readonly observacionId: string;
  readonly segmento: string;
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
  constructor(
    private readonly store: EventStore,
    private readonly observaciones: ObservacionService,
    private readonly conocimientoM5: LecturaConocimiento,
  ) {}

  private org(ctx: RequestContext): string { return String(ctx.organizationId); }

  cargar(ctx: RequestContext, evaluacionId: string): Promise<EvaluacionOperacionState> {
    const org = this.org(ctx);
    return this.store.readStream(ctx, evaluacionStreamId(org, evaluacionId)).then((e) => reconstruirEvaluacion(org, evaluacionId, e));
  }

  /** Emite una evaluación operacional (idempotente por `evaluacionId`). No hay evaluación duplicada. */
  async evaluar(ctx: RequestContext, evaluacionId: string, e: EntradaEvaluacion, a: Attribution, o: string): Promise<EvaluacionOperacionState> {
    if (!evaluacionId?.trim()) throw new ComandoMedicionInvalidoError('evaluacionId es obligatorio');
    const existente = await this.cargar(ctx, evaluacionId);
    if (existente.existe) { await this.asegurarEnIndice(ctx, evaluacionId, a, o); return existente; } // idempotente (repara índice)

    const obs = await this.observaciones.cargar(ctx, e.observacionId);
    const d = obs.datos;
    // Coherencia de KPI (métrica de OTRO KPI ⇒ no comparable) — se refleja como resultado INCONSISTENTE aguas abajo.
    const kpiCoincide = d !== null && d.kpiId === e.expectativa.kpiId;

    // Observado desde la observación (ausencia = null; nunca 0). Si no es VALIDADA/medible ⇒ sin valor.
    const medible = obs.existe && obs.estado === 'VALIDADA' && d !== null && d.valor !== null;
    const observado = {
      valor: medible && kpiCoincide ? (d!.valor as number) : null,
      calidad: d?.calidad ?? 'no_disponible',
      cobertura: d?.cobertura ?? 0,
      muestra: medible ? Math.max(1, Math.round((d!.cobertura ?? 0) * 1000)) : 0,
    };
    const resultado = evaluarResultado(e.expectativa, observado);

    // Hipótesis: veredicto epistémico CANÓNICO de M5 (no se reconstruye aquí).
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
      estadoHipotesis: hipotesis?.estado ?? 'NO_EVALUABLE', estadoResultado,
      confianza: hipotesis?.confianza ?? 'nula',
      evidencia: [resultado.explicacion, ...(hipotesis ? [hipotesis.explicacion] : [])],
      contraevidencia: resultado.contradicciones,
      datosFaltantes: resultado.faltantes,
    });
    const explicacion = kpiCoincide
      ? `resultado ${resultado.estado}; hipótesis ${hipotesis?.estado ?? 'sin hipótesis'}; recomendación ${recomendacion.estado}`
      : 'la métrica observada no corresponde al KPI esperado (no comparable)';

    const cuerpo: CuerpoEvaluacion = {
      observacionId: e.observacionId, hipotesisId: d?.hipotesisId ?? null, kpiId: e.expectativa.kpiId, segmento: e.segmento,
      resultado, hipotesis, atribucion, recomendacion, explicacion,
    };
    try {
      await this.append(ctx, evaluacionId, existente.version, EVENTOS_EVALUACION.emitida, cuerpo, a, o);
    } catch (e) {
      if (!(e instanceof ConcurrencyError)) throw e; // dos evaluadores concurrentes: uno gana, el otro converge
    }
    await this.asegurarEnIndice(ctx, evaluacionId, a, o);
    return this.cargar(ctx, evaluacionId);
  }

  /** Invalida (OBSOLETA) una evaluación cuando cambian sus supuestos (hipótesis/KPI/segmento/evidencia). */
  async invalidar(ctx: RequestContext, evaluacionId: string, motivo: string, a: Attribution, o: string): Promise<EvaluacionOperacionState> {
    const st = await this.cargar(ctx, evaluacionId);
    if (!st.existe || st.estado !== 'EMITIDA') return st;
    await this.append(ctx, evaluacionId, st.version, EVENTOS_EVALUACION.obsoleta, { motivo }, a, o);
    return this.cargar(ctx, evaluacionId);
  }

  private append(ctx: RequestContext, evaluacionId: string, version: number, type: string, payload: unknown, a: Attribution, o: string) {
    const input: EventInput = { type, payload, attribution: a, occurredAt: o };
    return this.store.append(ctx, evaluacionStreamId(this.org(ctx), evaluacionId), version, [input]);
  }

  private async asegurarEnIndice(ctx: RequestContext, evaluacionId: string, a: Attribution, o: string): Promise<void> {
    const org = this.org(ctx);
    const events = await this.store.readStream(ctx, evalIndiceStreamId(org));
    if (events.some((ev) => ev.type === EVENTOS_EVAL_INDICE.registrada && (ev.payload as { evaluacionId: string }).evaluacionId === evaluacionId)) return;
    try {
      await this.store.append(ctx, evalIndiceStreamId(org), events.length, [{ type: EVENTOS_EVAL_INDICE.registrada, payload: { evaluacionId }, attribution: a, occurredAt: o }]);
    } catch (e) { if (!(e instanceof ConcurrencyError)) throw e; } // índice idempotente ante concurrencia
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
