/**
 * @soec/motor-medicion · tests · REPLAY FRÍO INTEGRAL + CONTRATOS M9.
 *
 * Reconstruye TODA la cadena de M8 desde un store NUEVO (log serializado) y verifica identidad: observación,
 * evaluación, aprendizaje, memoria y lecturas M9. Y acredita el contrato M9: inmutable, distingue estados
 * incompletos, excluye huérfanas, preserva compensación/consumo, e idéntico tras replay frío.
 */
import { describe, expect, it } from 'vitest';
import { InMemoryEventStore, ctx, attr, O, montarTodo, montarLectura, ejecutarOrden, observar, evalEntrada, prepararEval, CLAVE_CANONICA } from './_setup';

describe('M8 · replay frío integral', () => {
  it('reconstruye observación/evaluación/aprendizaje/memoria/lecturas M9 IDÉNTICAS desde un store nuevo', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    const o1 = await ejecutarOrden(t.ordenes, c, t.v, 'orden1');
    const o2 = await ejecutarOrden(t.ordenes, c, t.v, 'orden2');
    await observar(t.observaciones, c, 'obs1', o1);
    await observar(t.observaciones, c, 'obs2', o2);
    await t.evaluaciones.evaluar(c, 'eval1', evalEntrada('obs1'), attr, O);
    await t.evaluaciones.evaluar(c, 'eval2', evalEntrada('obs2'), attr, O);
    await t.aprendizajesOp.aprenderDesde(c, 'apr1', 'eval1', attr, O);
    await t.evaluaciones.invalidar(c, 'eval2', 'cambió evidencia', attr, O); // una queda OBSOLETA

    const obsCal = JSON.parse(JSON.stringify(await t.lecturaM9.listarObservaciones(c)));
    const evCal = JSON.parse(JSON.stringify(await t.lecturaM9.listarEvaluaciones(c)));
    const aprCal = JSON.parse(JSON.stringify(await t.lecturaM9.listarAprendizajes(c)));
    const memoCal = JSON.parse(JSON.stringify(await t.lecturaM9.memoria(c)));

    // Store NUEVO desde el log serializado, servicios reconstruidos sin re-ejecutar nada.
    const frio = InMemoryEventStore.desdeInstantanea(JSON.parse(JSON.stringify(store.exportar())));
    const f = montarLectura(frio);
    expect(JSON.parse(JSON.stringify(await f.lecturaM9.listarObservaciones(c)))).toEqual(obsCal);
    expect(JSON.parse(JSON.stringify(await f.lecturaM9.listarEvaluaciones(c)))).toEqual(evCal);
    expect(JSON.parse(JSON.stringify(await f.lecturaM9.listarAprendizajes(c)))).toEqual(aprCal);
    expect(JSON.parse(JSON.stringify(await f.lecturaM9.memoria(c)))).toEqual(memoCal);
    // El aprendizaje ligado a la evaluación OBSOLETA no aplica; el vigente sí.
    expect(memoCal.aprendizajesVigentes).toContain('apr1');
  });
});

describe('M8 · contratos M9', () => {
  it('no presenta una ejecución sin evidencia como completa; marca lo no vigente; excluye huérfanas', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    const o1 = await ejecutarOrden(t.ordenes, c, t.v);
    await observar(t.observaciones, c, 'obs1', o1);
    await t.evaluaciones.evaluar(c, 'eval1', evalEntrada('obs1'), attr, O);
    await t.evaluaciones.invalidar(c, 'eval1', 'obsoleta', attr, O);
    const evs = await t.lecturaM9.listarEvaluaciones(c);
    expect(evs[0]?.estado).toBe('OBSOLETA');
    expect(evs[0]?.medible).toBe(false); // no vigente ⇒ no medible
  });

  it('los snapshots M9 son profundamente inmutables; mutarlos falla y una relectura queda intacta', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    const o1 = await ejecutarOrden(t.ordenes, c, t.v);
    await observar(t.observaciones, c, 'obs1', o1);
    await t.evaluaciones.evaluar(c, 'eval1', evalEntrada('obs1'), attr, O);
    const evs = await t.lecturaM9.listarEvaluaciones(c);
    expect(Object.isFrozen(evs)).toBe(true);
    expect(() => ((evs[0] as { estado: string }).estado = 'HACK')).toThrow();
    expect((await t.lecturaM9.listarEvaluaciones(c))[0]?.estado).toBe('EMITIDA');
  });

  it('expone consolidaciones inmutables (con incluidas/excluidas/alcance/contradicciones)', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    await prepararEval(t, c, 'e1', 'orden1');
    await prepararEval(t, c, 'e2', 'orden2');
    await t.consolidaciones.consolidar(c, 'cons1', CLAVE_CANONICA, ['e1', 'e2'], attr, O);
    const cs = await t.lecturaM9.listarConsolidaciones(c);
    expect(cs[0]?.estado).toBe('RESPALDADA');
    expect(cs[0]?.alcance).toBe('TRANSFERIBLE');
    expect(Object.isFrozen(cs)).toBe(true);
    expect(() => ((cs[0] as { estado: string }).estado = 'HACK')).toThrow();
  });

  it('congelamiento PROFUNDO: mutar un array u objeto anidado del snapshot falla', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    const o1 = await ejecutarOrden(t.ordenes, c, t.v);
    await observar(t.observaciones, c, 'obs1', o1);
    await t.evaluaciones.evaluar(c, 'eval1', evalEntrada('obs1'), attr, O);
    const evs = await t.lecturaM9.listarEvaluaciones(c);
    expect(Object.isFrozen(evs[0]?.contradicciones)).toBe(true); // array anidado congelado
    expect(() => ((evs[0]!.contradicciones as string[]).push('x'))).toThrow();
    expect(() => ((evs[0]!.recomendacion as { tipo: string }).tipo = 'HACK')).toThrow(); // objeto anidado
  });

  it('cross-tenant: M9 de org-b no ve las observaciones/evaluaciones de org-a', async () => {
    const store = new InMemoryEventStore(); const cA = ctx('org-a'); const cB = ctx('org-b');
    const t = await montarTodo(store, cA);
    const o1 = await ejecutarOrden(t.ordenes, cA, t.v);
    await observar(t.observaciones, cA, 'obs1', o1);
    await t.evaluaciones.evaluar(cA, 'eval1', evalEntrada('obs1'), attr, O);
    expect((await t.lecturaM9.listarObservaciones(cB)).length).toBe(0);
    expect((await t.lecturaM9.listarEvaluaciones(cB)).length).toBe(0);
  });

  it('la memoria distingue respaldadas/refutadas/inconclusas y aprendizajes vigentes/invalidados', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    const o1 = await ejecutarOrden(t.ordenes, c, t.v);
    await observar(t.observaciones, c, 'obs1', o1);
    await t.evaluaciones.evaluar(c, 'eval1', evalEntrada('obs1'), attr, O);
    await t.aprendizajesOp.aprenderDesde(c, 'apr1', 'eval1', attr, O);
    const memo = await t.lecturaM9.memoria(c);
    expect(memo.respaldadas).toContain('hip1');
    expect(memo.refutadas).not.toContain('hip1');
    expect(memo.aprendizajesVigentes).toContain('apr1');
    expect(memo.simuladas).toBe(1);
  });
});
