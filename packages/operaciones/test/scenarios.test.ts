import { describe, expect, it } from 'vitest';
import { afirmacionMed, construirEce, montar, registrarBrecha, sembrar, sol } from './helpers';

describe('Escenarios sintéticos de operaciones (§26)', () => {
  it('A — Esclarecer una contradicción: muestra ambos lados sin resolver', async () => {
    const e = montar();
    const ctx = await sembrar(e);
    await afirmacionMed(e, ctx, { id: 'a1', sostiene: true, debilita: true });
    await construirEce(e, ctx);
    const r = await e.op.ejecutar(ctx, 'a', sol('esclarecer', { objetivoElementoId: 'der:contradiccion:MED:m1:a1' }));
    if (r.producto.operacion === 'esclarecer') {
      expect(r.producto.esclarecimiento.contradiccionSinResolver).toBe(true);
      expect(r.producto.esclarecimiento.lados.length).toBeGreaterThanOrEqual(1);
    }
    expect(r.producto.procedencia).toBeTruthy();
    expect(r.producto.evidencia.length).toBeGreaterThan(0);
  });

  it('B — Detectar una señal: conserva sustento y declara incertidumbre', async () => {
    const e = montar();
    const ctx = await sembrar(e);
    await afirmacionMed(e, ctx, { id: 'a1', sostiene: true, debilita: true });
    await construirEce(e, ctx);
    const r = await e.op.ejecutar(ctx, 'b', sol('detectar'));
    if (r.producto.operacion === 'detectar') {
      expect(r.producto.deteccion.senales.length).toBe(1);
      expect(r.producto.deteccion.senales[0]?.entradas.length).toBeGreaterThan(0);
      expect(r.producto.deteccion.senales[0]?.incertidumbre).toBeTruthy();
    }
  });

  it('C — Abstención por ausencia: muestra exactamente qué falta', async () => {
    const e = montar();
    const ctx = await sembrar(e);
    await afirmacionMed(e, ctx, { id: 'a1', sostiene: true, respaldada: true }); // solo coherencia
    await construirEce(e, ctx);
    const r = await e.op.ejecutar(ctx, 'c', sol('orientar'));
    expect(r.producto.abstenido).toBe(true);
    expect(r.producto.faltante.length).toBeGreaterThan(0);
  });

  it('D — Proyectar escenarios: supuestos e incertidumbre, sin certeza', async () => {
    const e = montar();
    const ctx = await sembrar(e);
    await construirEce(e, ctx);
    await registrarBrecha(e, ctx);
    const r = await e.op.ejecutar(ctx, 'd', sol('proyectar', { horizonte: '1 año' }));
    if (r.producto.operacion === 'proyectar') {
      expect(r.producto.proyeccion.escenarios.length).toBeGreaterThanOrEqual(2);
      expect(r.producto.proyeccion.supuestos.length).toBeGreaterThan(0);
    }
  });

  it('E — Orientar sin decidir: consideraciones y cuestiones reservadas', async () => {
    const e = montar();
    const ctx = await sembrar(e);
    await afirmacionMed(e, ctx, { id: 'a1', sostiene: true, debilita: true });
    await construirEce(e, ctx);
    const r = await e.op.ejecutar(ctx, 'e', sol('orientar'));
    if (r.producto.operacion === 'orientar') {
      expect(r.producto.orientacion.noVinculante).toBe(true);
      expect(r.producto.orientacion.cuestionesReservadas.length).toBeGreaterThan(0);
    }
    expect(r.producto.bindingDecision).toBe(false);
  });

  it('F — Cambio histórico: nueva versión del ECE da producto distinto; el anterior permanece', async () => {
    const e = montar();
    const ctx = await sembrar(e);
    await afirmacionMed(e, ctx, { id: 'a1', sostiene: true, respaldada: true }); // coherencia
    await construirEce(e, ctx);
    const antes = await e.op.ejecutar(ctx, 'f1', sol('detectar')); // sin señales

    e.clock.advance(1000);
    await afirmacionMed(e, ctx, { id: 'a2', sostiene: true, debilita: true }); // contradicción
    await construirEce(e, ctx); // reconstruido
    const despues = await e.op.ejecutar(ctx, 'f2', sol('detectar')); // con señal

    const nAntes = antes.producto.operacion === 'detectar' ? antes.producto.deteccion.senales.length : -1;
    const nDespues = despues.producto.operacion === 'detectar' ? despues.producto.deteccion.senales.length : -1;
    expect(nAntes).toBe(0);
    expect(nDespues).toBe(1);
    // El producto anterior permanece intacto (no se recalcula con conocimiento posterior).
    const f1 = await e.opQuery.producto(ctx, 'f1');
    expect(f1?.operacion === 'detectar' && f1.deteccion.senales.length).toBe(0);
  });

  it('G — Reemplazo de mecanismo: mismo contrato, distinta infraestructura', async () => {
    const e = montar();
    const ctx = await sembrar(e);
    await afirmacionMed(e, ctx, { id: 'a1', sostiene: true, debilita: true });
    await construirEce(e, ctx);
    const det = await e.op.ejecutar(ctx, 'g1', sol('detectar', { mecanismo: 'determinístico' }));
    const ia = await e.op.ejecutar(ctx, 'g2', sol('detectar', { mecanismo: 'ia-simulada', dataPolicy: 'may-leave-org' }));
    // Distinto mecanismo, misma identidad y anatomía de operación.
    expect(det.producto.mecanismo).toBe('determinístico');
    expect(ia.producto.mecanismo).toBe('ia-simulada');
    expect(det.producto.operacion).toBe('detectar');
    expect(ia.producto.operacion).toBe('detectar');
    expect(det.producto.bindingDecision).toBe(false);
    expect(ia.producto.bindingDecision).toBe(false);
  });

  it('H — No efecto: una ejecución no modifica MED, MDM ni ECE', async () => {
    const e = montar();
    const ctx = await sembrar(e);
    await afirmacionMed(e, ctx, { id: 'a1', sostiene: true, debilita: true });
    await construirEce(e, ctx);
    const v = {
      med: (await e.med.estadoActual(ctx, 'm1')).version,
      mdm: (await e.mdm.estadoActual(ctx, 'w1')).version,
      ece: (await e.eceQuery.estadoActual(ctx, 'ece1')).version,
    };
    for (const op of ['esclarecer', 'detectar', 'proyectar', 'orientar'] as const) {
      await e.op.ejecutar(ctx, `h-${op}`, sol(op, op === 'esclarecer' ? { objetivoElementoId: 'der:contradiccion:MED:m1:a1' } : {}));
    }
    expect((await e.med.estadoActual(ctx, 'm1')).version).toBe(v.med);
    expect((await e.mdm.estadoActual(ctx, 'w1')).version).toBe(v.mdm);
    expect((await e.eceQuery.estadoActual(ctx, 'ece1')).version).toBe(v.ece);
  });
});
