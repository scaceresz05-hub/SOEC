/**
 * @soec/motor-optimizacion · tests · MATRIZ EJECUTABLE DEL RECONCILIADOR M9 (16 clases).
 *
 * Una prueba por CLASE de inconsistencia del Bloque Maestro, con clasificación explícita.
 */
import { describe, expect, it } from 'vitest';
import {
  InMemoryEventStore, ctx, attr, O, AHORA, montarTodo, ejecutarYMedir, flujoHastaPropuesta,
  versionesBase, altPlan, cuerpoPropuesta, decisionHumana,
  type EventStore, type RequestContext,
} from './_setup';

const raw = async (store: EventStore, c: RequestContext, stream: string, type: string, payload: unknown) => {
  await store.append(c, stream, await store.currentVersion(c, stream), [{ type, payload, attribution: attr, occurredAt: O }]);
};
const clase = (h: readonly { clase: string; clasificacion: string }[], k: string) => h.find((x) => x.clase === k);
const cuerpoRaw = (over: Record<string, unknown> = {}) => ({ cicloId: 'ciclo1', versionesBase: { hipotesisId: 'hip1', hipotesisVersion: 1, piezaId: 'paq1', piezaVersion: 1, varianteId: 'v1', varianteVersion: 1, planRef: 'orden1' }, alternativaElegida: altPlan(), alternativasDescartadas: [], artefactosAfectados: [], hipotesisId: 'hip1', kpis: ['ctr'], evidencia: ['e'], contraevidencia: [], impactoEsperado: 'x', costoEstimado: 10, riesgos: [], rollbackLogico: 'r', explicacion: 'ok', naturaleza: 'SIMULADO', ...over });

