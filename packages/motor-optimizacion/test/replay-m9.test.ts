/**
 * @soec/motor-optimizacion · tests · REPLAY FRÍO INTEGRAL de DOS CICLOS + lectura global inmutable.
 *
 * Reconstruye toda la historia del ciclo funcional desde un store NUEVO (log serializado) y verifica que
 * ciclos, propuestas y memoria de decisiones quedan IDÉNTICOS. La lectura global es deep-frozen.
 */
import { describe, expect, it } from 'vitest';
import { trabajoId } from '@soec/motor-operacion';
import {
  InMemoryEventStore, ctx, attr, O, montarTodo, montarLectura, ejecutarYMedir, flujoAplicado, flujoHastaPropuesta, altPlan,
} from './_setup';

const EXEC2 = '2026-09-02T11:00:00.000Z';

describe('M9 · replay frío integral', () => {
  it('reconstruye ciclos/propuestas/memoria IDÉNTICOS desde un store nuevo (dos iteraciones)', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    await ejecutarYMedir(t, c, 'orden1', 'obs1', 'eval1');
    const res = await flujoAplicado(t, c, 'ciclo1', 'prop1', 'orden1', altPlan());
    const nuevoPlan = res.derivaciones[0]!.versionNueva;
    // Segunda iteración sobre la nueva versión.
    await t.ordenes.validar(c, nuevoPlan, attr, O); await t.ordenes.programar(c, nuevoPlan, O, attr, O); await t.ordenes.encolar(c, nuevoPlan, attr, O);
    await t.ordenes.reclamarYEjecutar(c, trabajoId('org-a', nuevoPlan, 1), 'w1', EXEC2, attr, O);
    await t.observaciones.registrar(c, 'obs2', { ordenId: nuevoPlan, hipotesisId: 'hip1', kpiId: 'ctr', instante: EXEC2, fuente: 'm7', metrica: 'ctr', valor: 0.07, unidad: 'ratio', naturaleza: 'SIMULADA', calidad: 'alta', cobertura: 1 }, attr, O);
    await t.observaciones.validar(c, 'obs2', attr, O);
    await t.evaluaciones.evaluar(c, 'eval2', { observacionId: 'obs2', segmento: 'pymes', expectativa: { kpiId: 'ctr', direccion: 'subir', baseline: 0.02, umbral: 0.03, meta: 0.05, muestraMinima: 100, calidadMinima: 'media', coberturaMinima: 0.6 }, hipotesisVersion: 1, evidenciaAFavor: 3, evidenciaEnContra: 0, observacionesExcluidas: 0, suficiente: true, pertinente: true, atribucion: { kpiId: 'ctr', modelo: 'directa', ventana: '7d', eventosIncluidos: 10, eventosExcluidos: 0, hayIdentificadorDirecto: true, haySenalContribuyente: false, soloCoincidenciaTemporal: false, supuestos: [], naturaleza: 'SIMULADA' } }, attr, O);
    await flujoHastaPropuesta(t, c, 'ciclo2', 'prop2', nuevoPlan, altPlan('alt2'));

    const ciclosCal = JSON.parse(JSON.stringify(await t.lecturaSoec.listarCiclos(c)));
    const propsCal = JSON.parse(JSON.stringify(await t.lecturaSoec.listarPropuestas(c)));
    const memoCal = JSON.parse(JSON.stringify(await t.lecturaSoec.memoriaDecisiones(c)));

    const frio = InMemoryEventStore.desdeInstantanea(JSON.parse(JSON.stringify(store.exportar())));
    const f = montarLectura(frio);
    expect(JSON.parse(JSON.stringify(await f.lecturaSoec.listarCiclos(c)))).toEqual(ciclosCal);
    expect(JSON.parse(JSON.stringify(await f.lecturaSoec.listarPropuestas(c)))).toEqual(propsCal);
    expect(JSON.parse(JSON.stringify(await f.lecturaSoec.memoriaDecisiones(c)))).toEqual(memoCal);
    expect(ciclosCal.length).toBe(2);
    expect(ciclosCal.find((x: { cicloId: string }) => x.cicloId === 'ciclo1').estado).toBe('APLICADO_SIMULADO');
  });

  it('la lectura global es profundamente inmutable (arrays anidados congelados)', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    await ejecutarYMedir(t, c, 'orden1', 'obs1', 'eval1');
    await flujoAplicado(t, c, 'ciclo1', 'prop1', 'orden1', altPlan());
    const props = await t.lecturaSoec.listarPropuestas(c);
    expect(Object.isFrozen(props)).toBe(true);
    expect(Object.isFrozen(props[0]?.derivaciones)).toBe(true);
    expect(() => ((props[0]!.derivaciones as unknown[]).push({}))).toThrow();
  });
});
