import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { elementosPorTipo } from '@soec/ece';
import { IDS, ejecutarComprenderEstado, instanciarPyme } from '../src';
import { cadena, ctxFor, seedOpts } from './helpers';

describe('Instanciación del primer dominio real (pyme de servicios)', () => {
  it('siembra MED y MDM sintéticos y construye el ECE con los elementos esperados', async () => {
    const store = new InMemoryEventStore();
    const e = cadena(store);
    const ctx = ctxFor('pyme-a');
    await instanciarPyme(ctx, e, seedOpts);

    const med = await e.med.estadoActual(ctx, IDS.med);
    expect(med.existe).toBe(true);
    expect(Object.keys(med.entidades).length).toBeGreaterThanOrEqual(6);

    const ece = await e.eceQuery.estadoActual(ctx, IDS.ece);
    expect(elementosPorTipo(ece, 'coherencia').length).toBeGreaterThanOrEqual(1);
    expect(elementosPorTipo(ece, 'contradiccion').length).toBeGreaterThanOrEqual(1);
    expect(elementosPorTipo(ece, 'ausencia').length).toBeGreaterThanOrEqual(1);
  });

  it('registra y publica la capacidad real «Comprender el estado»', async () => {
    const store = new InMemoryEventStore();
    const e = cadena(store);
    const ctx = ctxFor('pyme-a');
    await instanciarPyme(ctx, e, seedOpts);
    const def = await e.registry.resolver(ctx, IDS.capacidad);
    expect(def.familia).toBe('comprender-el-estado');
    expect(def.pasos.map((p) => p.operacion).sort()).toEqual(['detectar', 'esclarecer']);
    expect(def.componeCapacidades).toEqual([]);
  });

  it('ejecuta la capacidad y entrega un producto compuesto no vinculante y comprensible', async () => {
    const store = new InMemoryEventStore();
    const e = cadena(store);
    const ctx = ctxFor('pyme-a');
    await instanciarPyme(ctx, e, seedOpts);
    const r = await ejecutarComprenderEstado(ctx, e.orchestrator, 'ce-1', seedOpts);

    expect(r.producto.abstenido).toBe(false);
    expect(r.producto.bindingDecision).toBe(false);
    // Compone detectar + esclarecer.
    expect(r.producto.operacionesEjecutadas.map((p) => p.operacion)).toEqual(['detectar', 'esclarecer']);
    // Conserva la contradicción abierta y la remite al juicio humano.
    expect(r.producto.contradiccionesAbiertas.length).toBeGreaterThan(0);
    expect(r.producto.cuestionesJuicioHumano.join(' ')).toMatch(/persona/);
    // Hace visibles faltantes (ausencias del ECE).
    expect(r.producto.faltante.length).toBeGreaterThan(0);
  });

  it('no ejecuta efectos: MED, MDM y ECE quedan intactos tras comprender el estado', async () => {
    const store = new InMemoryEventStore();
    const e = cadena(store);
    const ctx = ctxFor('pyme-a');
    await instanciarPyme(ctx, e, seedOpts);
    const v = {
      med: (await e.med.estadoActual(ctx, IDS.med)).version,
      mdm: (await e.mdm.estadoActual(ctx, IDS.mdm)).version,
      ece: (await e.eceQuery.estadoActual(ctx, IDS.ece)).version,
    };
    await ejecutarComprenderEstado(ctx, e.orchestrator, 'ce-1', seedOpts);
    expect((await e.med.estadoActual(ctx, IDS.med)).version).toBe(v.med);
    expect((await e.mdm.estadoActual(ctx, IDS.mdm)).version).toBe(v.mdm);
    expect((await e.eceQuery.estadoActual(ctx, IDS.ece)).version).toBe(v.ece);
  });

  it('es idempotente por identidad de ejecución', async () => {
    const store = new InMemoryEventStore();
    const e = cadena(store);
    const ctx = ctxFor('pyme-a');
    await instanciarPyme(ctx, e, seedOpts);
    const r1 = await ejecutarComprenderEstado(ctx, e.orchestrator, 'ce-1', { ...seedOpts, idempotencyKey: 'k1' });
    const r2 = await ejecutarComprenderEstado(ctx, e.orchestrator, 'ce-1', { ...seedOpts, idempotencyKey: 'k1' });
    expect(r2.state.version).toBe(r1.state.version);
    expect(r2.producto).toEqual(r1.producto);
  });
});
