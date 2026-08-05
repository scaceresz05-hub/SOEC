/**
 * @soec/motor-optimizacion · aplicación · SERVICIO DE OPTIMIZACIÓN (M9) — orquestación del ciclo.
 *
 * Consume EXCLUSIVAMENTE los puertos de lectura de M5–M8 (nunca estados del llamador, copias antiguas,
 * aprendizajes retirados, resultados parciales ni datos cross-tenant). Antes de optimizar VERIFICA la
 * coherencia de versiones M5–M8. Construye el ciclo por pasos event-sourced (cada uno una frontera). Termina
 * en una propuesta APROBABLE, nunca en una ejecución. Multi-tenant, determinista, idempotente por `cicloId`.
 */
import { ConcurrencyError, type Attribution, type EventInput, type EventStore, type RequestContext } from '@soec/contracts';
import type { LecturaConocimiento } from '@soec/motor-estrategico';
import type { LecturaCreativa } from '@soec/motor-creativo';
import type { LecturaOperativa } from '@soec/motor-operacion';
import { clasificarM8 } from '@soec/motor-operacion';
import type { LecturaMedicion } from '@soec/motor-medicion';
import {
  EVENTOS_CICLO, type CicloState, type VersionesBase, cicloStreamId, reconstruirCiclo,
} from '../dominio/ciclo';
import type { Oportunidad, Alternativa } from '../dominio/optimizacion-tipos';
import { type PoliticaOptimizacion, type AlternativaComparada, compararAlternativas } from '../dominio/comparacion';
import { ComandoOptimizacionInvalidoError, CicloNoEncontradoError } from '../dominio/errors';

const EVENTOS_CICLO_INDICE = { registrada: 'ciclo-indice.registrada' } as const;
function cicloIndiceStreamId(org: string): string { return `ciclo-opt-indice:${org}`; }

export interface EntradaCiclo {
  readonly objetivo: string;
  readonly segmento: string;
  readonly versionesBase: VersionesBase;
  readonly presupuestoDisponible: number;
}

export interface CoherenciaVersiones { readonly coherente: boolean; readonly motivo: string }

export class OptimizacionService {
  constructor(
    private readonly store: EventStore,
    private readonly m5: LecturaConocimiento,
    private readonly m6: LecturaCreativa,
    private readonly m7: LecturaOperativa,
    private readonly m8: LecturaMedicion,
  ) {}

  private org(ctx: RequestContext): string { return String(ctx.organizationId); }

  cargar(ctx: RequestContext, cicloId: string): Promise<CicloState> {
    const org = this.org(ctx);
    return this.store.readStream(ctx, cicloStreamId(org, cicloId)).then((e) => reconstruirCiclo(org, cicloId, e));
  }

  private async append(ctx: RequestContext, cicloId: string, type: string, payload: unknown, a: Attribution, o: string): Promise<void> {
    const st = await this.cargar(ctx, cicloId);
    const input: EventInput = { type, payload, attribution: a, occurredAt: o };
    try { await this.store.append(ctx, cicloStreamId(this.org(ctx), cicloId), st.version, [input]); }
    catch (e) { if (!(e instanceof ConcurrencyError)) throw e; }
  }

  /**
   * Verifica la COHERENCIA de versiones M5–M8 (autoritativo): hipótesis vigente en M5, pieza aprobada+vigente
   * en M6, plan/orden COMPLETA en M7, y evidencia M8 vigente para el segmento. No confía en el llamador.
   */
  async verificarCoherencia(ctx: RequestContext, e: EntradaCiclo): Promise<CoherenciaVersiones> {
    const v = e.versionesBase;
    const hip = await this.m5.evaluar(ctx, v.hipotesisId).catch(() => null);
    if (!hip?.afirmacion.existe || hip.afirmacion.retirada) return { coherente: false, motivo: 'hipótesis M5 inexistente o retirada' };
    const aprobadas = await this.m6.listarPiezasAprobadas(ctx);
    const pa = aprobadas.find((p) => p.paqueteId === v.piezaId);
    if (!pa || pa.version !== v.piezaVersion) return { coherente: false, motivo: 'pieza M6 no aprobada+vigente en la versión base' };
    const orden = await this.m7.cargarOrden(ctx, v.planRef);
    if (!orden.existe || clasificarM8(orden.estado, orden.evidenciaRefs.length > 0) !== 'COMPLETA') return { coherente: false, motivo: 'plan/orden M7 inexistente o no COMPLETA' };
    const evs = await this.m8.listarEvaluaciones(ctx);
    // Si se indica segmento, exige evidencia para ese segmento; si no (revalidación por versión), basta
    // con alguna evidencia M8 vigente.
    const hayEvidencia = e.segmento ? evs.some((x) => x.vigente && x.segmento === e.segmento) : evs.some((x) => x.vigente);
    if (!hayEvidencia) return { coherente: false, motivo: 'sin evidencia M8 vigente' };
    return { coherente: true, motivo: '' };
  }

