/**
 * @soec/motor-medicion · aplicación · FACHADA DE LECTURA para M9 (`LecturaMedicion`).
 *
 * Solo lectura, snapshots deep-frozen. Expone observaciones, evaluaciones (con vigencia/alcance/naturaleza/
 * contradicciones), consolidaciones, aprendizajes y memoria. EXCLUYE huérfanas y MARCA lo no-vigente/no
 * evaluable. M9 consume; no muta la historia de M8.
 */
import type { EventStore, RequestContext } from '@soec/contracts';
import { observacionMedible } from '../dominio/observacion';
import { evaluacionVigente } from '../dominio/evaluacion-operacion';
import type { LecturaMedicion, ObservacionM9, EvaluacionM9, ConsolidacionM9, AprendizajeM9, MemoriaM9 } from '../contratos';
import { ObservacionService } from './observacion-service';
import { EvaluacionService } from './evaluacion-service';
import { AprendizajeOperacionalService } from './aprendizaje-op-service';
import { MemoriaService } from './memoria-service';
import { ConsolidacionService } from './consolidacion-service';

/** Congela en profundidad (arrays y objetos anidados) los snapshots de M9. */
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
    private readonly memoriaSvc: MemoriaService,
    private readonly consolidaciones: ConsolidacionService,
  ) { void this.store; }

  cargarObservacion(ctx: RequestContext, observacionId: string) { return this.observaciones.cargar(ctx, observacionId); }

  async listarObservaciones(ctx: RequestContext): Promise<readonly ObservacionM9[]> {
    const out: ObservacionM9[] = [];
    for (const id of await this.observaciones.listarIds(ctx)) {
      const st = await this.observaciones.cargar(ctx, id);
      if (!st.existe || !st.datos) continue; // huérfanas/vacías excluidas
      out.push({ observacionId: id, ordenId: st.datos.ordenId, kpiId: st.datos.kpiId, hipotesisId: st.datos.hipotesisId, estado: st.estado, valor: st.datos.valor, naturaleza: st.datos.naturaleza, medible: observacionMedible(st) });
    }
    return congelar(out);
  }

  cargarEvaluacion(ctx: RequestContext, evaluacionId: string) { return this.evaluaciones.cargar(ctx, evaluacionId); }

  async listarEvaluaciones(ctx: RequestContext): Promise<readonly EvaluacionM9[]> {
    const out: EvaluacionM9[] = [];
    for (const id of await this.evaluaciones.listarIds(ctx)) {
      const st = await this.evaluaciones.cargar(ctx, id);
      if (!st.existe) continue;
      const c = st.cuerpo;
      const vigente = evaluacionVigente(st);
      const resultado = c.resultado?.estado ?? null;
      const evaluable = resultado !== null && resultado !== 'NO_EVALUABLE' && resultado !== 'INCONSISTENTE';
      out.push({
        evaluacionId: id, observacionId: c.observacionId, kpiId: c.kpiId, hipotesisId: c.hipotesisId, segmento: c.segmento,
        estado: st.estado, vigente, resultado, hipotesis: c.hipotesis?.estado ?? null, atribucion: c.atribucion?.grado ?? null,
        recomendacion: c.recomendacion ? { estado: c.recomendacion.estado, tipo: c.recomendacion.tipo } : null,
        alcance: c.hipotesis?.alcance ?? null, naturaleza: c.medicion?.naturaleza ?? null,
        contradicciones: c.resultado?.contradicciones ?? [], medible: vigente && evaluable, explicacion: c.explicacion,
      });
    }
    return congelar(out);
  }

  cargarConsolidacion(ctx: RequestContext, consolidacionId: string) { return this.consolidaciones.cargar(ctx, consolidacionId); }

  async listarConsolidaciones(ctx: RequestContext): Promise<readonly ConsolidacionM9[]> {
    const out: ConsolidacionM9[] = [];
    for (const id of await this.consolidaciones.listarIds(ctx)) {
      const st = await this.consolidaciones.cargar(ctx, id);
      if (!st.existe || !st.cuerpo) continue;
      const c = st.cuerpo;
      out.push({ consolidacionId: id, hipotesisId: c.hipotesisId, estado: c.estado, alcance: c.alcance, experimentosUnicos: c.experimentosUnicos, incluidas: c.incluidas, excluidas: c.excluidas, contradicciones: c.contradicciones, confianza: c.confianza, explicacion: c.explicacion });
    }
    return congelar(out);
  }

  async listarAprendizajes(ctx: RequestContext): Promise<readonly AprendizajeM9[]> {
    const out: AprendizajeM9[] = [];
    for (const v of await this.aprendizajesOp.listarVinculos(ctx)) {
      const ev = await this.evaluaciones.cargar(ctx, v.evaluacionId);
      out.push({ aprendizajeId: v.aprendizajeId, evaluacionId: v.evaluacionId, hipotesisId: v.hipotesisId, vigente: evaluacionVigente(ev) });
    }
    return congelar(out);
  }

  async memoria(ctx: RequestContext): Promise<MemoriaM9> {
    const historico = await this.memoriaSvc.listar(ctx); // intentos = histórico persistido
    const evs = await this.listarEvaluaciones(ctx);
    const obs = await this.listarObservaciones(ctx);
    const aprs = await this.listarAprendizajes(ctx);
    const vig = evs.filter((e) => e.vigente);
    const memo: MemoriaM9 = {
      intentos: historico.length,
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
