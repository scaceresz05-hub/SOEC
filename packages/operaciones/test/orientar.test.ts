import { describe, expect, it } from 'vitest';
import { afirmacionMed, construirEce, montar, sembrar, sol } from './helpers';

describe('Operación orientar', () => {
  it('orienta de forma fundada ante una contradicción, sin decidir', async () => {
    const e = montar();
    const ctx = await sembrar(e);
    await afirmacionMed(e, ctx, { id: 'a1', sostiene: true, debilita: true });
    await construirEce(e, ctx);
    const r = await e.op.ejecutar(ctx, 'x1', sol('orientar'));
    expect(r.producto.abstenido).toBe(false);
    if (r.producto.operacion === 'orientar') {
      expect(r.producto.orientacion.noVinculante).toBe(true);
      expect(r.producto.orientacion.consideraciones.length).toBeGreaterThanOrEqual(1);
      expect(r.producto.orientacion.cuestionesReservadas.length).toBeGreaterThanOrEqual(2);
    }
    expect(r.producto.bindingDecision).toBe(false);
  });

  it('ofrece consideraciones múltiples ante contradicción + ausencia', async () => {
    const e = montar();
    const ctx = await sembrar(e);
    await afirmacionMed(e, ctx, { id: 'a1', sostiene: true, debilita: true });
    await afirmacionMed(e, ctx, { id: 'a2' }); // ausencia
    await construirEce(e, ctx);
    const r = await e.op.ejecutar(ctx, 'x1', sol('orientar'));
    if (r.producto.operacion === 'orientar') {
      expect(r.producto.orientacion.consideraciones.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('exige explícitamente el juicio humano', async () => {
    const e = montar();
    const ctx = await sembrar(e);
    await afirmacionMed(e, ctx, { id: 'a1', sostiene: true, debilita: true });
    await construirEce(e, ctx);
    const r = await e.op.ejecutar(ctx, 'x1', sol('orientar'));
    expect(r.producto.cuestionesJuicioHumano.join(' ')).toMatch(/corresponde a la persona/);
  });

  it('se abstiene cuando no hay materia para orientar', async () => {
    const e = montar();
    const ctx = await sembrar(e);
    await afirmacionMed(e, ctx, { id: 'a1', sostiene: true, respaldada: true }); // solo coherencia
    await construirEce(e, ctx);
    const r = await e.op.ejecutar(ctx, 'x1', sol('orientar'));
    expect(r.producto.abstenido).toBe(true);
    expect(r.producto.causaAbstencion).toBe('evidencia_insuficiente');
  });

  it('no desencadena efectos: MED, MDM y ECE quedan intactos', async () => {
    const e = montar();
    const ctx = await sembrar(e);
    await afirmacionMed(e, ctx, { id: 'a1', sostiene: true, debilita: true });
    await construirEce(e, ctx);
    const medV = (await e.med.estadoActual(ctx, 'm1')).version;
    const mdmV = (await e.mdm.estadoActual(ctx, 'w1')).version;
    const eceV = (await e.eceQuery.estadoActual(ctx, 'ece1')).version;
    await e.op.ejecutar(ctx, 'x1', sol('orientar'));
    expect((await e.med.estadoActual(ctx, 'm1')).version).toBe(medV);
    expect((await e.mdm.estadoActual(ctx, 'w1')).version).toBe(mdmV);
    expect((await e.eceQuery.estadoActual(ctx, 'ece1')).version).toBe(eceV);
  });
});
