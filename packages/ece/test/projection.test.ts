import { describe, expect, it } from 'vitest';
import type { Outbox, OutboxMessage, RecordedEvent } from '@soec/contracts';
import { InMemoryProjectionStore } from '@soec/models';
import { streamId as modelStreamId } from '@soec/models';
import { InMemoryEceProjectionStore } from '../src/projections/projection';
import { procesarEventoParaEce } from '../src/pg/invalidation';
import { drenarModelosYEce } from '../src/pg/projection-runner';
import { eceStreamId } from '../src/domain/ece';
import { ambitoMdm, ambitoMed, cmdBase, ctxFor, entorno, vigencia } from './helpers';

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

const construir = { medInstanceId: 'm1', mdmInstanceId: 'w1', ...cmdBase };

async function eventosDe(e: ReturnType<typeof entorno>, ctx: ReturnType<typeof ctxFor>): Promise<RecordedEvent[]> {
  const evs: RecordedEvent[] = [];
  for (const sid of [modelStreamId('MED', 'm1'), modelStreamId('MDM', 'w1'), eceStreamId('ece1')]) {
    evs.push(...(await e.store.readStream(ctx, sid)));
  }
  return evs.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt) || a.sequence - b.sequence);
}

describe('Proyección del ECE e invalidación por el worker', () => {
  it('la proyección coincide con el estado reconstruido del agregado', async () => {
    const e = entorno();
    const ctx = ctxFor('orgA');
    await e.med.crear(ctx, { instanceId: 'm1', ambito: ambitoMed, vigencia, ...cmdBase });
    await e.med.emitirAfirmacion(ctx, { instanceId: 'm1', afirmacionId: 'a1', enunciado: 'x', dimension: 'hace', incertidumbre: 'alta', ...cmdBase });
    await e.mdm.crear(ctx, { instanceId: 'w1', ambito: ambitoMdm, vigencia, ...cmdBase });
    e.clock.advance(1000);
    await e.build.construir(ctx, { eceId: 'ece1', ...construir });

    const modelProj = new InMemoryProjectionStore();
    const eceProj = new InMemoryEceProjectionStore();
    const evs = await eventosDe(e, ctx);
    const r = await drenarModelosYEce(new FakeOutbox(evs), modelProj, { eceProjStore: eceProj, build: e.build });
    expect(r.procesados).toBe(evs.length);

    const proj = (await eceProj.list('orgA'))[0];
    const agg = await e.query.estadoActual(ctx, 'ece1');
    expect(proj).toEqual(agg);
  });

  it('procesar dos veces no duplica (idempotencia por secuencia)', async () => {
    const e = entorno();
    const ctx = ctxFor('orgA');
    await e.med.crear(ctx, { instanceId: 'm1', ambito: ambitoMed, vigencia, ...cmdBase });
    await e.mdm.crear(ctx, { instanceId: 'w1', ambito: ambitoMdm, vigencia, ...cmdBase });
    e.clock.advance(1000);
    await e.build.construir(ctx, { eceId: 'ece1', ...construir });
    const modelProj = new InMemoryProjectionStore();
    const eceProj = new InMemoryEceProjectionStore();
    const evs = await eventosDe(e, ctx);
    await drenarModelosYEce(new FakeOutbox(evs), modelProj, { eceProjStore: eceProj, build: e.build });
    const antes = (await eceProj.list('orgA'))[0];
    // Reaplicar los mismos eventos no cambia nada.
    for (const ev of evs.filter((x) => x.streamId.startsWith('ece:'))) {
      const { aplicarEventoAProyeccionEce } = await import('../src/projections/projection');
      expect(await aplicarEventoAProyeccionEce(eceProj, ev)).toBe('skipped');
    }
    expect((await eceProj.list('orgA'))[0]).toEqual(antes);
  });

  it('el worker invalida el ECE cuando su entrada MED cambia (con causación)', async () => {
    const e = entorno();
    const ctx = ctxFor('orgA');
    await e.med.crear(ctx, { instanceId: 'm1', ambito: ambitoMed, vigencia, ...cmdBase });
    await e.mdm.crear(ctx, { instanceId: 'w1', ambito: ambitoMdm, vigencia, ...cmdBase });
    e.clock.advance(1000);
    await e.build.construir(ctx, { eceId: 'ece1', ...construir });

    // Proyecta el ECE (para que afectadosPorModelo lo conozca).
    const eceProj = new InMemoryEceProjectionStore();
    for (const ev of await e.store.readStream(ctx, eceStreamId('ece1'))) {
      const { aplicarEventoAProyeccionEce } = await import('../src/projections/projection');
      await aplicarEventoAProyeccionEce(eceProj, ev);
    }

    // Cambio posterior en el MED.
    e.clock.advance(1000);
    const r = await e.med.registrarEntidad(ctx, { instanceId: 'm1', entidadId: 'u1', dimension: 'es', tipo: 'unidad', atributos: {}, ...cmdBase });
    const medEvent = r.events[0]!;

    const n = await procesarEventoParaEce(medEvent, { eceProjStore: eceProj, build: e.build });
    expect(n).toBe(1);
    const st = await e.query.estadoActual(ctx, 'ece1');
    expect(st.requiereReconstruccion).toBe(true);
    expect(st.invalidadoPor).toBe(medEvent.eventId); // trazabilidad causal
  });
});
