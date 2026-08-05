/**
 * @soec/motor-optimizacion · tests · CICLO COMPLETO M9 + DOS ITERACIONES (bucle cerrado SIMULADO).
 *
 * M5→M6→M7→M8→M9→aprobación humana→nueva versión→nuevo ciclo. Una propuesta nunca es ejecución; la
 * aprobación humana es obligatoria; aplicar crea nuevas versiones; el segundo ciclo corre sobre la nueva
 * versión sin alterar el primero.
 */
import { describe, expect, it } from 'vitest';
import { trabajoId } from '@soec/motor-operacion';
import {
  InMemoryEventStore, ctx, attr, O, AHORA, POL_OPT, POL_OSC, montarTodo, ejecutarYMedir, versionesBase, altPlan, oportunidad, decisionHumana,
} from './_setup';

const EXEC2 = '2026-09-02T11:00:00.000Z';

async function correrCiclo(t: Awaited<ReturnType<typeof montarTodo>>, c: ReturnType<typeof ctx>, cicloId: string, propId: string, planRef: string, altId: string) {
  const vb = versionesBase(t, planRef);
  await t.optimizacion.abrir(c, cicloId, { objetivo: 'mejorar CTR', segmento: 'pymes', versionesBase: vb, presupuestoDisponible: 100 }, attr, O);
  await t.optimizacion.recopilarEvidencia(c, cicloId, attr, O);
  await t.optimizacion.evaluar(c, cicloId, attr, O);
  await t.optimizacion.registrarOportunidad(c, cicloId, oportunidad(), attr, O);
  await t.optimizacion.registrarAlternativa(c, cicloId, altPlan(altId), attr, O);
  const comp = await t.optimizacion.comparar(c, cicloId, POL_OPT, attr, O);
  await t.propuestas.proponer(c, propId, { cicloId, versionesBase: vb, alternativaElegida: altPlan(altId), alternativasDescartadas: [], artefactosAfectados: ['plan'], hipotesisId: 'hip1', kpis: ['ctr'], evidencia: ['eval1'], contraevidencia: [], impactoEsperado: 'mejor CTR', costoEstimado: 10, riesgos: [], rollbackLogico: 'volver', explicacion: 'respaldada', naturaleza: 'SIMULADO' }, attr, O);
  return comp;
}

describe('M9 · ciclo completo y dos iteraciones', () => {
  it('ejecuta el ciclo canónico hasta una propuesta APROBABLE (no ejecuta por sí mismo)', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    await ejecutarYMedir(t, c, 'orden1', 'obs1', 'eval1');
    const comp = await correrCiclo(t, c, 'ciclo1', 'prop1', 'orden1', 'alt1');
    expect(comp[0]?.resultado).toBe('PREFERIDA'); // comparación explicable
    expect((await t.optimizacion.cargar(c, 'ciclo1')).estado).toBe('PENDIENTE_APROBACION');
    // Sin aprobación NO se aplica.
    const sinAprob = await t.propuestas.aplicarSimulado(c, 'prop1', POL_OSC, AHORA, attr, O);
    expect(sinAprob.aplicada).toBe(false);
  });

  it('aprobación humana → aplicación simulada crea una NUEVA versión (derivación)', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    await ejecutarYMedir(t, c, 'orden1', 'obs1', 'eval1');
    await correrCiclo(t, c, 'ciclo1', 'prop1', 'orden1', 'alt1');
    await t.propuestas.aprobar(c, 'prop1', decisionHumana, attr, O);
    const res = await t.propuestas.aplicarSimulado(c, 'prop1', POL_OSC, AHORA, attr, O);
    expect(res.aplicada).toBe(true);
    expect(res.derivaciones[0]?.versionNueva).toBe('orden1-v2'); // nueva versión del plan
    expect((await t.propuestas.cargar(c, 'prop1')).estado).toBe('APLICADA_SIMULADA');
    expect((await t.optimizacion.cargar(c, 'ciclo1')).estado).toBe('APLICADO_SIMULADO');
  });

  it('DOS ITERACIONES: el segundo ciclo corre sobre la nueva versión sin alterar el primero', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    await ejecutarYMedir(t, c, 'orden1', 'obs1', 'eval1');
    await correrCiclo(t, c, 'ciclo1', 'prop1', 'orden1', 'alt1');
    await t.propuestas.aprobar(c, 'prop1', decisionHumana, attr, O);
    const res = await t.propuestas.aplicarSimulado(c, 'prop1', POL_OSC, AHORA, attr, O);
    const nuevoPlan = res.derivaciones[0]!.versionNueva; // orden1-v2

    // Segunda iteración: ejecutar+medir el NUEVO plan, y correr un nuevo ciclo sobre él.
    await t.ordenes.validar(c, nuevoPlan, attr, O);
    await t.ordenes.programar(c, nuevoPlan, O, attr, O);
    await t.ordenes.encolar(c, nuevoPlan, attr, O);
    await t.ordenes.reclamarYEjecutar(c, trabajoId('org-a', nuevoPlan, 1), 'w1', EXEC2, attr, O);
    await t.observaciones.registrar(c, 'obs2', { ordenId: nuevoPlan, hipotesisId: 'hip1', kpiId: 'ctr', instante: EXEC2, fuente: 'm7', metrica: 'ctr', valor: 0.07, unidad: 'ratio', naturaleza: 'SIMULADA', calidad: 'alta', cobertura: 1 }, attr, O);
    await t.observaciones.validar(c, 'obs2', attr, O);
    await t.evaluaciones.evaluar(c, 'eval2', { observacionId: 'obs2', segmento: 'pymes', expectativa: { kpiId: 'ctr', direccion: 'subir', baseline: 0.02, umbral: 0.03, meta: 0.05, muestraMinima: 100, calidadMinima: 'media', coberturaMinima: 0.6 }, hipotesisVersion: 1, evidenciaAFavor: 3, evidenciaEnContra: 0, observacionesExcluidas: 0, suficiente: true, pertinente: true, atribucion: { kpiId: 'ctr', modelo: 'directa', ventana: '7d', eventosIncluidos: 10, eventosExcluidos: 0, hayIdentificadorDirecto: true, haySenalContribuyente: false, soloCoincidenciaTemporal: false, supuestos: [], naturaleza: 'SIMULADA' } }, attr, O);
    await correrCiclo(t, c, 'ciclo2', 'prop2', nuevoPlan, 'alt2');

    // El primer ciclo permanece intacto (APLICADO_SIMULADO); el segundo avanza.
    expect((await t.optimizacion.cargar(c, 'ciclo1')).estado).toBe('APLICADO_SIMULADO');
    expect((await t.optimizacion.cargar(c, 'ciclo2')).estado).toBe('PENDIENTE_APROBACION');
    expect((await t.lecturaSoec.listarCiclos(c)).length).toBe(2);
  });
});
