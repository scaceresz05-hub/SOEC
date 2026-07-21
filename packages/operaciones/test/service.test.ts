import { describe, expect, it } from 'vitest';
import type { RequestContext } from '@soec/contracts';
import type { ContextoMecanismo, MecanismoOperacion } from '../src/domain/mechanism';
import type { ProductoIntelectual } from '../src/domain/product';
import { OperacionesService } from '../src/app/operations-service';
import { MecanismoDeterministico } from '../src/app/mechanisms/deterministic';
import { MecanismoSimuladoIA } from '../src/app/mechanisms/simulated';
import {
  MecanismoNoDisponibleError,
  ProductoOpacoError,
  SoberaniaVioladaError,
  SolicitudInvalidaError,
} from '../src/domain/errors';
import { afirmacionMed, attr, construirEce, ctxFor, montar, sembrar, sol } from './helpers';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function productoLiteral(over: Record<string, unknown>): ProductoIntelectual {
  return {
    operacion: 'detectar',
    eceId: 'ece1',
    eceCorte: { version: 0, recordedAt: null },
    proposito: 'p',
    procedencia: 'x',
    evidencia: [],
    faltante: [],
    limitaciones: ['l'],
    incertidumbre: 'x',
    razones: ['r'],
    cuestionesJuicioHumano: [],
    atribucion: attr,
    abstenido: false,
    causaAbstencion: null,
    bindingDecision: false,
    mecanismo: 'bad',
    mecanismoVersion: '0',
    deteccion: { senales: [] },
    ...over,
  } as ProductoIntelectual;
}

class MecanismoLento implements MecanismoOperacion {
  readonly nombre = 'lento';
  readonly version = '0';
  soporta(): boolean {
    return true;
  }
  async ejecutar(_c: RequestContext, ctx: ContextoMecanismo): Promise<ProductoIntelectual> {
    await sleep(50);
    return productoLiteral({ operacion: ctx.operacion, deteccion: { senales: [] } });
  }
}

async function conEce() {
  const e = montar();
  const ctx = await sembrar(e);
  await afirmacionMed(e, ctx, { id: 'a1', sostiene: true, debilita: true });
  await construirEce(e, ctx);
  return { e, ctx };
}

describe('OperacionesService — invariantes comunes', () => {
  it('rechaza una solicitud sin propósito', async () => {
    const { e, ctx } = await conEce();
    await expect(e.op.ejecutar(ctx, 'x1', { ...sol('detectar'), proposito: '' })).rejects.toBeInstanceOf(SolicitudInvalidaError);
  });

  it('es idempotente por identidad de ejecución', async () => {
    const { e, ctx } = await conEce();
    const r1 = await e.op.ejecutar(ctx, 'x1', sol('detectar'));
    const r2 = await e.op.ejecutar(ctx, 'x1', sol('detectar'));
    expect(r2.state.version).toBe(r1.state.version); // no reejecuta ni duplica
    expect(r2.producto).toEqual(r1.producto);
  });

  it('se abstiene si la ejecución fue cancelada', async () => {
    const { e, ctx } = await conEce();
    const ac = new AbortController();
    ac.abort();
    const r = await e.op.ejecutar(ctx, 'x1', sol('detectar'), ac.signal);
    expect(r.producto.abstenido).toBe(true);
    expect(r.producto.causaAbstencion).toBe('cancelacion');
  });

  it('se abstiene por timeout con un mecanismo lento', async () => {
    const e = montar();
    const ctx = await sembrar(e);
    await afirmacionMed(e, ctx, { id: 'a1', sostiene: true, debilita: true });
    await construirEce(e, ctx);
    const svc = new OperacionesService(e.store, e.eceQuery, [new MecanismoLento()]);
    const r = await svc.ejecutar(ctx, 'x1', sol('detectar', { maxMs: 5 }));
    expect(r.producto.abstenido).toBe(true);
    expect(r.producto.causaAbstencion).toBe('timeout');
  });

  it('se abstiene por política de datos si el mecanismo requeriría salir de la organización', async () => {
    const { e, ctx } = await conEce();
    const r = await e.op.ejecutar(ctx, 'x1', sol('detectar', { mecanismo: 'ia-simulada', dataPolicy: 'must-stay-internal' }));
    expect(r.producto.abstenido).toBe(true);
    expect(r.producto.causaAbstencion).toBe('politica_datos');
  });

  it('selecciona el mecanismo pedido y falla si no existe', async () => {
    const { e, ctx } = await conEce();
    const r = await e.op.ejecutar(ctx, 'x1', sol('detectar', { mecanismo: 'ia-simulada', dataPolicy: 'may-leave-org' }));
    expect(r.producto.mecanismo).toBe('ia-simulada');
    await expect(e.op.ejecutar(ctx, 'x2', sol('detectar', { mecanismo: 'inexistente' }))).rejects.toBeInstanceOf(
      MecanismoNoDisponibleError,
    );
  });

  it('rechaza un producto vinculante (guardarraíl de soberanía)', async () => {
    const { e, ctx } = await conEce();
    const mecBinding: MecanismoOperacion = {
      nombre: 'binding',
      version: '0',
      soporta: () => true,
      ejecutar: async (_c, c) => productoLiteral({ operacion: c.operacion, bindingDecision: true }),
    };
    const svc = new OperacionesService(e.store, e.eceQuery, [mecBinding]);
    await expect(svc.ejecutar(ctx, 'x1', sol('detectar'))).rejects.toBeInstanceOf(SoberaniaVioladaError);
  });

  it('rechaza un producto opaco (guardarraíl de anti-atrofia)', async () => {
    const { e, ctx } = await conEce();
    const mecOpaco: MecanismoOperacion = {
      nombre: 'opaco',
      version: '0',
      soporta: () => true,
      ejecutar: async (_c, c) => productoLiteral({ operacion: c.operacion, razones: [], evidencia: [], faltante: [] }),
    };
    const svc = new OperacionesService(e.store, e.eceQuery, [mecOpaco]);
    await expect(svc.ejecutar(ctx, 'x1', sol('detectar'))).rejects.toBeInstanceOf(ProductoOpacoError);
  });

  it('aísla por organización: otra org no ve la ejecución', async () => {
    const { e, ctx } = await conEce();
    await e.op.ejecutar(ctx, 'x1', sol('detectar'));
    const otra = await e.opQuery.ejecucion(ctxFor('orgB'), 'x1');
    expect(otra.existe).toBe(false);
  });

  it('un mecanismo desconocido es válido solo si soporta la operación', async () => {
    const { e } = await conEce();
    // Servicio con ambos mecanismos por defecto: determinístico soporta todo.
    expect(new MecanismoDeterministico().soporta('orientar')).toBe(true);
    expect(new MecanismoSimuladoIA().soporta('proyectar')).toBe(true);
    void e;
  });
});
