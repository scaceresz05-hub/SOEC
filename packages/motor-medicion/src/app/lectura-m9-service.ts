/**
 * @soec/motor-medicion · aplicación · FACHADA DE LECTURA para M9 (`LecturaMedicion`).
 *
 * Solo lectura, snapshots deep-frozen (inmutables en runtime): observaciones, evaluaciones, aprendizajes y
 * una MEMORIA operacional consultable (qué se intentó, qué respaldó/refutó, qué aprendizajes siguen
 * vigentes). M9 consume; NO puede mutar la historia de M8. No presenta una ejecución sin evidencia como
 * completa, marca lo no vigente, y excluye huérfanas (lista por índice, no por streams sueltos).
 */
import type { EventStore, RequestContext } from '@soec/contracts';
import { observacionMedible } from '../dominio/observacion';
import type { LecturaMedicion, ObservacionM9, EvaluacionM9, AprendizajeM9, MemoriaM9 } from '../contratos';
import { ObservacionService } from './observacion-service';
import { EvaluacionService } from './evaluacion-service';
import { AprendizajeOperacionalService } from './aprendizaje-op-service';

/** Congela en profundidad (inmutabilidad runtime de los snapshots de M9). */
export function congelar<T>(x: T): T {
  if (x && typeof x === 'object' && !Object.isFrozen(x)) {
    Object.freeze(x);
    for (const v of Object.values(x)) congelar(v);
  }
  return x;
}

export class LecturaM9Service implements LecturaMedicion {
  constructor(
    private readonly store: EventStore,
    private readonly observaciones: ObservacionService,
    private readonly evaluaciones: EvaluacionService,
    private readonly aprendizajesOp: AprendizajeOperacionalService,
  ) { void this.store; }

  cargarObservacion(ctx: RequestContext, observacionId: string) {
    return this.observaciones.cargar(ctx, observacionId);
  }

  async listarObservaciones(ctx: RequestContext): Promise<readonly ObservacionM9[]> {
    const out: ObservacionM9[] = [];
    for (const id of await this.observaciones.listarIds(ctx)) {
      const st = await this.observaciones.cargar(ctx, id);
      if (!st.existe || !st.datos) continue; // huérfanas / vacías excluidas
      out.push({
        observacionId: id, ordenId: st.datos.ordenId, kpiId: st.datos.kpiId, hipotesisId: st.datos.hipotesisId,
        estado: st.estado, valor: st.datos.valor, naturaleza: st.datos.naturaleza, medible: observacionMedible(st),
      });
    }
    return congelar(out);
  }

  cargarEvaluacion(ctx: RequestContext, evaluacionId: string) {
    return this.evaluaciones.cargar(ctx, evaluacionId);
  }

  async listarEvaluaciones(ctx: RequestContext): Promise<readonly EvaluacionM9[]> {
    const out: EvaluacionM9[] = [];
    for (const id of await this.evaluaciones.listarIds(ctx)) {
      const st = await this.evaluaciones.cargar(ctx, id);
      if (!st.existe || !st.cuerpo) continue;
      const c = st.cuerpo;
      const vigente = st.estado === 'EMITIDA';
      const evaluable = c.resultado.estado !== 'NO_EVALUABLE' && c.resultado.estado !== 'INCONSISTENTE';
      out.push({
        evaluacionId: id, observacionId: c.observacionId, kpiId: c.kpiId, hipotesisId: c.hipotesisId, segmento: c.segmento,
        estado: st.estado, resultado: c.resultado.estado, hipotesis: c.hipotesis?.estado ?? null,
        atribucion: c.atribucion?.grado ?? null, recomendacion: { estado: c.recomendacion.estado, tipo: c.recomendacion.tipo },
        medible: vigente && evaluable, explicacion: c.explicacion,
      });
    }
    return congelar(out);
  }

  async listarAprendizajes(ctx: RequestContext): Promise<readonly AprendizajeM9[]> {
    const out: AprendizajeM9[] = [];
    for (const v of await this.aprendizajesOp.listarVinculos(ctx)) {
      const ev = await this.evaluaciones.cargar(ctx, v.evaluacionId);
      out.push({ aprendizajeId: v.aprendizajeId, evaluacionId: v.evaluacionId, hipotesisId: v.hipotesisId, vigente: ev.existe && ev.estado === 'EMITIDA' });
    }
    return congelar(out);
  }

  async memoria(ctx: RequestContext): Promise<MemoriaM9> {
    const evs = await this.listarEvaluaciones(ctx);
    const obs = await this.listarObservaciones(ctx);
    const aprs = await this.listarAprendizajes(ctx);
    const vig = evs.filter((e) => e.estado === 'EMITIDA');
    const memo: MemoriaM9 = {
      intentos: evs.length,
      respaldadas: [...new Set(vig.filter((e) => e.hipotesis === 'RESPALDADA' && e.hipotesisId).map((e) => e.hipotesisId as string))],
      refutadas: [...new Set(vig.filter((e) => e.hipotesis === 'REFUTADA' && e.hipotesisId).map((e) => e.hipotesisId as string))],
      inconclusas: [...new Set(vig.filter((e) => e.hipotesis === 'INCONCLUSA' && e.hipotesisId).map((e) => e.hipotesisId as string))],
      aprendizajesVigentes: aprs.filter((x) => x.vigente).map((x) => x.aprendizajeId),
      aprendizajesInvalidados: aprs.filter((x) => !x.vigente).map((x) => x.aprendizajeId),
      simuladas: obs.filter((x) => x.naturaleza === 'SIMULADA').length,
    };
    return congelar(memo);
  }
}
