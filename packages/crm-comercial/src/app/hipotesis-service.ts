/**
 * @soec/crm-comercial · aplicación · Servicio de HIPÓTESIS COMERCIALES.
 *
 * Cierra el ciclo hipótesis → evidencia → resultado → aprendizaje en un agregado, event-sourced y
 * multi-tenant. La máquina de estados impide saltos inválidos; el aprendizaje exige explicar el
 * porqué (nunca "funcionó" a secas). La evaluación es explicable y respeta Evaluabilidad.
 */
import type { Attribution, EventInput, EventStore, RequestContext } from '@soec/contracts';
import type { TipoEvidencia } from '@soec/negocio';
import { ComandoCrmInvalidoError, ContactoNoEncontradoError } from '../domain/errors';
import {
  EVENTOS_HIPOTESIS,
  type EvaluacionHipotesis,
  type HipotesisState,
  type Veredicto,
  evaluarHipotesis,
  hipotesisStreamId,
  reconstruirHipotesis,
  transicionValida,
} from '../domain/hipotesis';
import { EVENTOS_HIPINDICE, type HipIndice, hipIndiceStreamId, reconstruirHipIndice } from '../domain/indices';

export class HipotesisComercialService {
  constructor(private readonly store: EventStore) {}

  private org(ctx: RequestContext): string {
    return String(ctx.organizationId);
  }

  async cargar(ctx: RequestContext, hipotesisId: string): Promise<HipotesisState> {
    const org = this.org(ctx);
    return reconstruirHipotesis(org, hipotesisId, await this.store.readStream(ctx, hipotesisStreamId(org, hipotesisId)));
  }

  async listar(ctx: RequestContext): Promise<HipIndice> {
    return reconstruirHipIndice(await this.store.readStream(ctx, hipIndiceStreamId(this.org(ctx))));
  }

  private append(ctx: RequestContext, hipotesisId: string, version: number, type: string, payload: unknown, a: Attribution, o: string): Promise<{ version: number }> {
    const input: EventInput = { type, payload, attribution: a, occurredAt: o };
    return this.store.append(ctx, hipotesisStreamId(this.org(ctx), hipotesisId), version, [input]);
  }

  private async exigir(ctx: RequestContext, hipotesisId: string): Promise<HipotesisState> {
    const st = await this.cargar(ctx, hipotesisId);
    if (!st.existe) throw new ContactoNoEncontradoError(`hipótesis ${hipotesisId} no encontrada`);
    return st;
  }

  /** Registra una hipótesis comercial (idempotente) y la inscribe en el índice. */
  async registrar(ctx: RequestContext, hipotesisId: string, enunciado: string, contexto: string, a: Attribution, o: string): Promise<void> {
    if (!hipotesisId?.trim() || !enunciado?.trim()) throw new ComandoCrmInvalidoError('hipotesisId y enunciado son obligatorios');
    const st = await this.cargar(ctx, hipotesisId);
    if (st.existe) return;
    await this.append(ctx, hipotesisId, st.version, EVENTOS_HIPOTESIS.registrada, { enunciado: enunciado.trim(), contexto }, a, o);
    await this.inscribir(ctx, hipotesisId, enunciado.trim(), a, o);
  }

  /** Agrega evidencia (a favor o en contra) con su origen epistémico. */
  async agregarEvidencia(ctx: RequestContext, hipotesisId: string, evidenciaId: string, descripcion: string, origen: TipoEvidencia, aFavor: boolean, a: Attribution, o: string): Promise<void> {
    const st = await this.exigir(ctx, hipotesisId);
    if (!evidenciaId?.trim()) throw new ComandoCrmInvalidoError('evidenciaId obligatorio');
    await this.append(ctx, hipotesisId, st.version, EVENTOS_HIPOTESIS.evidencia, { evidenciaId, descripcion, origen, aFavor }, a, o);
  }

  /** Pone la hipótesis en prueba (ABIERTA → EN_PRUEBA). */
  async iniciarPrueba(ctx: RequestContext, hipotesisId: string, a: Attribution, o: string): Promise<void> {
    const st = await this.exigir(ctx, hipotesisId);
    if (!transicionValida(st.estado, 'EN_PRUEBA')) throw new ComandoCrmInvalidoError(`no se puede pasar de ${st.estado} a EN_PRUEBA`);
    await this.append(ctx, hipotesisId, st.version, EVENTOS_HIPOTESIS.transicionada, { estado: 'EN_PRUEBA' }, a, o);
  }

  /** Registra el resultado observado y el veredicto (EN_PRUEBA → CONFIRMADA/REFUTADA/INCONCLUSA). */
  async registrarResultado(ctx: RequestContext, hipotesisId: string, descripcion: string, veredicto: Veredicto, valor: number | null, a: Attribution, o: string): Promise<void> {
    const st = await this.exigir(ctx, hipotesisId);
    if (!transicionValida(st.estado, veredicto)) throw new ComandoCrmInvalidoError(`no se puede registrar resultado desde ${st.estado} (requiere EN_PRUEBA)`);
    await this.append(ctx, hipotesisId, st.version, EVENTOS_HIPOTESIS.resultado, { descripcion, veredicto, valor, en: o }, a, o);
  }

  /** Registra el aprendizaje: exige explicar el porqué (nunca "funcionó" a secas). */
  async registrarAprendizaje(ctx: RequestContext, hipotesisId: string, porQue: string, transferible: string | null, a: Attribution, o: string): Promise<void> {
    const st = await this.exigir(ctx, hipotesisId);
    if (!porQue?.trim()) throw new ComandoCrmInvalidoError('el aprendizaje exige explicar el porqué');
    if (!st.resultado) throw new ComandoCrmInvalidoError('no hay resultado observado sobre el cual aprender');
    await this.append(ctx, hipotesisId, st.version, EVENTOS_HIPOTESIS.aprendizaje, { porQue: porQue.trim(), transferible }, a, o);
  }

  /** Evaluación explicable del estado de evidencia de la hipótesis. */
  async evaluar(ctx: RequestContext, hipotesisId: string): Promise<EvaluacionHipotesis> {
    return evaluarHipotesis(await this.exigir(ctx, hipotesisId));
  }

  private async inscribir(ctx: RequestContext, hipotesisId: string, enunciado: string, a: Attribution, o: string): Promise<void> {
    const org = this.org(ctx);
    const idx = reconstruirHipIndice(await this.store.readStream(ctx, hipIndiceStreamId(org)));
    if (idx.hipotesis.some((h) => h.hipotesisId === hipotesisId)) return;
    const input: EventInput = { type: EVENTOS_HIPINDICE.registrada, payload: { hipotesisId, enunciado }, attribution: a, occurredAt: o };
    await this.store.append(ctx, hipIndiceStreamId(org), idx.version, [input]);
  }
}
