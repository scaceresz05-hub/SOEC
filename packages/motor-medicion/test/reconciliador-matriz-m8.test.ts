/**
 * @soec/motor-medicion · tests · MATRIZ EJECUTABLE DEL RECONCILIADOR DE MEDICIÓN.
 *
 * Una prueba por CLASE de inconsistencia del Bloque Maestro: construye la inconsistencia (por API o por
 * inyección de corrupción), corre el reconciliador y verifica detector + clasificación + acción.
 */
import { describe, expect, it } from 'vitest';
import {
  InMemoryEventStore, ctx, attr, O, montarTodo, ejecutarOrden, observar, evalEntrada, expectativa,
  type EventStore, type RequestContext,
} from './_setup';
import { observacionStreamId, reconstruirObservacion, EVENTOS_OBSERVACION, type DatosObservacion } from '../src/index';

const raw = async (store: EventStore, c: RequestContext, stream: string, type: string, payload: unknown) => {
  await store.append(c, stream, await store.currentVersion(c, stream), [{ type, payload, attribution: attr, occurredAt: O }]);
};
const datos = (over: Partial<DatosObservacion> = {}): DatosObservacion => ({
  ordenId: 'orden1', executionId: 'orden1:i1', pieza: { id: 'paq1', version: 1 }, variante: { id: 'v1', version: 1 },
  hipotesisId: 'hip1', kpiId: 'ctr', instante: O, fuente: 'f', metrica: 'ctr', valor: 0.06, unidad: 'ratio',
  naturaleza: 'SIMULADA', calidad: 'alta', cobertura: 1, limitaciones: [], evidenciaOperacionalRef: 'orden1:ev1', ...over,
});
const clase = (h: readonly { clase: string; clasificacion: string }[], k: string) => h.find((x) => x.clase === k);

