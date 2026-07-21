import { describe, expect, it } from 'vitest';
import { afirmacionMed, cmdBase, construirEce, montar, sembrar, sol } from './helpers';

async function ecePara(cfg: { sostiene?: boolean; debilita?: boolean; respaldada?: boolean }) {
  const e = montar();
  const ctx = await sembrar(e);
  await afirmacionMed(e, ctx, { id: 'a1', ...cfg });
  await construirEce(e, ctx);
  return { e, ctx };
}

describe('Operación esclarecer', () => {
  it('esclarece una coherencia mostrando estructura y soporte', async () => {
    const { e, ctx } = await ecePara({ sostiene: true, respaldada: true });
    const r = await e.op.ejecutar(ctx, 'x1', sol('esclarecer', { objetivoElementoId: 'der:coherencia:MED:m1:a1' }));
    expect(r.producto.operacion).toBe('esclarecer');
    expect(r.producto.abstenido).toBe(false);
    if (r.producto.operacion === 'esclarecer') {
      expect(r.producto.esclarecimiento.contradiccionSinResolver).toBe(false);
      expect(r.producto.esclarecimiento.lados.length).toBeGreaterThanOrEqual(1);
    }
    expect(r.producto.razones.length).toBeGreaterThan(0);
  });

  it('esclarece una contradicción sin resolverla y reserva el juicio a la persona', async () => {
    const { e, ctx } = await ecePara({ sostiene: true, debilita: true });
    const r = await e.op.ejecutar(ctx, 'x1', sol('esclarecer', { objetivoElementoId: 'der:contradiccion:MED:m1:a1' }));
    if (r.producto.operacion === 'esclarecer') {
      expect(r.producto.esclarecimiento.contradiccionSinResolver).toBe(true);
    }
    expect(r.producto.cuestionesJuicioHumano.join(' ')).toMatch(/prevalece/);
  });

  it('esclarece una ausencia preservando lo faltante (no evaluable)', async () => {
    const { e, ctx } = await ecePara({});
    const r = await e.op.ejecutar(ctx, 'x1', sol('esclarecer', { objetivoElementoId: 'der:ausencia:MED:m1:a1' }));
    expect(r.producto.abstenido).toBe(false);
    expect(r.producto.faltante.length).toBeGreaterThan(0);
  });

  it('se abstiene si el objetivo no existe (ausencia crítica)', async () => {
    const { e, ctx } = await ecePara({});
    const r = await e.op.ejecutar(ctx, 'x1', sol('esclarecer', { objetivoElementoId: 'no-existe' }));
    expect(r.producto.abstenido).toBe(true);
    expect(r.producto.causaAbstencion).toBe('ausencia_critica');
    expect(r.producto.faltante.length).toBeGreaterThan(0);
  });

  it('se abstiene si no se indica objetivo (alcance insuficiente)', async () => {
    const { e, ctx } = await ecePara({});
    const r = await e.op.ejecutar(ctx, 'x1', sol('esclarecer'));
    expect(r.producto.abstenido).toBe(true);
    expect(r.producto.causaAbstencion).toBe('alcance_insuficiente');
  });

  it('esclarece sobre un corte histórico del ECE (no retroyección)', async () => {
    const e = montar();
    const ctx = await sembrar(e);
    await afirmacionMed(e, ctx, { id: 'a1' }); // pendiente → ausencia
    await construirEce(e, ctx);
    const corte = (await e.eceQuery.estadoActual(ctx, 'ece1')).construidoEn!;
    e.clock.advance(1000);
    // Cambia el MED y reconstruye: ahora sería coherencia.
    await e.med.incorporarEvidencia(ctx, { instanceId: 'm1', evidenciaId: 'a1-si', afirmacionId: 'a1', relacion: 'sostiene', procedencia: 'A', contenido: 'c', ...cmdBase });
    await e.med.revisarAfirmacion(ctx, { instanceId: 'm1', afirmacionId: 'a1', nuevoEstado: 'respaldada', motivo: 'ok', ...cmdBase });
    await construirEce(e, ctx);
    const r = await e.op.ejecutar(ctx, 'x1', sol('esclarecer', { objetivoElementoId: 'der:ausencia:MED:m1:a1', asOfRecordedAt: corte }));
    // En el corte pasado, la ausencia existía → se esclarece.
    expect(r.producto.abstenido).toBe(false);
    if (r.producto.operacion === 'esclarecer') expect(r.producto.esclarecimiento.elementoTipo).toBe('ausencia');
  });
});
