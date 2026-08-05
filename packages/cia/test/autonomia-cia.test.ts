/**
 * @soec/cia · tests · AUTONOMÍA EJECUTABLE (BLOQUE 5). Los cuatro niveles gobiernan el flujo; subir la
 * autonomía nunca elude presupuesto, kill-switch ni las decisiones reservadas (riesgo alto/irreversible).
 */
import { describe, expect, it } from 'vitest';
import { montar, ctx, attr, O, HUMANO } from './_setup';

const CAP = 'dar-a-conocer-marca';

describe('CIA · autonomía como política ejecutable', () => {
  it('SOLO_OBSERVAR no crea acciones ejecutables', async () => {
    const m = montar(); const c = ctx();
    await m.autorizaciones.autorizar(c, CAP, { limite: 100000, nivelAutonomia: 'SOLO_OBSERVAR', actorHumano: HUMANO }, attr, O);
    const r = await m.planificador.planificar(c, 'o1', { capacidadId: CAP, objetivo: 'x', costoEstimado: 100 }, attr, O);
    expect(r.decision.permitido).toBe(false);
    expect(r.decision.motivo).toBe('solo_observar');
  });

  it('RECOMENDAR y EJECUTAR_CON_APROBACION dejan el plan pendiente (nunca ejecutan solos)', async () => {
    for (const nivel of ['RECOMENDAR', 'EJECUTAR_CON_APROBACION'] as const) {
      const m = montar(); const c = ctx();
      await m.autorizaciones.autorizar(c, CAP, { limite: 100000, nivelAutonomia: nivel, actorHumano: HUMANO }, attr, O);
      const r = await m.planificador.planificar(c, 'p', { capacidadId: CAP, objetivo: 'x', costoEstimado: 100 }, attr, O);
      expect(r.plan.estado).toBe('PENDIENTE_APROBACION');
    }
  });

  it('EJECUTAR_AUTOMATICO ejecuta solo dentro de políticas (reversible, simulado, con margen)', async () => {
    const m = montar(); const c = ctx();
    await m.autorizaciones.autorizar(c, CAP, { limite: 100000, nivelAutonomia: 'EJECUTAR_AUTOMATICO', actorHumano: HUMANO }, attr, O);
    const r = await m.planificador.planificar(c, 'a', { capacidadId: CAP, objetivo: 'x', costoEstimado: 100 }, attr, O);
    expect(r.plan.estado).toBe('COMPLETADO_SIMULADO');
  });

  it('riesgo ALTO queda reservado al humano AUNQUE el nivel sea automático', async () => {
    const m = montar(); const c = ctx();
    await m.autorizaciones.autorizar(c, CAP, { limite: 100000, nivelAutonomia: 'EJECUTAR_AUTOMATICO', actorHumano: HUMANO, riesgo: 'alto' }, attr, O);
    const r = await m.planificador.planificar(c, 'hr', { capacidadId: CAP, objetivo: 'x', costoEstimado: 100 }, attr, O);
    expect(r.decision.ejecutableAuto).toBe(false);
    expect(r.plan.estado).toBe('PENDIENTE_APROBACION'); // no se ejecuta sola
  });

  it('subir la autonomía NO elude el kill-switch', async () => {
    const m = montar(); const c = ctx();
    await m.autorizaciones.autorizar(c, CAP, { limite: 100000, nivelAutonomia: 'EJECUTAR_AUTOMATICO', actorHumano: HUMANO }, attr, O);
    await m.kill.activar(c, 'ORG', attr, O);
    const r = await m.planificador.planificar(c, 'k', { capacidadId: CAP, objetivo: 'x', costoEstimado: 100 }, attr, O);
    expect(r.decision.motivo).toBe('kill_switch'); // el nivel automático no gana al kill
  });

  it('subir la autonomía NO elude el presupuesto', async () => {
    const m = montar(); const c = ctx();
    await m.autorizaciones.autorizar(c, 'captar-clientes-publicidad', { limite: 100, nivelAutonomia: 'EJECUTAR_AUTOMATICO', actorHumano: HUMANO }, attr, O);
    const r = await m.planificador.planificar(c, 'b', { capacidadId: 'captar-clientes-publicidad', objetivo: 'x', costoEstimado: 5000 }, attr, O);
    expect(r.decision.motivo).toBe('excede_limite'); // el nivel automático no gana al límite
  });
});
