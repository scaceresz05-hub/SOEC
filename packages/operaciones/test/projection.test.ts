import { describe, expect, it } from 'vitest';
import type { Outbox, OutboxMessage, RecordedEvent } from '@soec/contracts';
import { InMemoryOiProjectionStore, proyectarEventoOi } from '../src/projections/projection';
import { drenarOperaciones } from '../src/pg/projection-runner';
import { oiStreamId } from '../src/domain/aggregate';
import { afirmacionMed, construirEce, montar, sembrar, sol } from './helpers';

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

async function conEjecucion() {
  const e = montar();
  const ctx = await sembrar(e);
  await afirmacionMed(e, ctx, { id: 'a1', sostiene: true, debilita: true });
  await construirEce(e, ctx);
  await e.op.ejecutar(ctx, 'x1', sol('detectar'));
  const eventos = await e.store.readStream(ctx, oiStreamId('x1'));
  return { e, ctx, eventos: [...eventos] };
}

describe('Proyección de operaciones — reconstruible e idempotente (§21)', () => {
  it('la proyección coincide con la ejecución reconstruida', async () => {
    const { e, ctx, eventos } = await conEjecucion();
    const store = new InMemoryOiProjectionStore();
    const n = await drenarOperaciones(new FakeOutbox(eventos), store);
    expect(n).toBe(eventos.length);
    const proj = (await store.list('orgA'))[0];
    const agg = await e.opQuery.ejecucion(ctx, 'x1');
    expect(proj).toEqual(agg);
    expect(proj?.estado).toBe('ejecutada');
  });

  it('procesar dos veces no duplica (idempotencia por secuencia)', async () => {
    const { eventos } = await conEjecucion();
    const store = new InMemoryOiProjectionStore();
    await drenarOperaciones(new FakeOutbox(eventos), store);
    const antes = await store.list('orgA');
    for (const ev of eventos) expect(await proyectarEventoOi(store, ev)).toBe('skipped');
    expect(await store.list('orgA')).toEqual(antes);
  });

  it('ignora streams ajenos', async () => {
    const store = new InMemoryOiProjectionStore();
    const ajeno = { streamId: 'med:m1', organizationId: 'orgA', sequence: 1 } as unknown as RecordedEvent;
    expect(await proyectarEventoOi(store, ajeno)).toBe('ignored');
  });
});
