/**
 * Servicio de pausa (interruptor maestro). Pausa/reanuda por alcance (departamento,
 * canal, campaña, tipo de acción), con propagación. Consultado por el plano operacional
 * antes de producir efectos: es una pausa real, no visual.
 */
import type { Attribution, EventStore, RequestContext } from '@soec/contracts';
import { type Alcance, type PausaState, EVENTOS_PAUSA, estaPausado, pausaStreamId, reconstruirPausa } from '../domain/pausa';

export class PausaService {
  constructor(private readonly store: EventStore) {}

  cargar(ctx: RequestContext): Promise<PausaState> {
    return this.store.readStream(ctx, pausaStreamId(String(ctx.organizationId))).then((e) => reconstruirPausa(String(ctx.organizationId), e));
  }

  async pausar(ctx: RequestContext, alcance: Alcance, motivo: string, actor: string, attribution: Attribution, occurredAt: string): Promise<PausaState> {
    const s = await this.cargar(ctx);
    await this.store.append(ctx, pausaStreamId(String(ctx.organizationId)), s.version, [{ type: EVENTOS_PAUSA.activada, payload: { alcance, motivo, actor }, attribution, occurredAt }]);
    return this.cargar(ctx);
  }
  async reanudar(ctx: RequestContext, alcance: Alcance, actor: string, attribution: Attribution, occurredAt: string): Promise<PausaState> {
    const s = await this.cargar(ctx);
    await this.store.append(ctx, pausaStreamId(String(ctx.organizationId)), s.version, [{ type: EVENTOS_PAUSA.reanudada, payload: { alcance, actor }, attribution, occurredAt }]);
    return this.cargar(ctx);
  }

  async estaPausado(ctx: RequestContext, contexto: { canal?: string; campania?: string; tipoAccion?: string } = {}): Promise<boolean> {
    return estaPausado(await this.cargar(ctx), contexto);
  }
}
