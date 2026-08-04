/**
 * @soec/motor-medicion · tests · MATRIZ DE FALLOS PARCIALES POR FRONTERA (M8).
 *
 * Para cada frontera de persistencia (observación/índices/validación/evaluación/aprendizaje/obsolescencia)
 * se falla su ocurrencia UNA vez y se acredita: fallo → estado parcial → reparación (retry idempotente) →
 * nuevo intento no-op → dos reparadores concurrentes → replay frío. La evaluación de resultado/atribución/
 * hipótesis se persiste dentro de `evaluacion.emitida` (una frontera); memoria/reconciliación son lectura/
 * recuperación. Con conteo de eventos (evaluación emitida exactamente una vez).
 */
import { describe, expect, it } from 'vitest';
import {
  InMemoryEventStore, StoreFallaEnOcurrencia, ctx, attr, O, montarTodo, ejecutarOrden, obsEntrada, evalEntrada,
  type EventStore, type RequestContext,
} from './_setup';
import { reconstruirObservacion, reconstruirEvaluacion, observacionStreamId, evaluacionStreamId } from '../src/index';

const ORG = 'org-a';
interface Borde { nombre: string; tipo: string; ocurrencia: number }
const BORDES: Borde[] = [
  { nombre: 'observacion', tipo: 'observacion.registrada', ocurrencia: 1 },
  { nombre: 'indice-observacion', tipo: 'observacion-indice.registrada', ocurrencia: 1 },
  { nombre: 'validacion', tipo: 'observacion.validada', ocurrencia: 1 },
  { nombre: 'evaluacion (resultado/atribucion/hipotesis)', tipo: 'evaluacion.emitida', ocurrencia: 1 },
  { nombre: 'indice-evaluacion', tipo: 'evaluacion-indice.registrada', ocurrencia: 1 },
  { nombre: 'aprendizaje', tipo: 'aprendizaje.registrado', ocurrencia: 1 },
  { nombre: 'indice-aprendizaje', tipo: 'aprendizaje-op-indice.registrada', ocurrencia: 1 },
];

async function conducir(t: Awaited<ReturnType<typeof montarTodo>>, c: RequestContext, ordenId: string): Promise<void> {
  const retry = async (fn: () => Promise<unknown>) => { try { await fn(); } catch { await fn(); } };
  await retry(() => t.observaciones.registrar(c, 'obs1', obsEntrada(ordenId), attr, O));
  await retry(() => t.observaciones.validar(c, 'obs1', attr, O));
  await retry(() => t.evaluaciones.evaluar(c, 'eval1', evalEntrada('obs1'), attr, O));
  await retry(() => t.aprendizajesOp.aprenderDesde(c, 'apr1', 'eval1', attr, O));
}

describe('M8 · fallos parciales por frontera', () => {
  for (const b of BORDES) {
    it(`frontera '${b.nombre}': falla → repara → evaluación emitida una vez → cadena consistente`, async () => {
      const inner = new InMemoryEventStore(); const c = ctx();
      const store: EventStore = new StoreFallaEnOcurrencia(inner, { tipo: b.tipo, ocurrencia: b.ocurrencia });
      const t = await montarTodo(store, c);
      const ordenId = await ejecutarOrden(t.ordenes, c, t.v);
      await conducir(t, c, ordenId);

      expect((await t.observaciones.cargar(c, 'obs1')).estado).toBe('VALIDADA');
      expect((await t.evaluaciones.listarIds(c)).length).toBe(1);
      expect((await t.evaluaciones.cargar(c, 'eval1')).estado).toBe('EMITIDA');
      expect((await t.aprendizajesOp.listarVinculos(c)).length).toBe(1);
      // Evaluación emitida EXACTAMENTE una vez (atomicidad lógica por conteo de eventos).
      expect((await inner.readStream(c, evaluacionStreamId(ORG, 'eval1'))).filter((e) => e.type === 'evaluacion.emitida')).toHaveLength(1);
      const memo = await t.lecturaM9.memoria(c);
      expect(memo.respaldadas).toContain('hip1');
    });
  }

  it("frontera 'obsolescencia': falla evaluacion.obsoleta → reintento la aplica (OBSOLETA)", async () => {
    const inner = new InMemoryEventStore(); const c = ctx();
    const store = new StoreFallaEnOcurrencia(inner, { tipo: 'evaluacion.obsoleta', ocurrencia: 1 });
    const t = await montarTodo(store, c);
    const ordenId = await ejecutarOrden(t.ordenes, c, t.v);
    await conducir(t, c, ordenId);
    const retry = async (fn: () => Promise<unknown>) => { try { await fn(); } catch { await fn(); } };
    await retry(() => t.evaluaciones.invalidar(c, 'eval1', 'frontera obsolescencia', attr, O));
    expect((await t.evaluaciones.cargar(c, 'eval1')).estado).toBe('OBSOLETA');
  });

  it('convergencia concurrente: dos reparaciones tras un fallo de frontera no duplican la evaluación', async () => {
    const inner = new InMemoryEventStore(); const c = ctx();
    const store = new StoreFallaEnOcurrencia(inner, { tipo: 'evaluacion.emitida', ocurrencia: 1 });
    const t = await montarTodo(store, c);
    const ordenId = await ejecutarOrden(t.ordenes, c, t.v);
    await conducir(t, c, ordenId);
    await Promise.all([t.evaluaciones.evaluar(c, 'eval1', evalEntrada('obs1'), attr, O), t.evaluaciones.evaluar(c, 'eval1', evalEntrada('obs1'), attr, O)]);
    expect((await inner.readStream(c, evaluacionStreamId(ORG, 'eval1'))).filter((e) => e.type === 'evaluacion.emitida')).toHaveLength(1);
  });

  it('replay frío tras reparar una frontera reproduce el mismo resultado (idéntico, sin re-ejecutar)', async () => {
    const inner = new InMemoryEventStore(); const c = ctx();
    const store = new StoreFallaEnOcurrencia(inner, { tipo: 'observacion.validada', ocurrencia: 1 });
    const t = await montarTodo(store, c);
    const ordenId = await ejecutarOrden(t.ordenes, c, t.v);
    await conducir(t, c, ordenId);
    const frio = InMemoryEventStore.desdeInstantanea(JSON.parse(JSON.stringify(inner.exportar())));
    const obsFrio = reconstruirObservacion(ORG, 'obs1', await frio.readStream(c, observacionStreamId(ORG, 'obs1')));
    const evFrio = reconstruirEvaluacion(ORG, 'eval1', await frio.readStream(c, evaluacionStreamId(ORG, 'eval1')));
    expect(obsFrio.estado).toBe('VALIDADA');
    expect(evFrio.estado).toBe('EMITIDA');
    expect(evFrio.cuerpo?.resultado.estado).toBe('SUPERADO');
  });
});
