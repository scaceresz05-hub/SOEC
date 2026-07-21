import { describe, expect, it } from 'vitest';
import { attr, ctxFor, fechaInicio, montar, now, sembrarDemo } from './helpers';
import { IDS_DEMO, objetivoDemo, optsDemo } from '../src/fixtures';

describe('Vertical de marketing — objetivo → plan → acción → autorización → simulación → replanificación', () => {
  it('genera un plan versionado, persistido y ejecutable', async () => {
    const m = montar();
    const { ctx, plan } = await sembrarDemo(m);
    expect(plan.existe).toBe(true);
    expect(plan.planVersion).toBe(1);
    expect(plan.iniciativas.length).toBeGreaterThanOrEqual(1);
    expect(plan.campanias.length).toBe(objetivoDemo.canales.length);
    expect(Object.keys(plan.actividades).length).toBeGreaterThan(0);
    expect(plan.calendario).not.toBeNull();
    expect(plan.presupuesto?.total).toBe(objetivoDemo.presupuestoTotal);
    void ctx;
  });

  it('ejecuta la próxima acción autorizada a través del plano operacional (efecto simulado)', async () => {
    const m = montar();
    const { ctx } = await sembrarDemo(m);
    const r = await m.planning.ejecutarSiguiente(ctx, IDS_DEMO.plan, attr, now);
    expect(r.permitida).toBe(true);
    expect(r.resultado).toContain('simulado');
    // La acción pasó por el plano operacional real y quedó verificada (efecto simulado).
    const acc = await m.operational.accion(ctx, `${IDS_DEMO.plan}:${r.actividad}`);
    expect(acc.estado).toBe('verificada');
    expect(acc.efecto?.simulado).toBe(true);
  });

  it('una acción con afirmación prohibida es DENEGADA por la política al ejecutarse', async () => {
    const m = montar();
    const { ctx } = await sembrarDemo(m);
    await m.planning.ejecutarSiguiente(ctx, IDS_DEMO.plan, attr, now); // blog permitido
    const r = await m.planning.ejecutarSiguiente(ctx, IDS_DEMO.plan, attr, now); // meta_ads denegado
    expect(r.permitida).toBe(false);
    expect(r.motivo).toBe('afirmacion_prohibida');
  });

  it('las actividades bloqueadas no se seleccionan para ejecutar', async () => {
    const m = montar();
    const { ctx, plan } = await sembrarDemo(m);
    const bloqueadas = Object.values(plan.actividades).filter((a) => a.estado === 'bloqueada');
    expect(bloqueadas.length).toBeGreaterThan(0); // youtube + blog_tecnico
    const sig = await m.planning.siguiente(ctx, IDS_DEMO.plan);
    expect(sig?.estado).toBe('autorizable');
  });

  it('replanifica produciendo una nueva versión sin perder la historia', async () => {
    const m = montar();
    const { ctx } = await sembrarDemo(m);
    const r = await m.planning.replanificar(ctx, { planId: IDS_DEMO.plan, motivo: 'ajuste tras denegación', evidencia: 'meta_ads denegado por afirmación', attribution: attr, occurredAt: now });
    expect(r.planVersion).toBe(2);
    expect(r.historial.map((h) => h.planVersion)).toEqual([1, 2]);
    expect(r.historial[1]?.motivo).toContain('ajuste');
  });

  it('pausa detiene la ejecución y reanuda la habilita', async () => {
    const m = montar();
    const { ctx } = await sembrarDemo(m);
    await m.planning.pausar(ctx, IDS_DEMO.plan, 'pausa del dueño', attr, now);
    await expect(m.planning.ejecutarSiguiente(ctx, IDS_DEMO.plan, attr, now)).rejects.toThrow();
    await m.planning.reanudar(ctx, IDS_DEMO.plan, attr, now);
    const r = await m.planning.ejecutarSiguiente(ctx, IDS_DEMO.plan, attr, now);
    expect(r.permitida).toBe(true);
  });

  it('es idempotente: generar el mismo plan no duplica', async () => {
    const m = montar();
    const { ctx } = await sembrarDemo(m);
    const otra = await m.planning.generarPlan(ctx, { planId: IDS_DEMO.plan, objetivoId: IDS_DEMO.objetivo, policyId: IDS_DEMO.politica, fechaInicio, opts: optsDemo, attribution: attr, occurredAt: now });
    expect(otra.planVersion).toBe(1);
  });

  it('aísla por organización', async () => {
    const m = montar();
    await sembrarDemo(m, ctxFor('orgA'));
    expect((await m.planning.cargar(ctxFor('orgB'), IDS_DEMO.plan)).existe).toBe(false);
  });
});
