/**
 * @soec/motor-medicion · aplicación · APRENDIZAJE OPERACIONAL (M8).
 *
 * Construye APRENDIZAJE CANÓNICO reutilizando `@soec/aprendizaje` (las 4 capas) a partir de una
 * `EvaluacionOperacion`. NO crea una máquina de aprendizaje paralela. Guardarraíles:
 *  - NO se aprende desde una evaluación `NO_EVALUABLE` (ni resultado ni hipótesis): devuelve `null`
 *    ( AUSENCIA de aprendizaje, no una conclusión falsa).
 *  - Un único experimento produce aprendizaje LOCAL (sin capa reutilizable/transferible): la
 *    transferibilidad exige consolidación entre experimentos comparables.
 *  - El cruce a otra organización sigue exigiendo decisión humana (lo impone `@soec/aprendizaje`).
 * Mantiene un índice M8 (aprendizaje→evaluación) para reconciliación. Multi-tenant, event-sourced.
 */
import { ConcurrencyError, type Attribution, type EventStore, type RequestContext } from '@soec/contracts';
import { AprendizajeService, type EntradaAprendizaje } from '@soec/aprendizaje';
import { EvaluacionService } from './evaluacion-service';

const EVENTOS_APR_INDICE = { registrada: 'aprendizaje-op-indice.registrada' } as const;
function aprIndiceStreamId(org: string): string { return `aprendizaje-op-indice:${org}`; }

export interface VinculoAprendizaje {
  readonly aprendizajeId: string;
  readonly evaluacionId: string;
  readonly hipotesisId: string | null;
}

export class AprendizajeOperacionalService {
  private readonly aprendizajes: AprendizajeService;
  constructor(private readonly store: EventStore, private readonly evaluaciones: EvaluacionService, aprendizajes?: AprendizajeService) {
    this.aprendizajes = aprendizajes ?? new AprendizajeService(store);
  }

  private org(ctx: RequestContext): string { return String(ctx.organizationId); }

  /**
   * Aprende desde una evaluación EMITIDA y evaluable. Devuelve `null` si no es admisible (NO_EVALUABLE):
   * ausencia honesta de aprendizaje. Idempotente por `aprendizajeId`.
   */
  async aprenderDesde(ctx: RequestContext, aprendizajeId: string, evaluacionId: string, a: Attribution, o: string): Promise<{ aprendizajeId: string } | null> {
    const ev = await this.evaluaciones.cargar(ctx, evaluacionId);
    if (!ev.existe || ev.estado !== 'EMITIDA' || !ev.cuerpo) return null;
    const c = ev.cuerpo;
    // Guardarraíl: no se aprende desde lo NO_EVALUABLE/INCONSISTENTE.
    if (c.resultado.estado === 'NO_EVALUABLE' || c.resultado.estado === 'INCONSISTENTE') return null;
    if (c.hipotesis && c.hipotesis.estado === 'NO_EVALUABLE') return null;

    const ganador = c.resultado.estado === 'SUPERADO' || c.resultado.estado === 'CUMPLIDO' ? 'variante'
      : c.resultado.estado === 'NO_CUMPLIDO' ? 'control' : null;
    const suficiente = c.hipotesis?.estado === 'RESPALDADA' || c.hipotesis?.estado === 'REFUTADA';
    const entrada: EntradaAprendizaje = {
      observado: {
        experimentoId: evaluacionId, ganador,
        valorControl: c.resultado.esperado.baseline, valorVariante: c.resultado.observado ?? c.resultado.esperado.baseline,
        observaciones: c.atribucion?.eventosIncluidos ?? 0, evidencia: c.resultado.explicacion,
      },
      interpretacion: {
        texto: `LOCAL al experimento: resultado ${c.resultado.estado}, hipótesis ${c.hipotesis?.estado ?? 'sin hipótesis'}`,
        supuestos: ['dato SIMULADO/ESTIMADO', 'válido solo para este experimento hasta consolidar'],
        confianza: c.hipotesis?.confianza === 'media' ? 'media' : 'baja',
      },
      conclusion: {
        enunciado: c.recomendacion.fundamento,
        soporte: suficiente ? 'evidencia_suficiente' : 'evidencia_insuficiente',
        accionRecomendada: c.recomendacion.tipo,
      },
      // Sin capa reutilizable: un solo experimento NO es transferible (lo decide la consolidación).
    };
    await this.aprendizajes.registrar(ctx, aprendizajeId, entrada, a, o);
    await this.indexar(ctx, { aprendizajeId, evaluacionId, hipotesisId: c.hipotesisId }, a, o);
    return { aprendizajeId };
  }

  cargar(ctx: RequestContext, aprendizajeId: string) {
    return this.aprendizajes.cargar(ctx, aprendizajeId);
  }

  private async indexar(ctx: RequestContext, v: VinculoAprendizaje, a: Attribution, o: string): Promise<void> {
    const org = this.org(ctx);
    const events = await this.store.readStream(ctx, aprIndiceStreamId(org));
    if (events.some((e) => e.type === EVENTOS_APR_INDICE.registrada && (e.payload as VinculoAprendizaje).aprendizajeId === v.aprendizajeId)) return;
    try {
      await this.store.append(ctx, aprIndiceStreamId(org), events.length, [{ type: EVENTOS_APR_INDICE.registrada, payload: v, attribution: a, occurredAt: o }]);
    } catch (e) { if (!(e instanceof ConcurrencyError)) throw e; } // índice idempotente ante concurrencia
  }

  async listarVinculos(ctx: RequestContext): Promise<readonly VinculoAprendizaje[]> {
    const events = await this.store.readStream(ctx, aprIndiceStreamId(this.org(ctx)));
    return events.filter((e) => e.type === EVENTOS_APR_INDICE.registrada).map((e) => e.payload as VinculoAprendizaje);
  }
}