  /** Abre un ciclo (idempotente). Verifica coherencia; si no es coherente, el ciclo nace pero será NO_EVALUABLE. */
  async abrir(ctx: RequestContext, cicloId: string, e: EntradaCiclo, a: Attribution, o: string): Promise<CicloState> {
    if (!cicloId?.trim()) throw new ComandoOptimizacionInvalidoError('cicloId es obligatorio');
    const st = await this.cargar(ctx, cicloId);
    if (st.existe) { await this.asegurarEnIndice(ctx, cicloId, a, o); return st; }
    await this.append(ctx, cicloId, EVENTOS_CICLO.abierto, { objetivo: e.objetivo, segmento: e.segmento, versionesBase: e.versionesBase, presupuestoDisponible: e.presupuestoDisponible }, a, o);
    await this.asegurarEnIndice(ctx, cicloId, a, o);
    return this.cargar(ctx, cicloId);
  }

  /** Recopila evidencia M8 vigente (evaluaciones/aprendizajes/contradicciones) para el segmento del ciclo. */
  async recopilarEvidencia(ctx: RequestContext, cicloId: string, a: Attribution, o: string): Promise<CicloState> {
    const st = await this.exigir(ctx, cicloId);
    if (st.estado !== 'ABIERTO') return st;
    const seg = st.cuerpo.segmento;
    const evs = (await this.m8.listarEvaluaciones(ctx)).filter((x) => x.vigente && x.segmento === seg);
    const aprs = (await this.m8.listarAprendizajes(ctx)).filter((x) => x.vigente);
    const contradicciones = evs.flatMap((x) => x.contradicciones);
    await this.append(ctx, cicloId, EVENTOS_CICLO.evidencia, { evaluacionesM8: evs.map((x) => x.evaluacionId), aprendizajes: aprs.map((x) => x.aprendizajeId), contradicciones }, a, o);
    return this.cargar(ctx, cicloId);
  }

  /** Determina la evaluabilidad: EVALUABLE si hay evidencia vigente suficiente; NO_EVALUABLE si no. */
  async evaluar(ctx: RequestContext, cicloId: string, a: Attribution, o: string): Promise<CicloState> {
    const st = await this.exigir(ctx, cicloId);
    if (st.estado !== 'RECOPILANDO_EVIDENCIA') return st;
    const coh = await this.verificarCoherencia(ctx, { objetivo: st.cuerpo.objetivo, segmento: st.cuerpo.segmento, versionesBase: st.cuerpo.versionesBase!, presupuestoDisponible: st.cuerpo.presupuestoDisponible });
    const evaluable = coh.coherente && st.cuerpo.evaluacionesM8.length > 0;
    await this.append(ctx, cicloId, EVENTOS_CICLO.evaluabilidad, { evaluable, motivo: evaluable ? 'evidencia vigente y versiones coherentes' : coh.motivo || 'sin evidencia vigente' }, a, o);
    return this.cargar(ctx, cicloId);
  }

  async registrarOportunidad(ctx: RequestContext, cicloId: string, oportunidad: Oportunidad, a: Attribution, o: string): Promise<CicloState> {
    const st = await this.exigir(ctx, cicloId);
    if (st.estado !== 'EVALUABLE') return st;
    await this.append(ctx, cicloId, EVENTOS_CICLO.oportunidad, { oportunidad }, a, o);
    return this.cargar(ctx, cicloId);
  }

  async registrarAlternativa(ctx: RequestContext, cicloId: string, alternativa: Alternativa, a: Attribution, o: string): Promise<CicloState> {
    await this.exigir(ctx, cicloId);
    await this.append(ctx, cicloId, EVENTOS_CICLO.alternativa, { alternativa }, a, o);
    return this.cargar(ctx, cicloId);
  }

