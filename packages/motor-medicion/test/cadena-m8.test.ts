/**
 * @soec/motor-medicion · tests · CADENA OPERACIONAL DE APRENDIZAJE (M7→M8→M9).
 *
 * M7 opera → observación → medición/evaluación → hipótesis → aprendizaje → recomendación → memoria → lectura
 * M9. Verifica la conexión completa y las separaciones esperado/observado/medido/aprendido.
 */
import { describe, expect, it } from 'vitest';
import { InMemoryEventStore, ctx, attr, O, montarTodo, ejecutarOrden, observar, evalEntrada } from './_setup';

describe('M8 · cadena operacional de aprendizaje', () => {
  it('ejecución → observación validada → evaluación → hipótesis RESPALDADA → aprendizaje → memoria', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    const ordenId = await ejecutarOrden(t.ordenes, c, t.v);

    // Observación autoritativa contra M7.
    const obs = await observar(t.observaciones, c, 'obs1', ordenId);
    expect(obs.estado).toBe('VALIDADA');
    expect(obs.datos?.naturaleza).toBe('SIMULADA');
    expect(obs.datos?.variante?.id).toBe('v1'); // materializado desde M7

    // Evaluación: resultado + hipótesis + atribución + recomendación.
    const ev = await t.evaluaciones.evaluar(c, 'eval1', evalEntrada('obs1'), attr, O);
    expect(ev.cuerpo?.resultado.estado).toBe('SUPERADO'); // valor 0.06 > meta 0.05
    expect(ev.cuerpo?.hipotesis?.estado).toBe('RESPALDADA');
    expect(ev.cuerpo?.hipotesis?.alcance).toBe('LOCAL_AL_EXPERIMENTO'); // nunca general desde un experimento
    expect(ev.cuerpo?.atribucion?.afirmaCausalidadReal).toBe(false);
    expect(ev.cuerpo?.recomendacion.estado).toBe('RECOMENDACION');

    // Aprendizaje canónico (local, sin capa reutilizable).
    const apr = await t.aprendizajesOp.aprenderDesde(c, 'apr1', 'eval1', attr, O);
    expect(apr?.aprendizajeId).toBe('apr1');
    const aprCanon = await t.aprendizajesOp.cargar(c, 'apr1');
    expect(aprCanon.existe).toBe(true);
    expect(aprCanon.reutilizable).toBeNull(); // un experimento no es transferible

    // Memoria / lectura M9.
    const memo = await t.lecturaM9.memoria(c);
    expect(memo.respaldadas).toContain('hip1');
    expect(memo.aprendizajesVigentes).toContain('apr1');
    expect(memo.simuladas).toBe(1);
    const evsM9 = await t.lecturaM9.listarEvaluaciones(c);
    expect(evsM9[0]?.medible).toBe(true);
  });

  it('idempotencia: registrar/observar/evaluar dos veces converge (mismo id)', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    const ordenId = await ejecutarOrden(t.ordenes, c, t.v);
    await observar(t.observaciones, c, 'obs1', ordenId);
    await t.evaluaciones.evaluar(c, 'eval1', evalEntrada('obs1'), attr, O);
    await t.evaluaciones.evaluar(c, 'eval1', evalEntrada('obs1'), attr, O); // idempotente
    expect((await t.evaluaciones.listarIds(c)).length).toBe(1);
  });
});
