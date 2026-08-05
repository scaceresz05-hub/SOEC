/**
 * @soec/cia · tests · RECONCILIACIÓN (BLOQUE 10). Detección/clasificación de inconsistencias, reparación
 * idempotente de reservas huérfanas y convergencia de dos reconciliadores concurrentes.
 */
import { describe, expect, it } from 'vitest';
import { montar, ctx, attr, O, HUMANO } from './_setup';

const CAP = 'captar-clientes-publicidad';

describe('CIA · reconciliador', () => {
  it('plan pendiente cuya autorización se revocó → REQUIERE_INTERVENCION', async () => {
    const m = montar(); const c = ctx();
    await m.autorizaciones.autorizar(c, CAP, { limite: 100000, nivelAutonomia: 'EJECUTAR_CON_APROBACION', actorHumano: HUMANO }, attr, O);
    await m.planificador.planificar(c, 'p1', { capacidadId: CAP, objetivo: 'x', costoEstimado: 1000 }, attr, O);
    await m.autorizaciones.revocar(c, CAP, attr, O);
    const h = await m.reconciliador.reconciliar(c, attr, O);
    expect(h.some((x) => x.clase === 'PLAN_SIN_AUTORIZACION_VIGENTE' && x.clasificacion === 'REQUIERE_INTERVENCION')).toBe(true);
    expect(h.some((x) => x.clase === 'REVOCACION_CON_PLANES_ACTIVOS')).toBe(true);
  });

  it('kill-switch con plan pendiente → KILL_CON_TRABAJOS_PENDIENTES', async () => {
    const m = montar(); const c = ctx();
    await m.autorizaciones.autorizar(c, CAP, { limite: 100000, nivelAutonomia: 'EJECUTAR_CON_APROBACION', actorHumano: HUMANO }, attr, O);
    await m.planificador.planificar(c, 'p2', { capacidadId: CAP, objetivo: 'x', costoEstimado: 1000 }, attr, O);
    await m.kill.activar(c, 'ORG', attr, O);
    const h = await m.reconciliador.reconciliar(c, attr, O);
    expect(h.some((x) => x.clase === 'KILL_CON_TRABAJOS_PENDIENTES')).toBe(true);
  });

  it('repara una reserva huérfana (RESERVADA con plan terminal) liberándola; idempotente', async () => {
    const m = montar(); const c = ctx();
    await m.autorizaciones.autorizar(c, CAP, { limite: 100000, nivelAutonomia: 'EJECUTAR_CON_APROBACION', actorHumano: HUMANO }, attr, O);
    // reserva manual sin plan asociado activo (huérfana)
    await m.presupuesto.reservar(c, 'huerfana', CAP, 1000, attr, O);
    const h1 = await m.reconciliador.reconciliar(c, attr, O);
    expect(h1.some((x) => x.clase === 'RESERVA_SIN_ACCION' && x.clasificacion === 'REPARADA')).toBe(true);
    expect((await m.presupuesto.cargar(c, 'huerfana')).estado).toBe('LIBERADA');
    // segunda pasada: ya no hay reserva pendiente que reparar (convergencia)
    const h2 = await m.reconciliador.reconciliar(c, attr, O);
    expect(h2.some((x) => x.clase === 'RESERVA_SIN_ACCION')).toBe(false);
  });

  it('dos reconciliadores concurrentes convergen al mismo estado', async () => {
    const m = montar(); const c = ctx();
    await m.autorizaciones.autorizar(c, CAP, { limite: 100000, nivelAutonomia: 'EJECUTAR_CON_APROBACION', actorHumano: HUMANO }, attr, O);
    await m.presupuesto.reservar(c, 'r', CAP, 500, attr, O);
    await Promise.all([m.reconciliador.reconciliar(c, attr, O), m.reconciliador.reconciliar(c, attr, O)]);
    expect((await m.presupuesto.cargar(c, 'r')).estado).toBe('LIBERADA'); // idempotente, converge
  });
});
