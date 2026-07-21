import { describe, expect, it } from 'vitest';
import { afirmacionMed, cmdBase, construirEce, montar, registrarBrecha, sembrar, sol } from './helpers';

describe('Operación proyectar', () => {
  it('proyecta escenarios cuando hay base (una brecha)', async () => {
    const e = montar();
    const ctx = await sembrar(e);
    await construirEce(e, ctx);
    await registrarBrecha(e, ctx);
    const r = await e.op.ejecutar(ctx, 'x1', sol('proyectar', { horizonte: '12 meses' }));
    if (r.producto.operacion === 'proyectar') {
      expect(r.producto.proyeccion.horizonte).toBe('12 meses');
      expect(r.producto.proyeccion.escenarios.length).toBeGreaterThanOrEqual(2); // múltiples escenarios
      expect(r.producto.proyeccion.escenarios.every((s) => s.supuestos.length > 0)).toBe(true); // supuestos explícitos
    }
  });

  it('no presenta escenarios como certeza: cada uno declara supuestos e incertidumbre', async () => {
    const e = montar();
    const ctx = await sembrar(e);
    await construirEce(e, ctx);
    await registrarBrecha(e, ctx);
    const r = await e.op.ejecutar(ctx, 'x1', sol('proyectar'));
    if (r.producto.operacion === 'proyectar') {
      for (const s of r.producto.proyeccion.escenarios) {
        expect(s.incertidumbre).toBeTruthy();
        expect(s.resultadoProyectado).toBeTruthy();
      }
    }
    expect(r.producto.cuestionesJuicioHumano.join(' ')).toMatch(/hecho futuro|pondera/);
  });

  it('queda no evaluable sin base (solo coherencias)', async () => {
    const e = montar();
    const ctx = await sembrar(e);
    await afirmacionMed(e, ctx, { id: 'a1', sostiene: true, respaldada: true });
    await construirEce(e, ctx);
    const r = await e.op.ejecutar(ctx, 'x1', sol('proyectar'));
    if (r.producto.operacion === 'proyectar') {
      expect(r.producto.proyeccion.escenarios).toHaveLength(0);
      expect(r.producto.incertidumbre).toBe('no evaluable');
    }
  });

  it('cambia la proyección al cambiar el ECE', async () => {
    const e = montar();
    const ctx = await sembrar(e);
    await construirEce(e, ctx);
    const antes = await e.op.ejecutar(ctx, 'x1', sol('proyectar'));
    await registrarBrecha(e, ctx);
    const despues = await e.op.ejecutar(ctx, 'x2', sol('proyectar'));
    const nAntes = antes.producto.operacion === 'proyectar' ? antes.producto.proyeccion.escenarios.length : -1;
    const nDespues = despues.producto.operacion === 'proyectar' ? despues.producto.proyeccion.escenarios.length : -1;
    expect(nDespues).toBeGreaterThan(nAntes);
  });

  it('consulta histórica: proyección anterior sobre un corte del ECE', async () => {
    const e = montar();
    const ctx = await sembrar(e);
    await construirEce(e, ctx);
    const corte = (await e.eceQuery.estadoActual(ctx, 'ece1')).construidoEn!;
    e.clock.advance(1000);
    await registrarBrecha(e, ctx);
    const r = await e.op.ejecutar(ctx, 'x1', sol('proyectar', { asOfRecordedAt: corte }));
    if (r.producto.operacion === 'proyectar') {
      expect(r.producto.proyeccion.escenarios).toHaveLength(0); // en el corte no había brecha
    }
    void cmdBase;
  });
});
