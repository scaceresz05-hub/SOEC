/**
 * Servicio de objetivos: registra la dirección comercial, validando evaluabilidad.
 * Rechaza objetivos imposibles/mal formados; registra faltantes de los evaluables-parciales.
 */
import type { AppendResult, Attribution, EventStore, RequestContext } from '@soec/contracts';
import {
  type ContenidoObjetivo,
  EVENTOS_OBJ,
  type ObjetivoState,
  objStreamId,
  reconstruirObjetivo,
  validarObjetivo,
} from '../domain/objetivo';
import { ObjetivoNoEvaluableError } from '../domain/errors';

export class ObjectiveService {
  constructor(private readonly store: EventStore) {}

  cargar(ctx: RequestContext, objetivoId: string): Promise<ObjetivoState> {
    return this.store.readStream(ctx, objStreamId(objetivoId)).then((e) => reconstruirObjetivo(objetivoId, ctx.organizationId, e));
  }

  async registrar(
    ctx: RequestContext,
    objetivoId: string,
    contenido: ContenidoObjetivo,
    attribution: Attribution,
    occurredAt: string,
    idempotencyKey?: string,
  ): Promise<{ result: AppendResult; evaluable: boolean; faltantes: string[] }> {
    const previo = await this.cargar(ctx, objetivoId);
    if (previo.existe) return { result: { events: [], version: previo.version }, evaluable: previo.evaluable, faltantes: [...previo.faltantes] };

    const v = validarObjetivo(contenido);
    if (v.error) throw new ObjetivoNoEvaluableError(`Objetivo mal formado o imposible: ${v.error}`);

    const input = { type: EVENTOS_OBJ.registrado, payload: { contenido, evaluable: v.evaluable, faltantes: v.faltantes }, attribution, occurredAt };
    const result = await this.store.append(ctx, objStreamId(objetivoId), previo.version, [
      idempotencyKey ? { ...input, idempotencyKey } : input,
    ]);
    return { result, evaluable: v.evaluable, faltantes: v.faltantes };
  }
}
