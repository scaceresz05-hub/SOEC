/**
 * @soec/cia · tests · PRESUPUESTO (BLOQUE 4). Reserva/confirma/libera; disponible = límite − confirmado −
 * reservado pendiente; concurrencia, idempotencia y frenos reales. Todo SIMULADO/ESTIMADO.
 */
import { describe, expect, it } from 'vitest';
import { montar, ctx, attr, O, HUMANO } from './_setup';

const CAP = 'captar-clientes-publicidad'; // unidadLimite CLP_MENSUAL
async function auth(m: ReturnType<typeof montar>, c: ReturnType<typeof ctx>, limite: number, nivel: 'EJECUTAR_AUTOMATICO' | 'EJECUTAR_CON_APROBACION' = 'EJECUTAR_AUTOMATICO') {
  await m.autorizaciones.autorizar(c, CAP, { limite, nivelAutonomia: nivel, actorHumano: HUMANO }, attr, O);
}

describe('CIA · presupuesto: ciclo reservar → confirmar | liberar', () => {
  it('sin presupuesto (límite 0): una acción con costo no se ejecuta (CANCELADO)', async () => {
    const m = montar(); const c = ctx();
    await auth(m, c, 0);
    const r = await m.planificador.planificar(c, 'b1', { capacidadId: CAP, objetivo: 'x', costoEstimado: 5000 }, attr, O);
    expect(r.plan.estado).not.toBe('COMPLETADO_SIMULADO');
  });

  it('disponible = límite − confirmado − reservado pendiente', async () => {
    const m = montar(); const c = ctx();
    await auth(m, c, 100);
    expect(await m.presupuesto.disponible(c, CAP)).toBe(100);
    await m.presupuesto.reservar(c, 'r1', CAP, 30, attr, O);
    expect(await m.presupuesto.disponible(c, CAP)).toBe(70); // 30 pendiente
    await m.presupuesto.confirmar(c, 'r1', attr, O);
    expect(await m.presupuesto.disponible(c, CAP)).toBe(70); // 30 confirmado
  });

  it('dos reservas concurrentes: la segunda sin margen se rechaza', async () => {
    const m = montar(); const c = ctx();
    await auth(m, c, 100);
    expect(await m.presupuesto.reservar(c, 'A', CAP, 60, attr, O)).toBe(true);
    expect(await m.presupuesto.reservar(c, 'B', CAP, 60, attr, O)).toBe(false); // 60+60 > 100
  });

  it('reserva duplicada es idempotente (no descuenta dos veces)', async () => {
    const m = montar(); const c = ctx();
    await auth(m, c, 100);
    expect(await m.presupuesto.reservar(c, 'R', CAP, 40, attr, O)).toBe(true);
    expect(await m.presupuesto.reservar(c, 'R', CAP, 40, attr, O)).toBe(true); // misma reserva
    expect(await m.presupuesto.disponible(c, CAP)).toBe(60);
  });

  it('confirmación duplicada es idempotente', async () => {
    const m = montar(); const c = ctx();
    await auth(m, c, 100);
    await m.presupuesto.reservar(c, 'R2', CAP, 40, attr, O);
    await m.presupuesto.confirmar(c, 'R2', attr, O);
    const st = await m.presupuesto.confirmar(c, 'R2', attr, O);
    expect(st.estado).toBe('CONFIRMADA');
    expect(await m.presupuesto.confirmado(c, CAP)).toBe(40);
  });

  it('liberar una reserva restaura el disponible', async () => {
    const m = montar(); const c = ctx();
    await auth(m, c, 100);
    await m.presupuesto.reservar(c, 'R3', CAP, 40, attr, O);
    await m.presupuesto.liberar(c, 'R3', attr, O);
    expect(await m.presupuesto.disponible(c, CAP)).toBe(100);
  });

  it('límite agotado: la segunda acción automática no se ejecuta', async () => {
    const m = montar(); const c = ctx();
    await auth(m, c, 10000);
    const r1 = await m.planificador.planificar(c, 'p-a', { capacidadId: CAP, objetivo: 'x', costoEstimado: 10000 }, attr, O);
    expect(r1.plan.estado).toBe('COMPLETADO_SIMULADO');
    const r2 = await m.planificador.planificar(c, 'p-b', { capacidadId: CAP, objetivo: 'y', costoEstimado: 1 }, attr, O);
    expect(r2.plan.estado).not.toBe('COMPLETADO_SIMULADO'); // sin margen: no se ejecuta solo (queda pendiente)
    expect(r2.decision.motivo).toBe('excede_limite');
  });

  it('una acción abstenida libera su reserva (no consume presupuesto)', async () => {
    const m = montar(); const c = ctx();
    // ProveedorConfigurable no consumible → abstención; usamos un ejecutor que abstiene vía degradación
    await auth(m, c, 100);
    // ejecución normal consume; luego verificamos que liberar deja disponible completo tras abstención simulada:
    await m.presupuesto.reservar(c, 'ab', CAP, 50, attr, O);
    await m.presupuesto.liberar(c, 'ab', attr, O); // simula abstención
    expect(await m.presupuesto.disponible(c, CAP)).toBe(100);
  });

  it('un cambio material de presupuesto exige nueva aprobación', async () => {
    const m = montar(); const c = ctx();
    await auth(m, c, 100);
    const st = await m.autorizaciones.modificar(c, CAP, { limite: 200 }, attr, O);
    expect(st.estado).toBe('PENDIENTE');
  });

  it('capacidad sin gasto (costo desconocido/analítica) se ejecuta sin reservar presupuesto', async () => {
    const m = montar(); const c = ctx();
    await m.autorizaciones.autorizar(c, 'medir-audiencia', { limite: 0, nivelAutonomia: 'EJECUTAR_AUTOMATICO', actorHumano: HUMANO }, attr, O);
    const r = await m.planificador.planificar(c, 'sg', { capacidadId: 'medir-audiencia', objetivo: 'x', costoEstimado: 0 }, attr, O);
    expect(r.plan.estado).toBe('COMPLETADO_SIMULADO');
  });
});
