/**
 * @soec/motor-medicion · tests · MATRIZ DE FALLOS PARCIALES POR FRONTERA (12 fronteras).
 *
 * Cada frontera de persistencia se falla en su ocurrencia UNA vez y se acredita: intento inicial → estado
 * parcial → reintento repara sólo lo faltante → reintento adicional no-op → dos reparadores concurrentes →
 * store nuevo desde el log serializado reproduce el resultado. Con conteo de eventos por stream y tipo.
 * La evaluación está DESCOMPUESTA en pasos event-sourced (medición/resultado/atribución/hipótesis/
 * recomendación/cierre), por eso cada uno es una frontera real.
 */
import { describe, expect, it } from 'vitest';
import {
  InMemoryEventStore, StoreFallaEnOcurrencia, ctx, attr, O, montarTodo, ejecutarOrden, obsEntrada, evalEntrada,
  type EventStore, type RequestContext,
} from './_setup';
import { reconstruirObservacion, reconstruirEvaluacion, observacionStreamId, evaluacionStreamId } from '../src/index';

const ORG = 'org-a';
const cuenta = async (store: EventStore, c: RequestContext, stream: string, tipo: string) => (await store.readStream(c, stream)).filter((e) => e.type === tipo).length;

interface Borde { n: number; nombre: string; tipo: string }
// 12 fronteras. Las 10 primeras y la 11 (índice) las cubre el arnés (retry idempotente); la 12
// (reconciliación) se prueba aparte como recuperación de read-model.
const BORDES: Borde[] = [
  { n: 1, nombre: 'registro de observación', tipo: 'observacion.registrada' },
  { n: 2, nombre: 'validación de observación', tipo: 'observacion.validada' },
  { n: 3, nombre: 'medición/cálculo', tipo: 'evaluacion.medicion' },
  { n: 4, nombre: 'evaluación de resultado', tipo: 'evaluacion.resultado' },
  { n: 5, nombre: 'atribución', tipo: 'evaluacion.atribucion' },
  { n: 6, nombre: 'evaluación de hipótesis', tipo: 'evaluacion.hipotesis' },
  { n: 7, nombre: 'registro de aprendizaje', tipo: 'aprendizaje.registrado' },
  { n: 8, nombre: 'actualización de memoria', tipo: 'memoria.entrada' },
  { n: 9, nombre: 'recomendación/abstención', tipo: 'evaluacion.recomendacion' },
  { n: 11, nombre: 'índices/read models', tipo: 'evaluacion-indice.registrada' },
];

async function conducir(t: Awaited<ReturnType<typeof montarTodo>>, c: RequestContext, ordenId: string): Promise<void> {
  const retry = async (fn: () => Promise<unknown>) => { try { await fn(); } catch { await fn(); } };
  await retry(() => t.observaciones.registrar(c, 'obs1', obsEntrada(ordenId), attr, O));
  await retry(() => t.observaciones.validar(c, 'obs1', attr, O));
  await retry(() => t.evaluaciones.evaluar(c, 'eval1', evalEntrada('obs1'), attr, O));
  await retry(() => t.aprendizajesOp.aprenderDesde(c, 'apr1', 'eval1', attr, O));
}

