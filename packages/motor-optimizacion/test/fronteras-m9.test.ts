/**
 * @soec/motor-optimizacion · tests · MATRIZ DE FALLOS PARCIALES POR FRONTERA (18 fronteras del ciclo).
 *
 * Cada frontera se falla en su ocurrencia UNA vez; el arnés reintenta cada paso (idempotente) y se acredita:
 * estado parcial → reparación → no-op → ciclo aplicado; con conteo de eventos (derivación una sola vez). El
 * fallo se inyecta sobre eventos que sólo ocurren en el FLUJO M9 (el setup M5–M8 no los emite).
 */
import { describe, expect, it } from 'vitest';
import {
  InMemoryEventStore, StoreFallaEnOcurrencia, ctx, attr, O, AHORA, POL_OPT, POL_OSC, montarTodo, ejecutarYMedir,
  versionesBase, altPlan, oportunidad, decisionHumana, cuerpoPropuesta,
  type EventStore, type RequestContext,
} from './_setup';

async function flujoConRetry(t: Awaited<ReturnType<typeof montarTodo>>, c: RequestContext, planRef = 'orden1', alt = altPlan()) {
  const r = async (fn: () => Promise<unknown>) => { try { await fn(); } catch { await fn(); } };
  await r(() => t.optimizacion.abrir(c, 'ciclo1', { objetivo: 'x', segmento: 'pymes', versionesBase: versionesBase(t, planRef), presupuestoDisponible: 100 }, attr, O));
  await r(() => t.optimizacion.recopilarEvidencia(c, 'ciclo1', attr, O));
  await r(() => t.optimizacion.evaluar(c, 'ciclo1', attr, O));
  await r(() => t.optimizacion.registrarOportunidad(c, 'ciclo1', oportunidad(), attr, O));
  await r(() => t.optimizacion.registrarAlternativa(c, 'ciclo1', alt, attr, O));
  await r(() => t.optimizacion.comparar(c, 'ciclo1', POL_OPT, attr, O));
  await r(() => t.propuestas.proponer(c, 'prop1', cuerpoPropuesta(t, 'ciclo1', planRef, alt), attr, O));
  await r(() => t.propuestas.aprobar(c, 'prop1', decisionHumana, attr, O));
  await r(() => t.propuestas.aplicarSimulado(c, 'prop1', POL_OSC, AHORA, attr, O));
}

const BORDES: { n: number; nombre: string; tipo: string }[] = [
  { n: 1, nombre: 'apertura del ciclo', tipo: 'ciclo.abierto' },
  { n: 2, nombre: 'recopilación de evidencia', tipo: 'ciclo.evidencia_recopilada' },
  { n: 6, nombre: 'simulación/evaluabilidad', tipo: 'ciclo.evaluabilidad' },
  { n: 3, nombre: 'generación de oportunidad', tipo: 'ciclo.oportunidad_registrada' },
  { n: 4, nombre: 'creación de alternativa', tipo: 'ciclo.alternativa_registrada' },
  { n: 5, nombre: 'evaluación comparativa', tipo: 'ciclo.comparacion' },
  { n: 7, nombre: 'creación de propuesta', tipo: 'propuesta.creada' },
  { n: 8, nombre: 'solicitud de aprobación', tipo: 'propuesta.pendiente_aprobacion' },
  { n: 9, nombre: 'decisión humana', tipo: 'propuesta.aprobada' },
  { n: 13, nombre: 'vínculo de derivación', tipo: 'propuesta.aplicada_simulada' },
  { n: 14, nombre: 'memoria', tipo: 'memoria-decision.entrada' },
  { n: 17, nombre: 'índices/read models', tipo: 'propuesta-indice.registrada' },
  { n: 18, nombre: 'cierre del ciclo', tipo: 'ciclo.aplicado' },
];

async function montar(objetivo: { tipo: string; ocurrencia: number }, c: RequestContext) {
  const inner = new InMemoryEventStore();
  const store: EventStore = new StoreFallaEnOcurrencia(inner, objetivo);
  const t = await montarTodo(store, c); // el setup M5–M8 no emite eventos de M9 ⇒ no lo afecta
  await ejecutarYMedir(t, c, 'orden1', 'obs1', 'eval1');
  return { t, store };
}

