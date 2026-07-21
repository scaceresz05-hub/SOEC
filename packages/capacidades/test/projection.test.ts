import { describe, expect, it } from 'vitest';
import type { Outbox, OutboxMessage, RecordedEvent, RequestContext } from '@soec/contracts';
import {
  InMemoryCapDefProjectionStore,
  InMemoryCapExecProjectionStore,
  aplicarEventoAProyeccionCap,
} from '../src/projections/projection';
import { drenarCapacidades } from '../src/pg/projection-runner';
import { capdefStreamId } from '../src/domain/aggregate-definition';
import { capexecStreamId } from '../src/domain/aggregate-execution';
import { cmdBase, defDetectarOrientar, eceConContradiccion, montar } from './helpers';

class FakeOutbox implements Outbox {
  private m: OutboxMessage[];
  constructor(evs: RecordedEvent[]) {
    this.m = evs.map((e, i) => ({ id: `m${i}`, event: e }));
  }
  async pending(limit: number): Promise<readonly OutboxMessage[]> {
    return this.m.slice(0, limit);
  }
  async markProcessed(id: string): Promise<void> {
    this.m = this.m.filter((x) => x.id !== id);
  }
}

async function generar(ctx: RequestContext) {
  const e = montar();
  await eceConContradiccion(e, ctx);
  await e.registry.registrarVersion(ctx, 'cap', defDetectarOrientar());
  await e.registry.publicar(ctx, 'cap', 1);
  await e.orchestrator.ejecutar(ctx, 'x1', { capabilityId: 'cap', eceId: 'ece1', ...cmdBase });
  const evs = [
    ...(await e.store.readStream(ctx, capdefStreamId('cap'))),
    ...(await e.store.readStream(ctx, capexecStreamId('x1'))),
  ];
  return { e, evs: evs.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt) || a.sequence - b.sequence) };
}

describe('Proyecciones de capacidades — reconstruibles e idempotentes', () => {
  it('proyecta definiciones y ejecuciones, coincidiendo con el agregado', async () => {
    const ctx = { organizationId: 'orgA' as never, actor: 'tester' as never, scope: { organizationId: 'orgA' as never, permissions: ['events:append', 'events:read'] }, correlationId: 'c' };
    const { e, evs } = await generar(ctx);
    const stores = { def: new InMemoryCapDefProjectionStore(), exec: new InMemoryCapExecProjectionStore() };
    const n = await drenarCapacidades(new FakeOutbox(evs), stores);
    expect(n).toBe(evs.length);
    expect((await stores.def.list('orgA'))[0]).toEqual(await e.capQuery.definicion(ctx, 'cap'));
    expect((await stores.exec.list('orgA'))[0]).toEqual(await e.capQuery.ejecucion(ctx, 'x1'));
  });

  it('procesar dos veces no duplica (idempotencia por secuencia)', async () => {
    const ctx = { organizationId: 'orgA' as never, actor: 'tester' as never, scope: { organizationId: 'orgA' as never, permissions: ['events:append', 'events:read'] }, correlationId: 'c' };
    const { evs } = await generar(ctx);
    const stores = { def: new InMemoryCapDefProjectionStore(), exec: new InMemoryCapExecProjectionStore() };
    await drenarCapacidades(new FakeOutbox(evs), stores);
    const antes = await stores.exec.list('orgA');
    for (const ev of evs) expect(await aplicarEventoAProyeccionCap(stores, ev)).toBe('skipped');
    expect(await stores.exec.list('orgA')).toEqual(antes);
  });
});
