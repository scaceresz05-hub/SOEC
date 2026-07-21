import { describe, expect, it } from 'vitest';
import type { RequestContext } from '@soec/contracts';
import type { DefinicionInput } from '../src/app/registry';
import {
  cmdBase,
  defAnticipar,
  defDetectarOrientar,
  defEsclarecerSimple,
  eceConContradiccion,
  montar,
} from './helpers';

async function preparar(e: ReturnType<typeof montar>, ctx: RequestContext, capId: string, def: DefinicionInput) {
  await e.registry.registrarVersion(ctx, capId, def);
  await e.registry.publicar(ctx, capId, 1);
}
const req = (extra: object = {}) => ({ capabilityId: '', eceId: 'ece1', ...cmdBase, ...extra });

describe('Composición de operaciones', () => {
  it('capacidad simple: compone una sola operación', async () => {
    const e = montar();
    const ctx = await eceConContradiccion(e);
    await preparar(e, ctx, 'cap1', defEsclarecerSimple());
    const r = await e.orchestrator.ejecutar(ctx, 'x1', {
      ...req({ capabilityId: 'cap1', objetivos: { e1: 'der:contradiccion:MED:m1:a1' } }),
    });
    expect(r.producto.operacionesEjecutadas).toHaveLength(1);
    expect(r.producto.operacionesEjecutadas[0]?.operacion).toBe('esclarecer');
    expect(r.producto.abstenido).toBe(false);
    expect(r.producto.bindingDecision).toBe(false);
  });

  it('composición secuencial: detectar alimenta orientar sin convertir detección en decisión', async () => {
    const e = montar();
    const ctx = await eceConContradiccion(e);
    await preparar(e, ctx, 'cap2', defDetectarOrientar());
    const r = await e.orchestrator.ejecutar(ctx, 'x1', { ...req({ capabilityId: 'cap2' }) });
    expect(r.producto.operacionesEjecutadas.map((p) => p.stepId)).toEqual(['d1', 'o1']); // orden por dependencia
    expect(r.producto.operacionesEjecutadas[0]?.operacion).toBe('detectar');
    expect(r.producto.operacionesEjecutadas[1]?.operacion).toBe('orientar');
    expect(r.producto.bindingDecision).toBe(false);
    // La orientación se ejecutó como operación no vinculante (no es una decisión).
    const o1 = await e.operaciones.producto(ctx, 'x1:o1');
    expect(o1?.operacion).toBe('orientar');
    expect(o1?.bindingDecision).toBe(false);
  });

  it('composición paralela: proyectar y esclarecer se componen conservando sus diferencias', async () => {
    const e = montar();
    const ctx = await eceConContradiccion(e);
    await preparar(e, ctx, 'cap3', defAnticipar());
    const r = await e.orchestrator.ejecutar(ctx, 'x1', {
      ...req({ capabilityId: 'cap3', objetivos: { e1: 'der:contradiccion:MED:m1:a1' } }),
    });
    const ops = r.producto.operacionesEjecutadas.map((p) => p.operacion).sort();
    expect(ops).toEqual(['esclarecer', 'proyectar']);
    expect(r.producto.productoCompuesto.length).toBe(2); // ambas líneas, sin fusionarse
  });

  it('conserva los productos intermedios (no los oculta)', async () => {
    const e = montar();
    const ctx = await eceConContradiccion(e);
    await preparar(e, ctx, 'cap2', defDetectarOrientar());
    const r = await e.orchestrator.ejecutar(ctx, 'x1', { ...req({ capabilityId: 'cap2' }) });
    expect(r.producto.productosIntermedios).toEqual(['x1:d1', 'x1:o1']);
    // Cada intermedio es recuperable por su ejecución de operación.
    for (const ref of r.producto.productosIntermedios) {
      expect(await e.operaciones.producto(ctx, ref)).not.toBeNull();
    }
  });

  it('el producto compuesto es explicable (no opaco) y remite al juicio humano', async () => {
    const e = montar();
    const ctx = await eceConContradiccion(e);
    await preparar(e, ctx, 'cap2', defDetectarOrientar());
    const r = await e.orchestrator.ejecutar(ctx, 'x1', { ...req({ capabilityId: 'cap2' }) });
    expect(r.producto.cuestionesJuicioHumano.length).toBeGreaterThan(0);
    expect(r.producto.productoCompuesto.length).toBeGreaterThan(0);
    expect(r.producto.procedencia).toContain('capacidad');
  });
});
