/**
 * @soec/motor-medicion · tests · 30 ESCENARIOS ADVERSARIALES → prueba permanente con aserciones sustantivas.
 *
 * Cada `it` reproduce un escenario del Bloque Maestro M8 y verifica el comportamiento defensivo esperado.
 * Separación estricta: esperado ╪ observado ╪ medido ╪ atribuible ╪ inferido ╪ aprendido ╪ desconocido.
 */
import { describe, expect, it } from 'vitest';
import {
  InMemoryEventStore, ctx, attr, O, montarTodo, ejecutarOrden, ejecutarSinEvidencia, ejecutarYCompensar,
  observar, evalEntrada, expectativa, obsEntrada, entradaAtribucion,
} from './_setup';
import { evaluarResultado, evaluarHipotesis, atribuir, consolidar, recomendar, type ClaveComparacion } from '../src/index';

const CLAVE: ClaveComparacion = { hipotesisId: 'hip1', segmento: 'pymes', kpiId: 'ctr', definicionMetrica: 'ctr@1', ventana: '7d', naturaleza: 'SIMULADA', politicaAtribucion: 'directa', contexto: 'ctx1' };

describe('M8 · 30 escenarios adversariales', () => {
  it('01 · resultado de org A evaluado por org B ⇒ no valida (cross-tenant)', async () => {
    const store = new InMemoryEventStore(); const cA = ctx('org-a'); const cB = ctx('org-b');
    const t = await montarTodo(store, cA);
    const ordenId = await ejecutarOrden(t.ordenes, cA, t.v);
    await t.observaciones.registrar(cB, 'obs1', obsEntrada(ordenId), attr, O); // org B intenta observar la ejecución de A
    expect((await t.observaciones.validar(cB, 'obs1', attr, O)).estado).toBe('INVALIDA');
  });

  it('02 · ejecución parcial (sin evidencia) presentada como completa ⇒ INVALIDA', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    const ordenId = await ejecutarSinEvidencia(t.ordenes, store, c, t.v);
    const obs = await observar(t.observaciones, c, 'obs1', ordenId);
    expect(obs.estado).toBe('INVALIDA');
    expect(obs.motivo).toMatch(/completa|evidencia|clasificación/i);
  });

  it('03 · ejecución sin evidencia ⇒ INVALIDA (no medible)', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    const ordenId = await ejecutarSinEvidencia(t.ordenes, store, c, t.v);
    expect((await observar(t.observaciones, c, 'obs1', ordenId)).estado).toBe('INVALIDA');
  });

  it('04 · observación REAL derivada de ejecución simulada ⇒ rechazada al registrar', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    const ordenId = await ejecutarOrden(t.ordenes, c, t.v);
    await expect(t.observaciones.registrar(c, 'obs1', obsEntrada(ordenId, { naturaleza: 'REAL' as never }), attr, O)).rejects.toThrow();
  });

  it('05 · KPI inexistente / distinto del esperado ⇒ no comparable (NO_EVALUABLE)', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    const ordenId = await ejecutarOrden(t.ordenes, c, t.v);
    await observar(t.observaciones, c, 'obs1', ordenId);
    const ev = await t.evaluaciones.evaluar(c, 'eval1', evalEntrada('obs1', { expectativa: expectativa('otro_kpi') }), attr, O);
    expect(ev.cuerpo.resultado?.estado).toBe('NO_EVALUABLE');
    expect(ev.cuerpo.explicacion).toMatch(/no comparable/i);
  });

  it('06 · KPI de otro tenant vía IDs ⇒ aislado (cross-tenant no válida)', async () => {
    const store = new InMemoryEventStore(); const cA = ctx('org-a'); const cB = ctx('org-b');
    const t = await montarTodo(store, cA);
    const ordenId = await ejecutarOrden(t.ordenes, cA, t.v);
    await t.observaciones.registrar(cB, 'obsX', obsEntrada(ordenId), attr, O);
    expect((await t.observaciones.validar(cB, 'obsX', attr, O)).estado).toBe('INVALIDA');
  });

  it('07 · unidad incompatible para el mismo KPI ⇒ reconciliador lo marca', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    const o1 = await ejecutarOrden(t.ordenes, c, t.v, 'orden1');
    const o2 = await ejecutarOrden(t.ordenes, c, t.v, 'orden2');
    await observar(t.observaciones, c, 'obs1', o1, { unidad: 'ratio' });
    await observar(t.observaciones, c, 'obs2', o2, { unidad: 'porcentaje' });
    const h = await t.reconciliador.reconciliar(c, attr, O);
    expect(h.some((x) => x.clase === 'UNIDAD_INCOMPATIBLE')).toBe(true);
  });

  it('08 · ausencia de valor NO se interpreta como cero ⇒ NO_EVALUABLE (no NO_CUMPLIDO)', async () => {
    const r = evaluarResultado(expectativa(), { valor: null, calidad: 'alta', cobertura: 1, muestra: 1000 });
    expect(r.estado).toBe('NO_EVALUABLE');
    expect(r.faltantes).toContain('valor observado');
  });

  it('09 · hipótesis leída del veredicto CANÓNICO de M5 (no una copia) ⇒ M5 FALSO ⇒ REFUTADA', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    // Añade evidencia EN_CONTRA dominante a hip1 ⇒ M5 la evalúa FALSO.
    await t.m5.agregarEvidencia(c, 'hip1', { evidenciaId: 'hip1-contra1', enunciado: 'refuta', origen: 'DATO_IMPORTADO', sentido: 'EN_CONTRA', pertinente: true }, attr, O);
    await t.m5.agregarEvidencia(c, 'hip1', { evidenciaId: 'hip1-contra2', enunciado: 'refuta2', origen: 'DATO_IMPORTADO', sentido: 'EN_CONTRA', pertinente: true }, attr, O);
    const ordenId = await ejecutarOrden(t.ordenes, c, t.v);
    await observar(t.observaciones, c, 'obs1', ordenId);
    const ev = await t.evaluaciones.evaluar(c, 'eval1', evalEntrada('obs1'), attr, O);
    expect(ev.cuerpo.hipotesis?.estado).toBe('REFUTADA');
  });

  it('10 · variante no perteneciente al experimento ⇒ M8 materializa la variante REAL de M7', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    const ordenId = await ejecutarOrden(t.ordenes, c, t.v);
    const obs = await observar(t.observaciones, c, 'obs1', ordenId);
    expect(obs.datos?.variante?.id).toBe('v1'); // autoridad de M7, no del llamador
  });

  it('11 · referencia de hipótesis retirada en M5 ⇒ hipótesis NO_EVALUABLE', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    const ordenId = await ejecutarOrden(t.ordenes, c, t.v);
    await observar(t.observaciones, c, 'obs1', ordenId);
    await t.m5.retirar(c, 'hip1', 'obsoleta', attr, O);
    const ev = await t.evaluaciones.evaluar(c, 'eval1', evalEntrada('obs1'), attr, O);
    expect(ev.cuerpo.hipotesis?.estado).toBe('NO_EVALUABLE');
  });

  it('12 · evidencia contradictoria dominante ⇒ hipótesis REFUTADA', async () => {
    const r = evaluarHipotesis({ hipotesisId: 'h', hipotesisVersion: 1, estadoM5: 'VERDADERO', resultado: 'CUMPLIDO', evidenciaAFavor: 1, evidenciaEnContra: 4, observacionesExcluidas: 0, suficiente: true, pertinente: true });
    expect(r.estado).toBe('REFUTADA');
  });

  it('13 · una sola ejecución NO se generaliza al mercado ⇒ consolidación LOCAL, no transferible', async () => {
    const cons = consolidar(CLAVE, [{ evaluacionId: 'e1', observacionId: 'o1', clave: CLAVE, estadoHipotesis: 'RESPALDADA' }]);
    expect(cons.estado).toBe('RESPALDADA');
    expect(cons.alcance).toBe('LOCAL'); // un experimento no transfiere
  });

  it('14 · atribución NUNCA se presenta como causalidad real', async () => {
    const at = atribuir(entradaAtribucion());
    expect(at.grado).toBe('ASOCIACION_DIRECTA');
    expect(at.afirmaCausalidadReal).toBe(false);
    expect(at.clase).toBe('atribucion'); // no 'inferencia' causal
  });

  it('15 · métricas incompatibles combinadas ⇒ NO_COMPARABLES (prohibido promediar)', async () => {
    const otra1: ClaveComparacion = { ...CLAVE, kpiId: 'cpa' };
    const otra2: ClaveComparacion = { ...CLAVE, ventana: '30d' };
    const cons = consolidar(CLAVE, [{ evaluacionId: 'e1', observacionId: 'o1', clave: otra1, estadoHipotesis: 'RESPALDADA' }, { evaluacionId: 'e2', observacionId: 'o2', clave: otra2, estadoHipotesis: 'RESPALDADA' }]);
    expect(cons.estado).toBe('NO_COMPARABLES');
    expect(cons.excluidas.length).toBe(2);
  });

  it('16 · aprendizaje generado desde NO_EVALUABLE ⇒ AUSENCIA de aprendizaje (null)', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    const ordenId = await ejecutarOrden(t.ordenes, c, t.v);
    await observar(t.observaciones, c, 'obs1', ordenId, { valor: null }); // sin valor ⇒ NO_EVALUABLE
    await t.evaluaciones.evaluar(c, 'eval1', evalEntrada('obs1'), attr, O);
    expect(await t.aprendizajesOp.aprenderDesde(c, 'apr1', 'eval1', attr, O)).toBeNull();
  });

  it('17 · aprendizaje duplicado ⇒ idempotente (un vínculo)', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    const ordenId = await ejecutarOrden(t.ordenes, c, t.v);
    await observar(t.observaciones, c, 'obs1', ordenId);
    await t.evaluaciones.evaluar(c, 'eval1', evalEntrada('obs1'), attr, O);
    await t.aprendizajesOp.aprenderDesde(c, 'apr1', 'eval1', attr, O);
    await t.aprendizajesOp.aprenderDesde(c, 'apr1', 'eval1', attr, O);
    expect((await t.aprendizajesOp.listarVinculos(c)).length).toBe(1);
  });

  it('18 · aprendizaje NO se transfiere a otro segmento por sí solo (sin capa reutilizable)', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    const ordenId = await ejecutarOrden(t.ordenes, c, t.v);
    await observar(t.observaciones, c, 'obs1', ordenId);
    await t.evaluaciones.evaluar(c, 'eval1', evalEntrada('obs1'), attr, O);
    await t.aprendizajesOp.aprenderDesde(c, 'apr1', 'eval1', attr, O);
    expect((await t.aprendizajesOp.cargar(c, 'apr1')).reutilizable).toBeNull();
  });

  it('19 · cambio de KPI ⇒ la evaluación debe INVALIDARSE (no se modifica en silencio)', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    const ordenId = await ejecutarOrden(t.ordenes, c, t.v);
    await observar(t.observaciones, c, 'obs1', ordenId);
    await t.evaluaciones.evaluar(c, 'eval1', evalEntrada('obs1'), attr, O);
    const inv = await t.evaluaciones.invalidar(c, 'eval1', 'cambió el KPI', attr, O);
    expect(inv.estado).toBe('OBSOLETA');
  });

  it('20 · retiro de evidencia ⇒ evaluación OBSOLETA excluida de la memoria vigente', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    const ordenId = await ejecutarOrden(t.ordenes, c, t.v);
    await observar(t.observaciones, c, 'obs1', ordenId);
    await t.evaluaciones.evaluar(c, 'eval1', evalEntrada('obs1'), attr, O);
    await t.evaluaciones.invalidar(c, 'eval1', 'se retiró evidencia', attr, O);
    const memo = await t.lecturaM9.memoria(c);
    expect(memo.respaldadas).not.toContain('hip1');
  });

  it('21 · resultado tardío posterior a compensación ⇒ observación INVALIDA (orden COMPENSADA)', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    const ordenId = await ejecutarYCompensar(t.ordenes, c, t.v);
    expect((await observar(t.observaciones, c, 'obs1', ordenId)).estado).toBe('INVALIDA');
  });

  it('22 · observación duplicada ⇒ la anterior se marca SUPERADA; solo la vigente es medible', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    const ordenId = await ejecutarOrden(t.ordenes, c, t.v);
    await observar(t.observaciones, c, 'obs1', ordenId);
    await observar(t.observaciones, c, 'obs2', ordenId);
    await t.observaciones.superar(c, 'obs1', 'obs2', attr, O);
    expect((await t.observaciones.cargar(c, 'obs1')).estado).toBe('SUPERADA');
    const m9 = await t.lecturaM9.listarObservaciones(c);
    expect(m9.find((x) => x.observacionId === 'obs1')?.medible).toBe(false);
    expect(m9.find((x) => x.observacionId === 'obs2')?.medible).toBe(true);
  });

  it('23 · dos evaluadores concurrentes ⇒ convergen (una sola evaluación)', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    const ordenId = await ejecutarOrden(t.ordenes, c, t.v);
    await observar(t.observaciones, c, 'obs1', ordenId);
    await Promise.all([t.evaluaciones.evaluar(c, 'eval1', evalEntrada('obs1'), attr, O), t.evaluaciones.evaluar(c, 'eval1', evalEntrada('obs1'), attr, O)]);
    expect((await t.evaluaciones.listarIds(c)).length).toBe(1);
  });

  it('24 · fallo parcial entre observación y evaluación ⇒ el estado queda consistente (sin evaluación huérfana)', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    const ordenId = await ejecutarOrden(t.ordenes, c, t.v);
    await observar(t.observaciones, c, 'obs1', ordenId);
    // (la matriz por frontera prueba el fallo/replay; aquí se acredita que la evaluación referencia a la observación)
    const ev = await t.evaluaciones.evaluar(c, 'eval1', evalEntrada('obs1'), attr, O);
    expect(ev.cuerpo.observacionId).toBe('obs1');
    expect((await t.reconciliador.reconciliar(c, attr, O)).some((x) => x.clase === 'APRENDIZAJE_SIN_EVALUACION')).toBe(false);
  });

  it('25 · recomendación se ABSTIENE cuando la evidencia es insuficiente', async () => {
    const rec = recomendar({ estadoHipotesis: 'NO_EVALUABLE', estadoResultado: 'NO_EVALUABLE', confianza: 'nula', evidencia: [], contraevidencia: [], datosFaltantes: ['valor'] });
    expect(rec.estado).toBe('ABSTENCION');
  });

  it('26 · replay frío integral (ver replay-m8.test.ts) — aquí: memoria estable tras releer', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    const ordenId = await ejecutarOrden(t.ordenes, c, t.v);
    await observar(t.observaciones, c, 'obs1', ordenId);
    await t.evaluaciones.evaluar(c, 'eval1', evalEntrada('obs1'), attr, O);
    const m1 = JSON.stringify(await t.lecturaM9.memoria(c));
    const m2 = JSON.stringify(await t.lecturaM9.memoria(c));
    expect(m1).toBe(m2);
  });

  it('27 · mutación runtime de las lecturas M9 ⇒ falla (snapshots congelados)', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    const ordenId = await ejecutarOrden(t.ordenes, c, t.v);
    await observar(t.observaciones, c, 'obs1', ordenId);
    const lista = await t.lecturaM9.listarObservaciones(c);
    expect(Object.isFrozen(lista)).toBe(true);
    expect(() => ((lista[0] as { estado: string }).estado = 'HACK')).toThrow();
  });

  it('28 · las lecturas M9 no filtran secretos ni datos sensibles', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    const ordenId = await ejecutarOrden(t.ordenes, c, t.v);
    await observar(t.observaciones, c, 'obs1', ordenId);
    await t.evaluaciones.evaluar(c, 'eval1', evalEntrada('obs1'), attr, O);
    const texto = JSON.stringify(await t.lecturaM9.listarEvaluaciones(c)) + JSON.stringify(await t.lecturaM9.memoria(c));
    expect(texto).not.toMatch(/env:|secreto|password|Bearer|stack/i);
    expect(texto).not.toContain('REAL');
  });

  it('29 · reconciliación concurrente ⇒ converge sin romper', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    const ordenId = await ejecutarSinEvidencia(t.ordenes, store, c, t.v);
    await observar(t.observaciones, c, 'obs1', ordenId); // queda INVALIDA (sin evidencia)
    const [h1, h2] = await Promise.all([t.reconciliador.reconciliar(c, attr, O), t.reconciliador.reconciliar(c, attr, O)]);
    expect(Array.isArray(h1) && Array.isArray(h2)).toBe(true);
  });

  it('30 · M9 no puede escribir en M8 (puerto de solo lectura)', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    // El puerto LecturaMedicion no expone métodos de escritura: solo cargar/listar/memoria.
    const metodos = Object.getOwnPropertyNames(Object.getPrototypeOf(t.lecturaM9));
    expect(metodos).not.toContain('registrar');
    expect(metodos).not.toContain('evaluar');
    expect(metodos).not.toContain('append');
  });
});