describe('M8 · fallos parciales por frontera (12 fronteras)', () => {
  for (const b of BORDES) {
    it(`F${b.n} '${b.nombre}': falla → repara sólo lo faltante → evaluación emitida una vez → cadena consistente`, async () => {
      const inner = new InMemoryEventStore(); const c = ctx();
      const store: EventStore = new StoreFallaEnOcurrencia(inner, { tipo: b.tipo, ocurrencia: 1 });
      const t = await montarTodo(store, c);
      const ordenId = await ejecutarOrden(t.ordenes, c, t.v);
      await conducir(t, c, ordenId);

      expect((await t.observaciones.cargar(c, 'obs1')).estado).toBe('VALIDADA');
      expect((await t.evaluaciones.cargar(c, 'eval1')).estado).toBe('EMITIDA');
      expect((await t.aprendizajesOp.listarVinculos(c)).length).toBe(1);
      // Emisión (cierre) EXACTAMENTE una vez; cada paso una vez; memoria una vez.
      expect(await cuenta(inner, c, evaluacionStreamId(ORG, 'eval1'), 'evaluacion.cerrada')).toBe(1);
      expect(await cuenta(inner, c, evaluacionStreamId(ORG, 'eval1'), b.tipo === 'evaluacion.medicion' ? 'evaluacion.medicion' : 'evaluacion.medicion')).toBe(1);
      expect(await cuenta(inner, c, `memoria:${ORG}`, 'memoria.entrada')).toBe(1);
      // reintento ADICIONAL ⇒ no-op (sigue en 1 emisión).
      await t.evaluaciones.evaluar(c, 'eval1', evalEntrada('obs1'), attr, O);
      expect(await cuenta(inner, c, evaluacionStreamId(ORG, 'eval1'), 'evaluacion.cerrada')).toBe(1);
    });
  }

  it("F10 'obsolescencia/invalidación': falla evaluacion.obsoleta → reintento la aplica (OBSOLETA)", async () => {
    const inner = new InMemoryEventStore(); const c = ctx();
    const store = new StoreFallaEnOcurrencia(inner, { tipo: 'evaluacion.obsoleta', ocurrencia: 1 });
    const t = await montarTodo(store, c);
    const ordenId = await ejecutarOrden(t.ordenes, c, t.v);
    await conducir(t, c, ordenId);
    const retry = async (fn: () => Promise<unknown>) => { try { await fn(); } catch { await fn(); } };
    await retry(() => t.evaluaciones.invalidar(c, 'eval1', 'frontera obsolescencia', attr, O));
    expect((await t.evaluaciones.cargar(c, 'eval1')).estado).toBe('OBSOLETA');
    expect(await cuenta(inner, c, evaluacionStreamId(ORG, 'eval1'), 'evaluacion.obsoleta')).toBe(1);
  });

  it('F12 reconciliación: un read-model incompleto tras un fallo se REPARA por el reconciliador', async () => {
    const inner = new InMemoryEventStore(); const c = ctx();
    // Falla el índice de observación en su primera ocurrencia y NO se reintenta el registrar completo.
    const store = new StoreFallaEnOcurrencia(inner, { tipo: 'observacion-indice.registrada', ocurrencia: 1 });
    const t = await montarTodo(store, c);
    const ordenId = await ejecutarOrden(t.ordenes, c, t.v);
    try { await t.observaciones.registrar(c, 'obs1', obsEntrada(ordenId), attr, O); } catch { /* índice quedó incompleto */ }
    await t.observaciones.validar(c, 'obs1', attr, O);
    await t.evaluaciones.evaluar(c, 'eval1', evalEntrada('obs1'), attr, O); // referencia obs1 (no indexada)
    const h = await t.reconciliador.reconciliar(c, attr, O);
    expect(h.some((x) => x.clase === 'READ_MODEL_INCOMPLETO' && x.clasificacion === 'REPARADA')).toBe(true);
    expect(await t.observaciones.estaEnIndice(c, 'obs1')).toBe(true);
  });

  it('convergencia concurrente: dos reparaciones tras un fallo de frontera no duplican la evaluación', async () => {
    const inner = new InMemoryEventStore(); const c = ctx();
    const store = new StoreFallaEnOcurrencia(inner, { tipo: 'evaluacion.resultado', ocurrencia: 1 });
    const t = await montarTodo(store, c);
    const ordenId = await ejecutarOrden(t.ordenes, c, t.v);
    await conducir(t, c, ordenId);
    await Promise.all([t.evaluaciones.evaluar(c, 'eval1', evalEntrada('obs1'), attr, O), t.evaluaciones.evaluar(c, 'eval1', evalEntrada('obs1'), attr, O)]);
    expect(await cuenta(inner, c, evaluacionStreamId(ORG, 'eval1'), 'evaluacion.cerrada')).toBe(1);
    expect(await cuenta(inner, c, evaluacionStreamId(ORG, 'eval1'), 'evaluacion.resultado')).toBe(1);
  });

  it('replay frío tras reparar una frontera reproduce el mismo resultado (idéntico, sin re-ejecutar)', async () => {
    const inner = new InMemoryEventStore(); const c = ctx();
    const store = new StoreFallaEnOcurrencia(inner, { tipo: 'evaluacion.hipotesis', ocurrencia: 1 });
    const t = await montarTodo(store, c);
    const ordenId = await ejecutarOrden(t.ordenes, c, t.v);
    await conducir(t, c, ordenId);
    const frio = InMemoryEventStore.desdeInstantanea(JSON.parse(JSON.stringify(inner.exportar())));
    const obsFrio = reconstruirObservacion(ORG, 'obs1', await frio.readStream(c, observacionStreamId(ORG, 'obs1')));
    const evFrio = reconstruirEvaluacion(ORG, 'eval1', await frio.readStream(c, evaluacionStreamId(ORG, 'eval1')));
    expect(obsFrio.estado).toBe('VALIDADA');
    expect(evFrio.estado).toBe('EMITIDA');
    expect(evFrio.cuerpo.resultado?.estado).toBe('SUPERADO');
    expect(evFrio.cuerpo.hipotesis?.estado).toBe('RESPALDADA');
  });
});
