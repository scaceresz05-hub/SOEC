/**
 * Servicio de pausa (interruptor maestro). Pausa/reanuda por alcance (departamento,
 * canal, campaña, tipo de acción), con propagación. Consultado por el plano operacional
 * antes de producir efectos: es una pausa real, no visual.
 */
import type { Attribution, EventStore, RequestContext } from '@soec/contracts';
import { type Alcance, type PausaState, EVENTOS_PAUSA, esAlcanceValido, estaPausado, pausaStreamId, reconstruirPausa } from '../domain/pausa';
import { ComandoControlInvalidoError } from '../domain/errors';

export class PausaService {
  constructor(private readonly store: EventStore) {}

  cargar(ctx: RequestContext): Promise<PausaState> {
    return this.store.readStream(ctx, pausaStreamId(String(ctx.organizationId))).then((e) => reconstruirPausa(String(ctx.organizationId), e));
  }

  async pausar(ctx: RequestContext, alcance: Alcance, motivo: string, actor: string, attribution: Attribution, occurredAt: string): Promise<PausaState> {
    if (!esAlcanceValido(alcance)) throw new ComandoControlInvalidoError(`Alcance de pausa inválido: ${alcance.tipo}:${alcance.valor}`);
    const s = await this.cargar(ctx);
    await this.store.append(ctx, pausaStreamId(String(ctx.organizationId)), s.version, [{ type: EVENTOS_PAUSA.activada, payload: { alcance, motivo, actor }, attribution, occurredAt }]);
    return this.cargar(ctx);
  }
  async reanudar(ctx: RequestContext, alcance: Alcance, actor: string, attribution: Attribution, occurredAt: string): Promise<PausaState> {
    const s = await this.cargar(ctx);
    await this.store.append(ctx, pausaStreamId(String(ctx.organizationId)), s.version, [{ type: EVENTOS_PAUSA.reanudada, payload: { alcance, actor }, attribution, occurredAt }]);
    return this.cargar(ctx);
  }

  /** ¿Está pausado alguno de estos alcances (incluida la pausa global, que precede)? */
  async estaPausado(ctx: RequestContext, alcances: readonly Alcance[] = []): Promise<boolean> {
    return estaPausado(await this.cargar(ctx), alcances);
  }
}
