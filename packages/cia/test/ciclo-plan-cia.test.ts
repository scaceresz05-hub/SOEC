/**
 * @soec/cia · tests · CICLO DE VIDA DEL PLAN (BLOQUE 3). FSM, idempotencia lógica vs. intento vs. proveedor,
 * conflicto de contenido, cancelación/obsolescencia y descarte de respuestas tardías.
 */
import { describe, expect, it } from 'vitest';
import { ConflictoIdempotenciaError } from '../src/index';
import { montar, ctx, attr, O, HUMANO } from './_setup';

const CAP = 'dar-a-conocer-marca';
async function autorizar(m: ReturnType<typeof montar>, c: ReturnType<typeof ctx>, nivel: 'EJECUTAR_CON_APROBACION' | 'EJECUTAR_AUTOMATICO') {
  await m.autorizaciones.autorizar(c, CAP, { limite: 100000, nivelAutonomia: nivel, actorHumano: HUMANO }, attr, O);
}

describe('CIA · ciclo de vida del plan', () => {
  it('con aprobación: PROPUESTO → PENDIENTE_APROBACION → (aprobar) → COMPLETADO_SIMULADO', async () => {
    const m = montar(); const c = ctx();
    await autorizar(m, c, 'EJECUTAR_CON_APROBACION');
    const r = await m.planificador.planificar(c, 'p1', { capacidadId: CAP, objetivo: 'x', costoEstimado: 1000 }, attr, O);
    expect(r.plan.estado).toBe('PENDIENTE_APROBACION');
    const st = await m.planificador.aprobar(c, 'p1', HUMANO, attr, O);
    expect(st.estado).toBe('COMPLETADO_SIMULADO');
    expect(st.aprobadoPor).toBe(HUMANO);
  });

  it('automático dentro de política ejecuta solo hasta COMPLETADO_SIMULADO', async () => {
    const m = montar(); const c = ctx();
    await autorizar(m, c, 'EJECUTAR_AUTOMATICO');
    const r = await m.planificador.planificar(c, 'p2', { capacidadId: CAP, objetivo: 'x', costoEstimado: 1000 }, attr, O);
    expect(r.plan.estado).toBe('COMPLETADO_SIMULADO');
  });

  it('idempotencia lógica: misma clave + mismo contenido converge en el mismo plan', async () => {
    const m = montar(); const c = ctx();
    await autorizar(m, c, 'EJECUTAR_CON_APROBACION');
    await m.planificador.planificar(c, 'p3', { capacidadId: CAP, objetivo: 'x', costoEstimado: 1000, claveLogica: 'k' }, attr, O);
    const r = await m.planificador.planificar(c, 'p3-bis', { capacidadId: CAP, objetivo: 'x', costoEstimado: 1000, claveLogica: 'k' }, attr, O);
    expect(r.plan.planId).toBe('p3'); // convergió, no creó otro
  });

  it('conflicto: misma clave + contenido distinto lanza ConflictoIdempotenciaError', async () => {
    const m = montar(); const c = ctx();
    await autorizar(m, c, 'EJECUTAR_CON_APROBACION');
    await m.planificador.planificar(c, 'p4', { capacidadId: CAP, objetivo: 'x', costoEstimado: 1000, claveLogica: 'k4' }, attr, O);
    await expect(m.planificador.planificar(c, 'p4-bis', { capacidadId: CAP, objetivo: 'DISTINTO', costoEstimado: 1000, claveLogica: 'k4' }, attr, O))
      .rejects.toBeInstanceOf(ConflictoIdempotenciaError);
  });

  it('cancelar un plan no terminal lo lleva a CANCELADO; obsoletar a OBSOLETO', async () => {
    const m = montar(); const c = ctx();
    await autorizar(m, c, 'EJECUTAR_CON_APROBACION');
    await m.planificador.planificar(c, 'p5', { capacidadId: CAP, objetivo: 'x', costoEstimado: 1000 }, attr, O);
    expect((await m.planificador.cancelar(c, 'p5', attr, O)).estado).toBe('CANCELADO');
    await m.planificador.planificar(c, 'p6', { capacidadId: CAP, objetivo: 'y', costoEstimado: 1000 }, attr, O);
    expect((await m.planificador.obsoletar(c, 'p6', attr, O)).estado).toBe('OBSOLETO');
  });

  it('no autoaprueba cuando la política exige decisión humana', async () => {
    const m = montar(); const c = ctx();
    await autorizar(m, c, 'EJECUTAR_CON_APROBACION');
    const r = await m.planificador.planificar(c, 'p7', { capacidadId: CAP, objetivo: 'x', costoEstimado: 1000 }, attr, O);
    expect(r.plan.estado).toBe('PENDIENTE_APROBACION'); // no ejecutó solo
    expect(r.plan.aprobadoPor).toBeNull();
  });
});