  /** Compara las alternativas registradas con la política (determinista, explicable). */
  async comparar(ctx: RequestContext, cicloId: string, pol: PoliticaOptimizacion, a: Attribution, o: string): Promise<readonly AlternativaComparada[]> {
    const st = await this.exigir(ctx, cicloId);
    const comparadas = compararAlternativas(pol, st.cuerpo.alternativas);
    await this.append(ctx, cicloId, EVENTOS_CICLO.comparacion, { comparadas }, a, o);
    return comparadas;
  }

  /** Marca el ciclo con la propuesta generada (PROPUESTAS_GENERADAS) y luego PENDIENTE_APROBACION. */
  async vincularPropuesta(ctx: RequestContext, cicloId: string, propuestaId: string, a: Attribution, o: string): Promise<CicloState> {
    await this.append(ctx, cicloId, EVENTOS_CICLO.propuestas, { propuestaId }, a, o);
    await this.append(ctx, cicloId, EVENTOS_CICLO.pendiente, { propuestaId }, a, o);
    return this.cargar(ctx, cicloId);
  }

  async resolver(ctx: RequestContext, cicloId: string, estado: 'APROBADO' | 'RECHAZADO', a: Attribution, o: string): Promise<CicloState> {
    await this.append(ctx, cicloId, EVENTOS_CICLO.resuelto, { estado }, a, o);
    return this.cargar(ctx, cicloId);
  }

  async marcarAplicado(ctx: RequestContext, cicloId: string, explicacion: string, a: Attribution, o: string): Promise<CicloState> {
    await this.append(ctx, cicloId, EVENTOS_CICLO.aplicado, { explicacion }, a, o);
    return this.cargar(ctx, cicloId);
  }

  async obsoletar(ctx: RequestContext, cicloId: string, motivo: string, a: Attribution, o: string): Promise<CicloState> {
    await this.append(ctx, cicloId, EVENTOS_CICLO.obsoleto, { motivo }, a, o);
    return this.cargar(ctx, cicloId);
  }

  async cancelar(ctx: RequestContext, cicloId: string, motivo: string, a: Attribution, o: string): Promise<CicloState> {
    await this.append(ctx, cicloId, EVENTOS_CICLO.cancelado, { motivo }, a, o);
    return this.cargar(ctx, cicloId);
  }

  private async exigir(ctx: RequestContext, cicloId: string): Promise<CicloState> {
    const st = await this.cargar(ctx, cicloId);
    if (!st.existe) throw new CicloNoEncontradoError(`ciclo ${cicloId} no encontrado`);
    return st;
  }

  private async asegurarEnIndice(ctx: RequestContext, cicloId: string, a: Attribution, o: string): Promise<void> {
    const org = this.org(ctx);
    const events = await this.store.readStream(ctx, cicloIndiceStreamId(org));
    if (events.some((e) => e.type === EVENTOS_CICLO_INDICE.registrada && (e.payload as { cicloId: string }).cicloId === cicloId)) return;
    try { await this.store.append(ctx, cicloIndiceStreamId(org), events.length, [{ type: EVENTOS_CICLO_INDICE.registrada, payload: { cicloId }, attribution: a, occurredAt: o }]); }
    catch (e) { if (!(e instanceof ConcurrencyError)) throw e; }
  }

  async listarIds(ctx: RequestContext): Promise<readonly string[]> {
    const events = await this.store.readStream(ctx, cicloIndiceStreamId(this.org(ctx)));
    return events.filter((e) => e.type === EVENTOS_CICLO_INDICE.registrada).map((e) => (e.payload as { cicloId: string }).cicloId);
  }

  async estaEnIndice(ctx: RequestContext, cicloId: string): Promise<boolean> {
    const events = await this.store.readStream(ctx, cicloIndiceStreamId(this.org(ctx)));
    return events.some((e) => e.type === EVENTOS_CICLO_INDICE.registrada && (e.payload as { cicloId: string }).cicloId === cicloId);
  }

  async reindexar(ctx: RequestContext, cicloId: string, a: Attribution, o: string): Promise<void> { await this.asegurarEnIndice(ctx, cicloId, a, o); }
}