describe('M8 · matriz del reconciliador de medición — 11 clases', () => {
  it('OBSERVACION_SIN_EJECUCION_VALIDA (orden compensada tras observar) ⇒ REPARADA (invalida)', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    const ordenId = await ejecutarOrden(t.ordenes, c, t.v);
    await observar(t.observaciones, c, 'obs1', ordenId); // VALIDADA
    await t.ordenes.compensar(c, ordenId, 'reverso', attr, O); // la ejecución deja de ser COMPLETA
    const h = await t.reconciliador.reconciliar(c, attr, O);
    expect(clase(h, 'OBSERVACION_SIN_EJECUCION_VALIDA')?.clasificacion).toBe('REPARADA');
    expect((await t.observaciones.cargar(c, 'obs1')).estado).toBe('DESCARTADA');
  });

  it('OBSERVACION_SIMULADA_MARCADA_REAL (inyectada) ⇒ REPARADA (invalida)', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    await raw(store, c, observacionStreamId('org-a', 'obsR'), EVENTOS_OBSERVACION.registrada, datos({ naturaleza: 'REAL' as never }));
    await raw(store, c, 'observacion-indice:org-a', 'observacion-indice.registrada', { observacionId: 'obsR' });
    const h = await t.reconciliador.reconciliar(c, attr, O);
    expect(clase(h, 'OBSERVACION_SIMULADA_MARCADA_REAL')?.clasificacion).toBe('REPARADA');
    expect((await t.observaciones.cargar(c, 'obsR')).estado).toBe('INVALIDA');
  });

  it('EJECUCION_SIN_OBSERVACION (orden ejecutada sin observar) ⇒ REQUIERE_INTERVENCION', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    await ejecutarOrden(t.ordenes, c, t.v);
    const h = await t.reconciliador.reconciliar(c, attr, O);
    expect(clase(h, 'EJECUCION_SIN_OBSERVACION')?.clasificacion).toBe('REQUIERE_INTERVENCION');
  });

  it('READ_MODEL_INCOMPLETO (observación referenciada ausente del índice) ⇒ REPARADA (reindexa)', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    await raw(store, c, observacionStreamId('org-a', 'obsX'), EVENTOS_OBSERVACION.registrada, datos()); // NO indexada
    await t.evaluaciones.evaluar(c, 'evalX', evalEntrada('obsX'), attr, O); // la referencia
    expect(await t.observaciones.estaEnIndice(c, 'obsX')).toBe(false);
    const h = await t.reconciliador.reconciliar(c, attr, O);
    expect(clase(h, 'READ_MODEL_INCOMPLETO')?.clasificacion).toBe('REPARADA');
    expect(await t.observaciones.estaEnIndice(c, 'obsX')).toBe(true);
  });

  it('EVALUACION_DUPLICADA (dos evaluaciones para la misma observación) ⇒ REQUIERE_INTERVENCION', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    const ordenId = await ejecutarOrden(t.ordenes, c, t.v);
    await observar(t.observaciones, c, 'obs1', ordenId);
    await t.evaluaciones.evaluar(c, 'eval1', evalEntrada('obs1'), attr, O);
    await t.evaluaciones.evaluar(c, 'eval2', evalEntrada('obs1'), attr, O);
    const h = await t.reconciliador.reconciliar(c, attr, O);
    expect(clase(h, 'EVALUACION_DUPLICADA')?.clasificacion).toBe('REQUIERE_INTERVENCION');
  });

  it('KPI_INCONSISTENTE (evaluación con KPI distinto al de la observación) ⇒ REQUIERE_INTERVENCION', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    const ordenId = await ejecutarOrden(t.ordenes, c, t.v);
    await observar(t.observaciones, c, 'obs1', ordenId); // kpi ctr
    await t.evaluaciones.evaluar(c, 'eval1', evalEntrada('obs1', { expectativa: expectativa('otro') }), attr, O);
    const h = await t.reconciliador.reconciliar(c, attr, O);
    expect(clase(h, 'KPI_INCONSISTENTE')?.clasificacion).toBe('REQUIERE_INTERVENCION');
  });

  it('UNIDAD_INCOMPATIBLE (mismo KPI, distinta unidad) ⇒ REQUIERE_INTERVENCION', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    const o1 = await ejecutarOrden(t.ordenes, c, t.v, 'orden1');
    const o2 = await ejecutarOrden(t.ordenes, c, t.v, 'orden2');
    await observar(t.observaciones, c, 'obs1', o1, { unidad: 'ratio' });
    await observar(t.observaciones, c, 'obs2', o2, { unidad: 'porcentaje' });
    const h = await t.reconciliador.reconciliar(c, attr, O);
    expect(clase(h, 'UNIDAD_INCOMPATIBLE')?.clasificacion).toBe('REQUIERE_INTERVENCION');
  });

  it('RESULTADO_SIN_EVIDENCIA (observación VALIDADA sin evidencia operacional) ⇒ REQUIERE_INTERVENCION', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    await ejecutarOrden(t.ordenes, c, t.v, 'orden1'); // ejecución válida real
    const s = observacionStreamId('org-a', 'obsSE');
    await raw(store, c, s, EVENTOS_OBSERVACION.registrada, datos({ evidenciaOperacionalRef: null }));
    await raw(store, c, s, EVENTOS_OBSERVACION.validada, { contexto: {} }); // VALIDADA pero sin evidenciaRef
    await raw(store, c, 'observacion-indice:org-a', 'observacion-indice.registrada', { observacionId: 'obsSE' });
    await t.evaluaciones.evaluar(c, 'evalSE', evalEntrada('obsSE'), attr, O);
    const h = await t.reconciliador.reconciliar(c, attr, O);
    expect(clase(h, 'RESULTADO_SIN_EVIDENCIA')?.clasificacion).toBe('REQUIERE_INTERVENCION');
  });

  it('EVALUACION_SIN_EXPLICACION (inyectada) ⇒ REQUIERE_INTERVENCION', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    const cuerpo = { observacionId: 'obsZ', hipotesisId: null, kpiId: 'ctr', segmento: 'pymes', resultado: { estado: 'NO_EVALUABLE' }, hipotesis: null, atribucion: null, recomendacion: { estado: 'ABSTENCION', tipo: 'ampliar_evidencia' }, explicacion: '' };
    await raw(store, c, 'evaluacion-op:org-a:evalVacia', 'evaluacion.emitida', cuerpo);
    await raw(store, c, 'evaluacion-indice:org-a', 'evaluacion-indice.registrada', { evaluacionId: 'evalVacia' });
    const h = await t.reconciliador.reconciliar(c, attr, O);
    expect(clase(h, 'EVALUACION_SIN_EXPLICACION')?.clasificacion).toBe('REQUIERE_INTERVENCION');
  });

  it('APRENDIZAJE_SIN_EVALUACION (vínculo a evaluación inexistente) ⇒ REQUIERE_INTERVENCION', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    await raw(store, c, 'aprendizaje-op-indice:org-a', 'aprendizaje-op-indice.registrada', { aprendizajeId: 'aprF', evaluacionId: 'ghost', hipotesisId: 'hip1' });
    const h = await t.reconciliador.reconciliar(c, attr, O);
    expect(clase(h, 'APRENDIZAJE_SIN_EVALUACION')?.clasificacion).toBe('REQUIERE_INTERVENCION');
  });

  it('APRENDIZAJE_CON_EVALUACION_OBSOLETA ⇒ REQUIERE_INTERVENCION (revisar)', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    const ordenId = await ejecutarOrden(t.ordenes, c, t.v);
    await observar(t.observaciones, c, 'obs1', ordenId);
    await t.evaluaciones.evaluar(c, 'eval1', evalEntrada('obs1'), attr, O);
    await t.aprendizajesOp.aprenderDesde(c, 'apr1', 'eval1', attr, O);
    await t.evaluaciones.invalidar(c, 'eval1', 'cambió la hipótesis', attr, O);
    const h = await t.reconciliador.reconciliar(c, attr, O);
    expect(clase(h, 'APRENDIZAJE_CON_EVALUACION_OBSOLETA')?.clasificacion).toBe('REQUIERE_INTERVENCION');
  });
});

describe('M8 · reconciliador — convergencia concurrente y no-op tras replay frío', () => {
  it('dos reconciliadores concurrentes convergen; tras replay frío no reaparece la reparación', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    const ordenId = await ejecutarOrden(t.ordenes, c, t.v);
    await observar(t.observaciones, c, 'obs1', ordenId);
    await t.ordenes.compensar(c, ordenId, 'reverso', attr, O);
    const [h1, h2] = await Promise.all([t.reconciliador.reconciliar(c, attr, O), t.reconciliador.reconciliar(c, attr, O)]);
    const rep = [h1, h2].map((h) => clase(h, 'OBSERVACION_SIN_EJECUCION_VALIDA')?.clasificacion);
    expect(rep).toContain('REPARADA');
    // replay frío: la observación reconstruida desde un store nuevo (log serializado) sigue INVALIDA.
    const frio = InMemoryEventStore.desdeInstantanea(JSON.parse(JSON.stringify(store.exportar())));
    const obsFrio = reconstruirObservacion('org-a', 'obs1', await frio.readStream(c, observacionStreamId('org-a', 'obs1')));
    expect(obsFrio.estado).toBe('DESCARTADA');
  });
});
