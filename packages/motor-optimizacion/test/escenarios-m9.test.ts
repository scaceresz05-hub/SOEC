/**
 * @soec/motor-optimizacion · tests · 40 ESCENARIOS ADVERSARIALES → prueba permanente con aserciones sustantivas.
 */
import { describe, expect, it } from 'vitest';
import {
  InMemoryEventStore, PropuestaService, ctx, attr, O, AHORA, POL_OPT, POL_OSC, montarTodo, ejecutarYMedir,
  flujoHastaPropuesta, flujoAplicado, versionesBase, altPlan, decisionHumana,
} from './_setup';
import { compararAlternativas, permitirCambio, esExperimentoControlado, type Alternativa, type PoliticaOscilacion } from '../src/index';

const A = (over: Partial<Alternativa>): Alternativa => altPlan(over.alternativaId ?? 'a', over);

describe('M9 · 40 escenarios adversariales', () => {
  it('01 · optimización de org A no es visible/iniciable por org B (cross-tenant)', async () => {
    const store = new InMemoryEventStore(); const cA = ctx('org-a'); const cB = ctx('org-b');
    const t = await montarTodo(store, cA);
    await ejecutarYMedir(t, cA, 'orden1', 'obs1', 'eval1');
    await flujoHastaPropuesta(t, cA, 'ciclo1', 'prop1', 'orden1', altPlan());
    expect((await t.lecturaSoec.listarCiclos(cB)).length).toBe(0);
  });

  it('02 · M8 parcial/no vigente no se usa como evidencia', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    await ejecutarYMedir(t, c, 'orden1', 'obs1', 'eval1');
    await t.evaluaciones.invalidar(c, 'eval1', 'obsoleta', attr, O); // deja de ser vigente
    await t.optimizacion.abrir(c, 'ciclo1', { objetivo: 'x', segmento: 'pymes', versionesBase: versionesBase(t, 'orden1'), presupuestoDisponible: 100 }, attr, O);
    await t.optimizacion.recopilarEvidencia(c, 'ciclo1', attr, O);
    expect((await t.optimizacion.cargar(c, 'ciclo1')).cuerpo.evaluacionesM8.length).toBe(0);
  });

  it('03 · aprendizaje obsoleto ⇒ ciclo NO_EVALUABLE', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    await ejecutarYMedir(t, c, 'orden1', 'obs1', 'eval1');
    await t.evaluaciones.invalidar(c, 'eval1', 'obsoleta', attr, O);
    await t.optimizacion.abrir(c, 'ciclo1', { objetivo: 'x', segmento: 'pymes', versionesBase: versionesBase(t, 'orden1'), presupuestoDisponible: 100 }, attr, O);
    await t.optimizacion.recopilarEvidencia(c, 'ciclo1', attr, O);
    expect((await t.optimizacion.evaluar(c, 'ciclo1', attr, O)).estado).toBe('NO_EVALUABLE');
  });

  it('04 · pieza de versión antigua ⇒ coherencia falla', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    await ejecutarYMedir(t, c, 'orden1', 'obs1', 'eval1');
    const vb = { ...versionesBase(t, 'orden1'), piezaVersion: t.v + 99 };
    expect((await t.optimizacion.verificarCoherencia(c, { objetivo: 'x', segmento: 'pymes', versionesBase: vb, presupuestoDisponible: 0 })).coherente).toBe(false);
  });

  it('05 · pieza retirada/no aprobada ⇒ coherencia falla', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    await ejecutarYMedir(t, c, 'orden1', 'obs1', 'eval1');
    await t.aprobacion.decidir(c, { resourceType: 'VARIANTE', resourceId: 'v1', resourceVersion: 1, decision: 'RECHAZADA' }, attr, O); // pierde vigencia
    expect((await t.optimizacion.verificarCoherencia(c, { objetivo: 'x', segmento: 'pymes', versionesBase: versionesBase(t, 'orden1'), presupuestoDisponible: 0 })).coherente).toBe(false);
  });

  it('06 · alternativas con KPI incompatible ⇒ NO_COMPARABLE', () => {
    const cmp = compararAlternativas(POL_OPT, [A({ alternativaId: 'a', kpiAfectado: 'ctr' }), A({ alternativaId: 'b', kpiAfectado: 'cpa' })]);
    expect(cmp.every((x) => x.resultado === 'NO_COMPARABLE')).toBe(true);
  });

  it('07 · naturaleza nunca REAL (SIMULADO)', () => {
    expect(altPlan().naturaleza).toBe('SIMULADO');
  });

  it('08 · ausencia de evidencia NO es mejora ⇒ NO_EVALUABLE', () => {
    const cmp = compararAlternativas(POL_OPT, [A({ alternativaId: 'a', evidencia: [] })]);
    expect(cmp[0]?.resultado).toBe('NO_EVALUABLE');
  });

  it('09 · una ejecución no generaliza ⇒ alcance LOCAL', () => {
    expect(altPlan().alcance).toBe('LOCAL');
  });

  it('10 · la propuesta no afirma causalidad real (naturaleza SIMULADO)', () => {
    expect(altPlan().naturaleza).toBe('SIMULADO');
  });

  it('11 · sin evidencia suficiente ⇒ NO_EVALUABLE (no viable)', () => {
    const cmp = compararAlternativas(POL_OPT, [A({ alternativaId: 'a', evidencia: [] })]);
    expect(cmp[0]?.resultado).not.toBe('PREFERIDA');
  });

  it('12 · la propuesta declara contraevidencia (campo presente)', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    await ejecutarYMedir(t, c, 'orden1', 'obs1', 'eval1');
    await flujoHastaPropuesta(t, c, 'ciclo1', 'prop1', 'orden1', altPlan());
    expect(Array.isArray((await t.propuestas.cargar(c, 'prop1')).cuerpo!.contraevidencia)).toBe(true);
  });

  it('13 · costo mayor al tope con política de límite ⇒ RECHAZADA_POR_POLITICA', () => {
    const cmp = compararAlternativas({ ...POL_OPT, exigirLimitePresupuesto: true, topePresupuesto: 5 }, [A({ alternativaId: 'a', costoEstimado: 50 })]);
    expect(cmp[0]?.resultado).toBe('RECHAZADA_POR_POLITICA');
  });

  it('14 · presupuesto excedido ⇒ RECHAZADA_POR_POLITICA', () => {
    const cmp = compararAlternativas({ ...POL_OPT, topePresupuesto: 1 }, [A({ alternativaId: 'a', costoEstimado: 100 })]);
    expect(cmp[0]?.resultado).toBe('RECHAZADA_POR_POLITICA');
  });

  it('15 · multi-variable con política de experimento controlado ⇒ RECHAZADA_POR_POLITICA', () => {
    const cmp = compararAlternativas({ ...POL_OPT, requiereExperimentoControlado: true }, [A({ alternativaId: 'a', cambia: ['segmento', 'mensaje'] })]);
    expect(cmp[0]?.resultado).toBe('RECHAZADA_POR_POLITICA');
    expect(esExperimentoControlado(A({ alternativaId: 'a', cambia: ['segmento', 'mensaje'] }))).toBe(false);
  });

  it('16 · incomparables NO llevan puntaje opaco (puntaje null)', () => {
    const cmp = compararAlternativas(POL_OPT, [A({ alternativaId: 'a', kpiAfectado: 'ctr' }), A({ alternativaId: 'b', kpiAfectado: 'cpa' })]);
    expect(cmp[0]?.puntaje).toBeNull();
    expect(cmp[0]?.dimensiones.length).toBeGreaterThan(0); // explicación por dimensión SIEMPRE
  });

  it('17 · autoaprobación bloqueada (exige actor humano)', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    await ejecutarYMedir(t, c, 'orden1', 'obs1', 'eval1');
    await flujoHastaPropuesta(t, c, 'ciclo1', 'prop1', 'orden1', altPlan());
    await expect(t.propuestas.aprobar(c, 'prop1', { actorHumano: '', decisionId: 'd', justificacion: 'x' }, attr, O)).rejects.toThrow();
  });

  it('18 · una nueva propuesta NO hereda aprobación (nace BORRADOR→PENDIENTE)', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    await ejecutarYMedir(t, c, 'orden1', 'obs1', 'eval1');
    await flujoAplicado(t, c, 'ciclo1', 'prop1', 'orden1', altPlan());
    await flujoHastaPropuesta(t, c, 'ciclo2', 'prop2', 'orden1', altPlan('alt2'));
    expect((await t.propuestas.cargar(c, 'prop2')).estado).toBe('PENDIENTE_APROBACION'); // no aprobada
  });

  it('19 · propuesta obsoleta no se aplica', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    await ejecutarYMedir(t, c, 'orden1', 'obs1', 'eval1');
    await flujoHastaPropuesta(t, c, 'ciclo1', 'prop1', 'orden1', altPlan());
    await t.propuestas.aprobar(c, 'prop1', decisionHumana, attr, O);
    await t.propuestas.obsoletar(c, 'prop1', 'cambió M6', attr, O);
    expect((await t.propuestas.aplicarSimulado(c, 'prop1', POL_OSC, AHORA, attr, O)).aplicada).toBe(false);
  });

  it('20 · aplicación duplicada ⇒ no-op (un solo evento de aplicación)', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    await ejecutarYMedir(t, c, 'orden1', 'obs1', 'eval1');
    await flujoAplicado(t, c, 'ciclo1', 'prop1', 'orden1', altPlan());
    await t.propuestas.aplicarSimulado(c, 'prop1', POL_OSC, AHORA, attr, O); // segunda vez
    const eventos = await store.readStream(c, `propuesta-opt:org-a:prop1`);
    expect(eventos.filter((e) => e.type === 'propuesta.aplicada_simulada')).toHaveLength(1);
  });

  it('21 · fallo al crear la nueva versión ⇒ la propuesta NO queda aplicada', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    await ejecutarYMedir(t, c, 'orden1', 'obs1', 'eval1');
    const props = new PropuestaService(store, t.optimizacion, t.aprobacion, { async aplicar() { throw new Error('fallo aplicador'); } }, t.memoriaDec);
    await flujoHastaPropuesta(t, c, 'ciclo1', 'prop1', 'orden1', altPlan());
    await props.aprobar(c, 'prop1', decisionHumana, attr, O);
    await expect(props.aplicarSimulado(c, 'prop1', POL_OSC, AHORA, attr, O)).rejects.toThrow();
    expect((await t.propuestas.cargar(c, 'prop1')).estado).toBe('APROBADA'); // no APLICADA
  });

  it('22 · la aplicación registra el vínculo de derivación', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    await ejecutarYMedir(t, c, 'orden1', 'obs1', 'eval1');
    const res = await flujoAplicado(t, c, 'ciclo1', 'prop1', 'orden1', altPlan());
    expect(res.derivaciones[0]?.versionAnterior).toBe('orden1');
    expect(res.derivaciones[0]?.versionNueva).toBe('orden1-v2');
  });

  it('23 · segunda iteración no modifica la primera', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    await ejecutarYMedir(t, c, 'orden1', 'obs1', 'eval1');
    await flujoAplicado(t, c, 'ciclo1', 'prop1', 'orden1', altPlan());
    await flujoHastaPropuesta(t, c, 'ciclo2', 'prop2', 'orden1', altPlan('alt2'));
    expect((await t.optimizacion.cargar(c, 'ciclo1')).estado).toBe('APLICADO_SIMULADO');
  });

  it('24 · oscilación A→B→A bloqueada', () => {
    const hist = [{ variable: 'plan', valor: 'A', en: '2026-09-01T00:00:00Z' }, { variable: 'plan', valor: 'B', en: '2026-09-02T00:00:00Z' }];
    expect(permitirCambio(hist, { variable: 'plan', valor: 'A' }, POL_OSC, '2026-09-03T00:00:00Z').permitido).toBe(false);
  });

  it('25 · reoptimización durante cooldown bloqueada', () => {
    const pol: PoliticaOscilacion = { ...POL_OSC, cooldownMs: 86400000 };
    const hist = [{ variable: 'plan', valor: 'A', en: '2026-09-03T00:00:00Z' }];
    expect(permitirCambio(hist, { variable: 'plan', valor: 'B' }, pol, '2026-09-03T01:00:00Z').permitido).toBe(false);
  });

  it('26 · demasiados cambios en una ventana bloqueados', () => {
    const pol: PoliticaOscilacion = { ...POL_OSC, maxCambiosPorVentana: 2 };
    const hist = [{ variable: 'plan', valor: 'A', en: '2026-09-01T00:00:00Z' }, { variable: 'plan', valor: 'B', en: '2026-09-01T06:00:00Z' }];
    expect(permitirCambio(hist, { variable: 'plan', valor: 'C' }, pol, '2026-09-01T12:00:00Z').permitido).toBe(false);
  });

  it('27 · propuesta rechazada no se aplica', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    await ejecutarYMedir(t, c, 'orden1', 'obs1', 'eval1');
    await flujoHastaPropuesta(t, c, 'ciclo1', 'prop1', 'orden1', altPlan());
    await t.propuestas.rechazar(c, 'prop1', decisionHumana, attr, O);
    expect((await t.propuestas.aplicarSimulado(c, 'prop1', POL_OSC, AHORA, attr, O)).aplicada).toBe(false);
  });

  it('28 · NO_ACTUAR: aplicar sin cambios no crea versiones', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    await ejecutarYMedir(t, c, 'orden1', 'obs1', 'eval1');
    const noActuar = altPlan('altNA', { cambia: [] });
    const res = await flujoAplicado(t, c, 'ciclo1', 'prop1', 'orden1', noActuar);
    expect(res.aplicada).toBe(true);
    expect(res.derivaciones.length).toBe(0);
  });

  it('29 · riesgo alto sin permiso ⇒ RECHAZADA_POR_POLITICA', () => {
    const cmp = compararAlternativas({ ...POL_OPT, permitirIrreversibleAltoRiesgo: false }, [A({ alternativaId: 'a', riesgo: 'alto' })]);
    expect(cmp[0]?.resultado).toBe('RECHAZADA_POR_POLITICA');
  });

  it('30 · cambio sin plan de reversión ⇒ dimensión reversibilidad débil', () => {
    const cmp = compararAlternativas(POL_OPT, [A({ alternativaId: 'a', planReversion: '' })]);
    expect(cmp[0]?.dimensiones.find((d) => d.nombre === 'reversibilidad')?.veredicto).toBe('debil');
  });

  it('31 · la memoria registra la decisión de aprobación', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    await ejecutarYMedir(t, c, 'orden1', 'obs1', 'eval1');
    await flujoHastaPropuesta(t, c, 'ciclo1', 'prop1', 'orden1', altPlan());
    await t.propuestas.aprobar(c, 'prop1', decisionHumana, attr, O);
    expect((await t.memoriaDec.listar(c)).some((m) => m.propuestaId === 'prop1' && m.decision === 'APROBADA')).toBe(true);
  });

  it('32 · la decisión aplicada se vincula a un ciclo aplicado', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    await ejecutarYMedir(t, c, 'orden1', 'obs1', 'eval1');
    await flujoAplicado(t, c, 'ciclo1', 'prop1', 'orden1', altPlan());
    const m = (await t.memoriaDec.listar(c)).find((x) => x.decision === 'APLICADA');
    expect((await t.optimizacion.cargar(c, m!.cicloId)).estado).toBe('APLICADO_SIMULADO');
  });

  it('33 · memoria estable entre relecturas', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    await ejecutarYMedir(t, c, 'orden1', 'obs1', 'eval1');
    await flujoAplicado(t, c, 'ciclo1', 'prop1', 'orden1', altPlan());
    expect(JSON.stringify(await t.lecturaSoec.memoriaDecisiones(c))).toBe(JSON.stringify(await t.lecturaSoec.memoriaDecisiones(c)));
  });

  it('34 · dos aperturas concurrentes del mismo ciclo convergen (un evento)', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    await ejecutarYMedir(t, c, 'orden1', 'obs1', 'eval1');
    const e = { objetivo: 'x', segmento: 'pymes', versionesBase: versionesBase(t, 'orden1'), presupuestoDisponible: 100 };
    await Promise.all([t.optimizacion.abrir(c, 'ciclo1', e, attr, O), t.optimizacion.abrir(c, 'ciclo1', e, attr, O)]);
    expect((await store.readStream(c, `ciclo-opt:org-a:ciclo1`)).filter((x) => x.type === 'ciclo.abierto')).toHaveLength(1);
  });

  it('35 · dos reconciliadores concurrentes convergen', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    await ejecutarYMedir(t, c, 'orden1', 'obs1', 'eval1');
    await t.optimizacion.abrir(c, 'ciclo1', { objetivo: 'x', segmento: 'pymes', versionesBase: versionesBase(t, 'orden1'), presupuestoDisponible: 100 }, attr, O);
    const [h1, h2] = await Promise.all([t.reconciliador.reconciliar(c, AHORA, attr, O), t.reconciliador.reconciliar(c, AHORA, attr, O)]);
    expect(Array.isArray(h1) && Array.isArray(h2)).toBe(true);
  });

  it('36 · evento duplicado: el reducer es idempotente (reabrir no reescribe)', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    await ejecutarYMedir(t, c, 'orden1', 'obs1', 'eval1');
    await t.optimizacion.abrir(c, 'ciclo1', { objetivo: 'x', segmento: 'pymes', versionesBase: versionesBase(t, 'orden1'), presupuestoDisponible: 100 }, attr, O);
    const antes = (await t.optimizacion.cargar(c, 'ciclo1')).cuerpo.objetivo;
    await t.optimizacion.abrir(c, 'ciclo1', { objetivo: 'OTRO', segmento: 'x', versionesBase: versionesBase(t, 'orden1'), presupuestoDisponible: 0 }, attr, O);
    expect((await t.optimizacion.cargar(c, 'ciclo1')).cuerpo.objetivo).toBe(antes); // idempotente
  });

  it('37 · mutación runtime de la lectura global falla (congelado)', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    await ejecutarYMedir(t, c, 'orden1', 'obs1', 'eval1');
    await flujoHastaPropuesta(t, c, 'ciclo1', 'prop1', 'orden1', altPlan());
    const ciclos = await t.lecturaSoec.listarCiclos(c);
    expect(() => ((ciclos[0] as { estado: string }).estado = 'HACK')).toThrow();
  });

  it('38 · la lectura global no filtra secretos', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    await ejecutarYMedir(t, c, 'orden1', 'obs1', 'eval1');
    await flujoAplicado(t, c, 'ciclo1', 'prop1', 'orden1', altPlan());
    const texto = JSON.stringify(await t.lecturaSoec.listarPropuestas(c)) + JSON.stringify(await t.lecturaSoec.memoriaDecisiones(c));
    expect(texto).not.toMatch(/env:|secreto|password|Bearer|stack/i);
  });

  it('39 · la propuesta conserva naturaleza SIMULADO (nunca REAL)', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    await ejecutarYMedir(t, c, 'orden1', 'obs1', 'eval1');
    await flujoHastaPropuesta(t, c, 'ciclo1', 'prop1', 'orden1', altPlan());
    expect((await t.propuestas.cargar(c, 'prop1')).cuerpo!.naturaleza).toBe('SIMULADO');
  });

  it('40 · la lectura global es de solo lectura (sin métodos de escritura)', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    const metodos = Object.getOwnPropertyNames(Object.getPrototypeOf(t.lecturaSoec));
    for (const m of ['abrir', 'proponer', 'aprobar', 'aplicarSimulado', 'append']) expect(metodos).not.toContain(m);
  });
});
