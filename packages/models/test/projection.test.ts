import { describe, expect, it } from 'vitest';
import type { Outbox, OutboxMessage, RecordedEvent, RequestContext } from '@soec/contracts';
import { InMemoryEventStore } from '@soec/event-store';
import { MedService, MdmService } from '../src/app/services';
import { streamId } from '../src/domain/model';
import {
  InMemoryProjectionStore,
  aplicarEventoAProyeccion,
  parseStream,
} from '../src/projections/projection';
import { drenarProyecciones } from '../src/pg/projection-runner';
import { ambitoMed, ambitoMdm, attr, ctxFor, vigencia } from './helpers';

const base = { attribution: attr, occurredAt: '2026-03-01T00:00:00.000Z' };

class FakeOutbox implements Outbox {
  private mensajes: OutboxMessage[];
  constructor(eventos: RecordedEvent[]) {
    this.mensajes = eventos.map((e, i) => ({ id: `m${i}`, event: e }));
  }
  async pending(limit: number): Promise<readonly OutboxMessage[]> {
    return this.mensajes.slice(0, limit);
  }
  async markProcessed(id: string): Promise<void> {
    this.mensajes = this.mensajes.filter((m) => m.id !== id);
  }
}

async function generar() {
  const store = new InMemoryEventStore();
  const med = new MedService(store);
  const mdm = new MdmService(store);

  const a = ctxFor('orgA');
  const b = ctxFor('orgB');
  await med.crear(a, { instanceId: 'm1', ambito: ambitoMed, vigencia, ...base });
  await med.registrarEntidad(a, { instanceId: 'm1', entidadId: 'u1', dimension: 'es', tipo: 'unidad', atributos: {}, ...base });
  await mdm.crear(a, { instanceId: 'w1', ambito: ambitoMdm, vigencia, ...base });
  await mdm.registrarObservacion(a, { instanceId: 'w1', observacionId: 'o1', contenido: 'obs', ...base });
  await med.crear(b, { instanceId: 'm1', ambito: ambitoMed, vigencia, ...base }); // misma id, otra org

  // Recolecta todos los eventos en orden (simula el outbox transaccional).
  const eventos: RecordedEvent[] = [];
  for (const [ctx, model, id] of [
    [a, 'MED', 'm1'],
    [a, 'MDM', 'w1'],
    [b, 'MED', 'm1'],
  ] as [RequestContext, 'MED' | 'MDM', string][]) {
    eventos.push(...(await store.readStream(ctx, streamId(model, id))));
  }
  // Ordena por tiempo de registro para respetar el orden global de conocimiento.
  eventos.sort((x, y) => x.recordedAt.localeCompare(y.recordedAt) || x.sequence - y.sequence);
  return { store, med, mdm, eventos, a, b };
}

describe('Proyecciones — runner reconstruible e idempotente (§13)', () => {
  it('la proyección resultante coincide con la reconstrucción del agregado', async () => {
    const { med, mdm, eventos, a } = await generar();
    const proj = new InMemoryProjectionStore();
    const n = await drenarProyecciones(new FakeOutbox(eventos), proj);
    expect(n).toBe(eventos.length);

    const medProj = (await proj.list('MED', 'orgA'))[0];
    const medAgg = await med.estadoActual(a, 'm1');
    expect(medProj).toEqual(medAgg);

    const mdmProj = (await proj.list('MDM', 'orgA'))[0];
    const mdmAgg = await mdm.estadoActual(a, 'w1');
    expect(mdmProj).toEqual(mdmAgg);
  });

  it('procesar dos veces no duplica (idempotencia por secuencia)', async () => {
    const { eventos } = await generar();
    const proj = new InMemoryProjectionStore();
    await drenarProyecciones(new FakeOutbox(eventos), proj);
    const antes = await proj.list('MED', 'orgA');
    // Segundo drenaje con los mismos eventos: todos deben omitirse.
    for (const e of eventos) {
      expect(await aplicarEventoAProyeccion(proj, e)).toBe('skipped');
    }
    const despues = await proj.list('MED', 'orgA');
    expect(despues).toEqual(antes);
  });

  it('una organización no contamina a otra', async () => {
    const { eventos } = await generar();
    const proj = new InMemoryProjectionStore();
    await drenarProyecciones(new FakeOutbox(eventos), proj);
    expect(await proj.list('MED', 'orgA')).toHaveLength(1);
    expect(await proj.list('MED', 'orgB')).toHaveLength(1);
    const a = (await proj.list('MED', 'orgA'))[0];
    const b = (await proj.list('MED', 'orgB'))[0];
    expect(a?.organizationId).toBe('orgA');
    expect(b?.organizationId).toBe('orgB');
    expect(Object.keys(a?.entidades ?? {})).toEqual(['u1']);
    expect(Object.keys(b?.entidades ?? {})).toEqual([]); // orgB solo creó, no agregó entidad
  });

  it('MED y MDM no se fusionan: viven en proyecciones separadas', async () => {
    const { eventos } = await generar();
    const proj = new InMemoryProjectionStore();
    await drenarProyecciones(new FakeOutbox(eventos), proj);
    expect(await proj.list('MED', 'orgA')).toHaveLength(1);
    expect(await proj.list('MDM', 'orgA')).toHaveLength(1);
    // La proyección MDM no contiene entidades del MED ni viceversa.
    const mdm = (await proj.list('MDM', 'orgA'))[0];
    expect(mdm?.observaciones).toHaveLength(1);
    expect(Object.keys(mdm?.entidades ?? {})).toEqual([]);
  });

  it('ignora streams ajenos (enlaces u otros)', async () => {
    expect(parseStream('link:abc')).toBeNull();
    expect(parseStream('med:x')?.modelType).toBe('MED');
  });
});