describe('M9 · fallos parciales por frontera (18 fronteras)', () => {
  for (const b of BORDES) {
    it(`F${b.n} '${b.nombre}': falla → reintento repara → ciclo aplicado; derivación una vez`, async () => {
      const c = ctx();
      const { t, store } = await montar({ tipo: b.tipo, ocurrencia: 1 }, c);
      await flujoConRetry(t, c);
      expect((await t.optimizacion.cargar(c, 'ciclo1')).estado).toBe('APLICADO_SIMULADO');
      expect((await t.propuestas.cargar(c, 'prop1')).estado).toBe('APLICADA_SIMULADA');
      expect((await store.readStream(c, `propuesta-opt:org-a:prop1`)).filter((e) => e.type === 'propuesta.aplicada_simulada')).toHaveLength(1);
    });
  }

  it('F10 aplicación M5 (cambiar hipótesis) ⇒ derivación M5; reintento repara', async () => {
    const c = ctx();
    const { t } = await montar({ tipo: 'propuesta.aplicada_simulada', ocurrencia: 1 }, c);
    await flujoConRetry(t, c, 'orden1', altPlan('altM5', { cambia: ['hipotesis'] }));
    expect((await t.propuestas.cargar(c, 'prop1')).derivaciones[0]?.macrobloque).toBe('M5');
  });

  it('F11 aplicación M6 (cambiar variante) ⇒ derivación M6; reintento repara', async () => {
    const c = ctx();
    const { t } = await montar({ tipo: 'propuesta.aplicada_simulada', ocurrencia: 1 }, c);
    await flujoConRetry(t, c, 'orden1', altPlan('altM6', { cambia: ['variante'] }));
    expect((await t.propuestas.cargar(c, 'prop1')).derivaciones[0]?.macrobloque).toBe('M6');
  });

  it('F12 aplicación M7 (cambiar plan) ⇒ derivación M7; reintento repara', async () => {
    const c = ctx();
    const { t } = await montar({ tipo: 'orden.creada', ocurrencia: 2 }, c); // #1 = orden1 del setup
    await flujoConRetry(t, c, 'orden1', altPlan('altM7', { cambia: ['politica_operacional'] }));
    expect((await t.propuestas.cargar(c, 'prop1')).derivaciones[0]?.macrobloque).toBe('M7');
  });

  it('F15 obsolescencia: falla propuesta.obsoleta → reintento la aplica', async () => {
    const c = ctx();
    const { t } = await montar({ tipo: 'propuesta.obsoleta', ocurrencia: 1 }, c);
    // Hasta PENDIENTE (sin aplicar, para que la obsolescencia sea válida).
    await t.optimizacion.abrir(c, 'ciclo1', { objetivo: 'x', segmento: 'pymes', versionesBase: versionesBase(t, 'orden1'), presupuestoDisponible: 100 }, attr, O);
    await t.optimizacion.recopilarEvidencia(c, 'ciclo1', attr, O);
    await t.optimizacion.evaluar(c, 'ciclo1', attr, O);
    await t.optimizacion.registrarAlternativa(c, 'ciclo1', altPlan(), attr, O);
    await t.propuestas.proponer(c, 'prop1', cuerpoPropuesta(t, 'ciclo1', 'orden1', altPlan()), attr, O);
    const r = async (fn: () => Promise<unknown>) => { try { await fn(); } catch { await fn(); } };
    await r(() => t.propuestas.obsoletar(c, 'prop1', 'cambió', attr, O));
    expect((await t.propuestas.cargar(c, 'prop1')).estado).toBe('OBSOLETA');
  });

  it('F16 reconciliación: read-model incompleto tras un fallo de índice se REPARA', async () => {
    const c = ctx();
    const { t } = await montar({ tipo: 'propuesta-indice.registrada', ocurrencia: 1 }, c);
    await t.optimizacion.abrir(c, 'ciclo1', { objetivo: 'x', segmento: 'pymes', versionesBase: versionesBase(t, 'orden1'), presupuestoDisponible: 100 }, attr, O);
    await t.optimizacion.recopilarEvidencia(c, 'ciclo1', attr, O);
    await t.optimizacion.evaluar(c, 'ciclo1', attr, O);
    await t.optimizacion.registrarAlternativa(c, 'ciclo1', altPlan(), attr, O);
    try { await t.propuestas.proponer(c, 'prop1', cuerpoPropuesta(t, 'ciclo1', 'orden1', altPlan()), attr, O); } catch { /* índice incompleto */ }
    const h = await t.reconciliador.reconciliar(c, AHORA, attr, O);
    expect(h.some((x) => x.clase === 'READ_MODEL_INCOMPLETO' && x.clasificacion === 'REPARADA')).toBe(true);
    expect(await t.propuestas.estaEnIndice(c, 'prop1')).toBe(true);
  });
});
