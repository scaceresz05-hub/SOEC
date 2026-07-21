import { describe, expect, it } from 'vitest';
import { accionOk, attr, ctxFor, montar, now, politicaBase, politicaVigente } from './helpers';

const cmd = (over: object) => ({ attribution: attr, occurredAt: now, ...over });

describe('Vertical operativa — política → autorización → ejecución simulada → verificación', () => {
  it('ejecuta una acción autorizada mediante adaptador simulado, verificada y trazable', async () => {
    const m = montar();
    const ctx = await ctxFor('orgA');
    await politicaVigente(m, ctx);
    const r = await m.op.ejecutar(ctx, cmd({ executionId: 'a1', policyId: 'pol-1', accion: accionOk }) as never);
    expect(r.decision.permitida).toBe(true);
    expect(r.ejecutada).toBe(true);
    expect(r.state.estado).toBe('verificada');
    expect(r.state.efecto?.simulado).toBe(true); // NUNCA efecto real
    expect(r.state.verificado).toBe(true);
    // Trazabilidad completa.
    expect(r.state.policyId).toBe('pol-1');
    expect(r.state.policyVersion).toBe(1);
    expect(r.state.accion?.productoIntelectualRef).toBe('ce-comprender-estado-1');
  });

  it('deniega una acción no autorizada SIN producir efecto alguno', async () => {
    const m = montar();
    const ctx = ctxFor('orgA');
    await politicaVigente(m, ctx);
    const r = await m.op.ejecutar(ctx, cmd({ executionId: 'a1', policyId: 'pol-1', accion: { ...accionOk, canal: 'tiktok' } }) as never);
    expect(r.decision.permitida).toBe(false);
    expect(r.state.estado).toBe('denegada');
    expect(r.ejecutada).toBe(false);
    expect(r.state.efecto).toBeNull(); // ningún efecto
  });

  it('ninguna acción se ejecuta sin política vigente', async () => {
    const m = montar();
    const ctx = ctxFor('orgA');
    const r = await m.op.ejecutar(ctx, cmd({ executionId: 'a1', policyId: 'inexistente', accion: accionOk }) as never);
    expect(r.decision.motivo).toBe('sin_politica');
    expect(r.state.efecto).toBeNull();
  });

  it('es idempotente por identidad de ejecución (no re-ejecuta ni duplica)', async () => {
    const m = montar();
    const ctx = ctxFor('orgA');
    await politicaVigente(m, ctx);
    const r1 = await m.op.ejecutar(ctx, cmd({ executionId: 'a1', policyId: 'pol-1', accion: accionOk, idempotencyKey: 'k1' }) as never);
    const r2 = await m.op.ejecutar(ctx, cmd({ executionId: 'a1', policyId: 'pol-1', accion: accionOk, idempotencyKey: 'k1' }) as never);
    expect(r2.state.version).toBe(r1.state.version);
    expect(r2.state.efecto?.externalId).toBe(r1.state.efecto?.externalId);
  });

  it('respeta el presupuesto acumulado de la política', async () => {
    const m = montar();
    const ctx = ctxFor('orgA');
    await politicaVigente(m, ctx, 'pol-1', { ...politicaBase, presupuestoTotal: 100, riesgoPorAccion: { anuncio: 'bajo' }, canalesAutorizados: ['instagram'] });
    const anuncio = { tipo: 'anuncio', canal: 'instagram', contenido: 'promo', costo: 60, productoIntelectualRef: 'r' };
    const r1 = await m.op.ejecutar(ctx, cmd({ executionId: 'a1', policyId: 'pol-1', accion: anuncio }) as never);
    expect(r1.ejecutada).toBe(true);
    const r2 = await m.op.ejecutar(ctx, cmd({ executionId: 'a2', policyId: 'pol-1', accion: anuncio }) as never);
    expect(r2.decision.motivo).toBe('presupuesto_excedido'); // 60 + 60 > 100
    expect(r2.state.efecto).toBeNull();
  });

  it('la suspensión de la política detiene la ejecución (interruptor de pausa)', async () => {
    const m = montar();
    const ctx = ctxFor('orgA');
    await politicaVigente(m, ctx);
    await m.policies.suspender(ctx, 'pol-1', 'pausa', attr, now);
    const r = await m.op.ejecutar(ctx, cmd({ executionId: 'a1', policyId: 'pol-1', accion: accionOk }) as never);
    expect(r.decision.motivo).toBe('politica_no_vigente');
    expect(r.state.efecto).toBeNull();
  });

  it('permite revertir una acción ejecutada (reversibilidad simulada)', async () => {
    const m = montar();
    const ctx = ctxFor('orgA');
    await politicaVigente(m, ctx);
    await m.op.ejecutar(ctx, cmd({ executionId: 'a1', policyId: 'pol-1', accion: accionOk }) as never);
    const st = await m.op.revertir(ctx, 'a1', 'corrección del dueño', attr, now);
    expect(st.revertida).toBe(true);
    expect(st.estado).toBe('revertida');
  });

  it('aísla por organización', async () => {
    const m = montar();
    await politicaVigente(m, ctxFor('orgA'));
    await m.op.ejecutar(ctxFor('orgA'), cmd({ executionId: 'a1', policyId: 'pol-1', accion: accionOk }) as never);
    expect((await m.op.accion(ctxFor('orgB'), 'a1')).existe).toBe(false);
  });
});
