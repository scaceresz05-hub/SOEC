import { describe, expect, it } from 'vitest';
import { afirmacionMed, construirEce, montar, registrarBrecha, sembrar, sol } from './helpers';

describe('Operación detectar', () => {
  it('detecta una tensión sustentada (contradicción con evidencia)', async () => {
    const e = montar();
    const ctx = await sembrar(e);
    await afirmacionMed(e, ctx, { id: 'a1', sostiene: true, debilita: true });
    await construirEce(e, ctx);
    const r = await e.op.ejecutar(ctx, 'x1', sol('detectar'));
    if (r.producto.operacion === 'detectar') {
      const s = r.producto.deteccion.senales;
      expect(s.length).toBe(1);
      expect(s[0]?.objeto).toContain('contradicción');
      expect(s[0]?.posibleFalsoPositivo).toBe(false); // hay evidencia
    }
  });

  it('detecta una señal provisional (posible falso positivo) sin sustento de evidencia', async () => {
    const e = montar();
    const ctx = await sembrar(e);
    await construirEce(e, ctx);
    await registrarBrecha(e, ctx); // brecha declarada sin evidencia
    const r = await e.op.ejecutar(ctx, 'x1', sol('detectar'));
    if (r.producto.operacion === 'detectar') {
      const brecha = r.producto.deteccion.senales.find((x) => x.objeto.includes('brecha'));
      expect(brecha?.posibleFalsoPositivo).toBe(true);
    }
  });

  it('detecta pero marca no evaluable ante una ausencia', async () => {
    const e = montar();
    const ctx = await sembrar(e);
    await afirmacionMed(e, ctx, { id: 'a1' }); // ausencia
    await construirEce(e, ctx);
    const r = await e.op.ejecutar(ctx, 'x1', sol('detectar'));
    if (r.producto.operacion === 'detectar') {
      expect(r.producto.deteccion.senales.some((x) => x.noEvaluable)).toBe(true);
    }
  });

  it('no detecta señal cuando no hay sustento (solo coherencias)', async () => {
    const e = montar();
    const ctx = await sembrar(e);
    await afirmacionMed(e, ctx, { id: 'a1', sostiene: true, respaldada: true });
    await construirEce(e, ctx);
    const r = await e.op.ejecutar(ctx, 'x1', sol('detectar'));
    if (r.producto.operacion === 'detectar') {
      expect(r.producto.deteccion.senales).toHaveLength(0);
    }
    expect(r.producto.abstenido).toBe(false); // producto válido con cero señales
    expect(r.producto.razones.length).toBeGreaterThan(0);
  });

  it('es determinística: el mismo ECE produce la misma detección', async () => {
    const e = montar();
    const ctx = await sembrar(e);
    await afirmacionMed(e, ctx, { id: 'a1', sostiene: true, debilita: true });
    await construirEce(e, ctx);
    const r1 = await e.op.ejecutar(ctx, 'x1', sol('detectar'));
    const r2 = await e.op.ejecutar(ctx, 'x2', sol('detectar'));
    expect(r1.producto.operacion === 'detectar' && r2.producto.operacion === 'detectar' && r1.producto.deteccion).toEqual(
      r2.producto.operacion === 'detectar' ? r2.producto.deteccion : null,
    );
  });
});
