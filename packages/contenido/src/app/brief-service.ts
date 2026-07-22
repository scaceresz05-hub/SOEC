/**
 * Servicio de briefs: crea el encargo editorial validando su completitud. Un brief
 * incompleto NO se completa inventando datos; queda en estado 'incompleto' con los
 * faltantes visibles y no habilita producción.
 */
import type { Attribution, EventStore, RequestContext } from '@soec/contracts';
import {
  type BriefState,
  type ContenidoBrief,
  type EstadoBrief,
  EVENTOS_BRIEF,
  briefStreamId,
  reconstruirBrief,
  validarBrief,
} from '../domain/brief';
import { BriefNoEncontradoError } from '../domain/errors';

export class BriefService {
  constructor(private readonly store: EventStore) {}

  cargar(ctx: RequestContext, briefId: string): Promise<BriefState> {
    return this.store.readStream(ctx, briefStreamId(briefId)).then((e) => reconstruirBrief(briefId, ctx.organizationId, e));
  }

  async crear(ctx: RequestContext, briefId: string, contenido: ContenidoBrief, attribution: Attribution, occurredAt: string): Promise<BriefState> {
    const previo = await this.cargar(ctx, briefId);
    if (previo.existe) return previo; // idempotente por identidad de brief
    const v = validarBrief(contenido);
    const estado: EstadoBrief = v.completo ? 'listo' : 'incompleto';
    await this.store.append(ctx, briefStreamId(briefId), previo.version, [
      { type: EVENTOS_BRIEF.creado, payload: { contenido, estado, faltantes: v.faltantes }, attribution, occurredAt },
    ]);
    return this.cargar(ctx, briefId);
  }

  async transicionar(ctx: RequestContext, briefId: string, nuevoEstado: EstadoBrief, attribution: Attribution, occurredAt: string): Promise<BriefState> {
    const estado = await this.cargar(ctx, briefId);
    if (!estado.existe) throw new BriefNoEncontradoError(`El brief '${briefId}' no existe`);
    await this.store.append(ctx, briefStreamId(briefId), estado.version, [
      { type: EVENTOS_BRIEF.transicion, payload: { nuevoEstado, faltantes: estado.faltantes, en: occurredAt }, attribution, occurredAt },
    ]);
    return this.cargar(ctx, briefId);
  }
}