describe('M9 · matriz del reconciliador — 16 clases', () => {
  it('CICLO_ABIERTO_SIN_ACTIVIDAD ⇒ REQUIERE_INTERVENCION', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c); await ejecutarYMedir(t, c, 'orden1', 'obs1', 'eval1');
    await t.optimizacion.abrir(c, 'ciclo1', { objetivo: 'x', segmento: 'pymes', versionesBase: versionesBase(t, 'orden1'), presupuestoDisponible: 100 }, attr, O);
    expect(clase(await t.reconciliador.reconciliar(c, AHORA, attr, O), 'CICLO_ABIERTO_SIN_ACTIVIDAD')?.clasificacion).toBe('REQUIERE_INTERVENCION');
  });

  it('CICLO_SIN_EVIDENCIA (evaluable inyectado sin evidencia) ⇒ REQUIERE_INTERVENCION', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c); await ejecutarYMedir(t, c, 'orden1', 'obs1', 'eval1');
    const s = 'ciclo-opt:org-a:cX';
    await raw(store, c, s, 'ciclo.abierto', { objetivo: 'x', segmento: 'pymes', versionesBase: versionesBase(t, 'orden1'), presupuestoDisponible: 100 });
    await raw(store, c, s, 'ciclo.evidencia_recopilada', { evaluacionesM8: [], aprendizajes: [], contradicciones: [] });
    await raw(store, c, s, 'ciclo.evaluabilidad', { evaluable: true, motivo: 'x' });
    await raw(store, c, 'ciclo-opt-indice:org-a', 'ciclo-indice.registrada', { cicloId: 'cX' });
    expect(clase(await t.reconciliador.reconciliar(c, AHORA, attr, O), 'CICLO_SIN_EVIDENCIA')?.clasificacion).toBe('REQUIERE_INTERVENCION');
  });

  it('PRESUPUESTO_INCONSISTENTE (alternativa cara) ⇒ REQUIERE_INTERVENCION', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c); await ejecutarYMedir(t, c, 'orden1', 'obs1', 'eval1');
    await t.optimizacion.abrir(c, 'ciclo1', { objetivo: 'x', segmento: 'pymes', versionesBase: versionesBase(t, 'orden1'), presupuestoDisponible: 5 }, attr, O);
    await t.optimizacion.recopilarEvidencia(c, 'ciclo1', attr, O);
    await t.optimizacion.evaluar(c, 'ciclo1', attr, O);
    await t.optimizacion.registrarAlternativa(c, 'ciclo1', altPlan('a', { costoEstimado: 500 }), attr, O);
    expect(clase(await t.reconciliador.reconciliar(c, AHORA, attr, O), 'PRESUPUESTO_INCONSISTENTE')?.clasificacion).toBe('REQUIERE_INTERVENCION');
  });

  it('PROPUESTA_SIN_CICLO + REFERENCIA_CROSS_TENANT (ciclo inexistente) ⇒ REQUIERE_INTERVENCION', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c); await ejecutarYMedir(t, c, 'orden1', 'obs1', 'eval1');
    await t.propuestas.proponer(c, 'prop1', cuerpoPropuesta(t, 'cicloFantasma', 'orden1', altPlan()), attr, O);
    const h = await t.reconciliador.reconciliar(c, AHORA, attr, O);
    expect(clase(h, 'PROPUESTA_SIN_CICLO')?.clasificacion).toBe('REQUIERE_INTERVENCION');
    expect(clase(h, 'REFERENCIA_CROSS_TENANT')?.clasificacion).toBe('REQUIERE_INTERVENCION');
  });

  it('EXPLICACION_AUSENTE ⇒ REQUIERE_INTERVENCION', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c); await ejecutarYMedir(t, c, 'orden1', 'obs1', 'eval1');
    await t.optimizacion.abrir(c, 'ciclo1', { objetivo: 'x', segmento: 'pymes', versionesBase: versionesBase(t, 'orden1'), presupuestoDisponible: 100 }, attr, O);
    await t.optimizacion.recopilarEvidencia(c, 'ciclo1', attr, O); await t.optimizacion.evaluar(c, 'ciclo1', attr, O);
    await t.propuestas.proponer(c, 'prop1', cuerpoPropuesta(t, 'ciclo1', 'orden1', altPlan(), { explicacion: '' }), attr, O);
    expect(clase(await t.reconciliador.reconciliar(c, AHORA, attr, O), 'EXPLICACION_AUSENTE')?.clasificacion).toBe('REQUIERE_INTERVENCION');
  });

  it('PROPUESTA_APROBADA_OBSOLETA (versiones perdidas) ⇒ REPARADA (obsoletar)', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c); await ejecutarYMedir(t, c, 'orden1', 'obs1', 'eval1');
    await flujoHastaPropuesta(t, c, 'ciclo1', 'prop1', 'orden1', altPlan());
    await t.propuestas.aprobar(c, 'prop1', decisionHumana, attr, O);
    await t.aprobacion.decidir(c, { resourceType: 'VARIANTE', resourceId: 'v1', resourceVersion: 1, decision: 'RECHAZADA' }, attr, O); // pierde vigencia
    const h = await t.reconciliador.reconciliar(c, AHORA, attr, O);
    expect(clase(h, 'PROPUESTA_APROBADA_OBSOLETA')?.clasificacion).toBe('REPARADA');
    expect((await t.propuestas.cargar(c, 'prop1')).estado).toBe('OBSOLETA');
  });

  it('APLICACION_SIN_APROBACION: la FSM lo IMPIDE (aplicada sin aprobación es no-op)', async () => {
    // La clase existe como defensa en profundidad, pero la máquina de estados la vuelve inalcanzable:
    // `propuesta.aplicada_simulada` sólo transiciona desde APROBADA. Inyectar creada+aplicada NO aplica.
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c); await ejecutarYMedir(t, c, 'orden1', 'obs1', 'eval1');
    const s = 'propuesta-opt:org-a:pInj';
    await raw(store, c, s, 'propuesta.creada', { cuerpo: cuerpoRaw() });
    await raw(store, c, s, 'propuesta.aplicada_simulada', { derivaciones: [{ macrobloque: 'M7', artefacto: 'orden', versionAnterior: 'orden1', versionNueva: 'orden1-v2' }] });
    expect((await t.propuestas.cargar(c, 'pInj')).estado).toBe('BORRADOR'); // la aplicación fue ignorada por la FSM
  });

  it('APLICACION_PARCIAL (menos derivaciones que variables) ⇒ REQUIERE_INTERVENCION', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c); await ejecutarYMedir(t, c, 'orden1', 'obs1', 'eval1');
    const s = 'propuesta-opt:org-a:pPar';
    await raw(store, c, s, 'propuesta.creada', { cuerpo: cuerpoRaw({ alternativaElegida: altPlan('a2', { cambia: ['segmento', 'mensaje'] }) }) });
    await raw(store, c, s, 'propuesta.pendiente_aprobacion', {});
    await raw(store, c, s, 'propuesta.aprobada', { aprobacion: decisionHumana });
    await raw(store, c, s, 'propuesta.aplicada_simulada', { derivaciones: [{ macrobloque: 'M6', artefacto: 'v', versionAnterior: '1', versionNueva: '2' }] }); // 1 < 2 variables
    await raw(store, c, 'propuesta-opt-indice:org-a', 'propuesta-indice.registrada', { propuestaId: 'pPar' });
    expect(clase(await t.reconciliador.reconciliar(c, AHORA, attr, O), 'APLICACION_PARCIAL')?.clasificacion).toBe('REQUIERE_INTERVENCION');
  });

  it('PROPUESTA_APLICADA_DOS_VECES (inyectada) ⇒ REQUIERE_INTERVENCION', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c); await ejecutarYMedir(t, c, 'orden1', 'obs1', 'eval1');
    const s = 'propuesta-opt:org-a:pDup';
    await raw(store, c, s, 'propuesta.creada', { cuerpo: cuerpoRaw() });
    await raw(store, c, s, 'propuesta.pendiente_aprobacion', {});
    await raw(store, c, s, 'propuesta.aprobada', { aprobacion: decisionHumana });
    await raw(store, c, s, 'propuesta.aplicada_simulada', { derivaciones: [] });
    await raw(store, c, s, 'propuesta.aplicada_simulada', { derivaciones: [] }); // corrupción
    await raw(store, c, 'propuesta-opt-indice:org-a', 'propuesta-indice.registrada', { propuestaId: 'pDup' });
    expect(clase(await t.reconciliador.reconciliar(c, AHORA, attr, O), 'PROPUESTA_APLICADA_DOS_VECES')?.clasificacion).toBe('REQUIERE_INTERVENCION');
  });

  it('MEMORIA_INCOMPLETA (aprobada sin memoria) ⇒ REQUIERE_INTERVENCION', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c); await ejecutarYMedir(t, c, 'orden1', 'obs1', 'eval1');
    const s = 'propuesta-opt:org-a:pMem';
    await raw(store, c, s, 'propuesta.creada', { cuerpo: cuerpoRaw() });
    await raw(store, c, s, 'propuesta.pendiente_aprobacion', {});
    await raw(store, c, s, 'propuesta.aprobada', { aprobacion: decisionHumana });
    await raw(store, c, 'propuesta-opt-indice:org-a', 'propuesta-indice.registrada', { propuestaId: 'pMem' });
    expect(clase(await t.reconciliador.reconciliar(c, AHORA, attr, O), 'MEMORIA_INCOMPLETA')?.clasificacion).toBe('REQUIERE_INTERVENCION');
  });

  it('PROPUESTA_TERMINAL_EJECUTABLE (rechazada con ciclo pendiente) ⇒ REQUIERE_INTERVENCION', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c); await ejecutarYMedir(t, c, 'orden1', 'obs1', 'eval1');
    await flujoHastaPropuesta(t, c, 'ciclo1', 'prop1', 'orden1', altPlan()); // ciclo PENDIENTE_APROBACION
    await raw(store, c, 'propuesta-opt:org-a:prop1', 'propuesta.rechazada', { aprobacion: decisionHumana }); // propuesta terminal, ciclo sigue pendiente
    expect(clase(await t.reconciliador.reconciliar(c, AHORA, attr, O), 'PROPUESTA_TERMINAL_EJECUTABLE')?.clasificacion).toBe('REQUIERE_INTERVENCION');
  });

  it('DERIVACION_SIN_PROPUESTA (memoria a propuesta inexistente) ⇒ REQUIERE_INTERVENCION', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c); await ejecutarYMedir(t, c, 'orden1', 'obs1', 'eval1');
    await raw(store, c, 'memoria-decision:org-a', 'memoria-decision.entrada', { cicloId: 'c', propuestaId: 'fantasma', decision: 'APLICADA', actorHumano: 'h', motivo: 'x', aplicada: true, derivaciones: [], cambios: [], en: O });
    expect(clase(await t.reconciliador.reconciliar(c, AHORA, attr, O), 'DERIVACION_SIN_PROPUESTA')?.clasificacion).toBe('REQUIERE_INTERVENCION');
  });

  it('RESULTADO_NO_VINCULADO (memoria aplicada, ciclo no aplicado) ⇒ REQUIERE_INTERVENCION', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c); await ejecutarYMedir(t, c, 'orden1', 'obs1', 'eval1');
    await flujoHastaPropuesta(t, c, 'ciclo1', 'prop1', 'orden1', altPlan()); // ciclo pendiente (no aplicado)
    await raw(store, c, 'memoria-decision:org-a', 'memoria-decision.entrada', { cicloId: 'ciclo1', propuestaId: 'prop1', decision: 'APLICADA', actorHumano: 'h', motivo: 'x', aplicada: true, derivaciones: [], cambios: [], en: O });
    expect(clase(await t.reconciliador.reconciliar(c, AHORA, attr, O), 'RESULTADO_NO_VINCULADO')?.clasificacion).toBe('REQUIERE_INTERVENCION');
  });

  it('OSCILACION_NO_DETECTADA (A→B→A en el historial) ⇒ REQUIERE_INTERVENCION', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c); await ejecutarYMedir(t, c, 'orden1', 'obs1', 'eval1');
    const mk = (valor: string, en: string) => ({ cicloId: 'c', propuestaId: `p-${valor}-${en}`, decision: 'APLICADA', actorHumano: 'h', motivo: 'x', aplicada: true, cambios: [{ variable: 'plan', valor, en }], derivaciones: [], en });
    await raw(store, c, 'memoria-decision:org-a', 'memoria-decision.entrada', mk('A', '2026-09-01T00:00:00Z'));
    await raw(store, c, 'memoria-decision:org-a', 'memoria-decision.entrada', mk('B', '2026-09-02T00:00:00Z'));
    await raw(store, c, 'memoria-decision:org-a', 'memoria-decision.entrada', mk('A', '2026-09-03T00:00:00Z'));
    expect(clase(await t.reconciliador.reconciliar(c, AHORA, attr, O), 'OSCILACION_NO_DETECTADA')?.clasificacion).toBe('REQUIERE_INTERVENCION');
  });

  it('READ_MODEL_INCOMPLETO (propuesta ausente del índice) ⇒ REPARADA', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c); await ejecutarYMedir(t, c, 'orden1', 'obs1', 'eval1');
    await t.optimizacion.abrir(c, 'ciclo1', { objetivo: 'x', segmento: 'pymes', versionesBase: versionesBase(t, 'orden1'), presupuestoDisponible: 100 }, attr, O);
    await t.optimizacion.recopilarEvidencia(c, 'ciclo1', attr, O); await t.optimizacion.evaluar(c, 'ciclo1', attr, O);
    // Propuesta con stream + vínculo del ciclo, pero SIN índice.
    const s = 'propuesta-opt:org-a:prop1';
    await raw(store, c, s, 'propuesta.creada', { cuerpo: cuerpoRaw() });
    await t.optimizacion.vincularPropuesta(c, 'ciclo1', 'prop1', attr, O);
    expect(await t.propuestas.estaEnIndice(c, 'prop1')).toBe(false);
    const h = await t.reconciliador.reconciliar(c, AHORA, attr, O);
    expect(clase(h, 'READ_MODEL_INCOMPLETO')?.clasificacion).toBe('REPARADA');
    expect(await t.propuestas.estaEnIndice(c, 'prop1')).toBe(true);
  });

  it('dos reconciliadores concurrentes convergen', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c); await ejecutarYMedir(t, c, 'orden1', 'obs1', 'eval1');
    await flujoHastaPropuesta(t, c, 'ciclo1', 'prop1', 'orden1', altPlan());
    await t.propuestas.aprobar(c, 'prop1', decisionHumana, attr, O);
    await t.aprobacion.decidir(c, { resourceType: 'VARIANTE', resourceId: 'v1', resourceVersion: 1, decision: 'RECHAZADA' }, attr, O);
    const [h1, h2] = await Promise.all([t.reconciliador.reconciliar(c, AHORA, attr, O), t.reconciliador.reconciliar(c, AHORA, attr, O)]);
    const clsf = [h1, h2].map((h) => clase(h, 'PROPUESTA_APROBADA_OBSOLETA')?.clasificacion);
    expect(clsf).toContain('REPARADA');
    expect((await t.propuestas.cargar(c, 'prop1')).estado).toBe('OBSOLETA');
  });
});
