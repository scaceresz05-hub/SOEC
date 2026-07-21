import type { EventStore, RequestContext } from '@soec/contracts';
import { type CapDefState, capdefStreamId, reconstruirCapDef } from '../domain/aggregate-definition';
import { type CapExecState, capexecStreamId, reconstruirCapExec } from '../domain/aggregate-execution';
import type { ProductoCapacidad } from '../domain/product';

/** Consultas de capacidades (lectura por reconstrucción). */
export class CapabilityQueryService {
  constructor(private readonly store: EventStore) {}

  async definicion(ctx: RequestContext, capabilityId: string): Promise<CapDefState> {
    const events = await this.store.readStream(ctx, capdefStreamId(capabilityId));
    return reconstruirCapDef(capabilityId, ctx.organizationId, events);
  }

  async ejecucion(ctx: RequestContext, executionId: string): Promise<CapExecState> {
    const events = await this.store.readStream(ctx, capexecStreamId(executionId));
    return reconstruirCapExec(executionId, ctx.organizationId, events);
  }

  async ejecucionEnFecha(ctx: RequestContext, executionId: string, asOfRecordedAt: string): Promise<CapExecState> {
    const events = await this.store.reconstructAt(ctx, capexecStreamId(executionId), asOfRecordedAt);
    return reconstruirCapExec(executionId, ctx.organizationId, events);
  }

  async producto(ctx: RequestContext, executionId: string): Promise<ProductoCapacidad | null> {
    return (await this.ejecucion(ctx, executionId)).producto;
  }
}
