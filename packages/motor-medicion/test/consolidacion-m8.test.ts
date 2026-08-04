/**
 * @soec/motor-medicion · tests · CONSOLIDACIÓN CANÓNICA ENTRE EXPERIMENTOS.
 *
 * Combina evaluaciones compatibles; excluye las incompatibles con motivo; no cuenta dos veces la misma
 * observación; una sola ejecución no transfiere; la contradicción impide concluir; prohibido promediar
 * incompatibles. Event-sourced, idempotente, multi-tenant, reconstruible por replay.
 */
import { describe, expect, it } from 'vitest';
import { InMemoryEventStore, ctx, attr, O, montarTodo, montarLectura, prepararEval, CLAVE_CANONICA, entradaAtribucion } from './_setup';

const K = CLAVE_CANONICA;
const REFUTA = { valor: 0.005 as number | null }; // < baseline ⇒ NO_CUMPLIDO ⇒ hipótesis REFUTADA

describe('M8 · consolidación canónica multi-experimento', () => {
  it('dos experimentos compatibles RESPALDADOS ⇒ RESPALDADA y TRANSFERIBLE', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    await prepararEval(t, c, 'e1', 'orden1');
    await prepararEval(t, c, 'e2', 'orden2');
    const cons = await t.consolidaciones.consolidar(c, 'cons1', K, ['e1', 'e2'], attr, O);
    expect(cons.cuerpo?.estado).toBe('RESPALDADA');
    expect(cons.cuerpo?.alcance).toBe('TRANSFERIBLE');
    expect(cons.cuerpo?.experimentosUnicos).toBe(2);
  });

  it('tres experimentos con uno incompatible (unidad) ⇒ incluye 2, excluye 1, RESPALDADA', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    await prepararEval(t, c, 'e1', 'orden1');
    await prepararEval(t, c, 'e2', 'orden2');
    await prepararEval(t, c, 'e3', 'orden3', { unidad: 'porcentaje' }); // definición de métrica distinta
    const cons = await t.consolidaciones.consolidar(c, 'cons1', K, ['e1', 'e2', 'e3'], attr, O);
    expect(cons.cuerpo?.incluidas.length).toBe(2);
    expect(cons.cuerpo?.excluidas.length).toBe(1);
    expect(cons.cuerpo?.estado).toBe('RESPALDADA');
  });

  it('resultados contradictorios ⇒ INCONCLUSA (contradicción impide concluir)', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    await prepararEval(t, c, 'e1', 'orden1'); // RESPALDADA
    await prepararEval(t, c, 'e2', 'orden2', REFUTA); // REFUTADA
    const cons = await t.consolidaciones.consolidar(c, 'cons1', K, ['e1', 'e2'], attr, O);
    expect(cons.cuerpo?.estado).toBe('INCONCLUSA');
    expect(cons.cuerpo?.contradicciones.length).toBeGreaterThan(0);
  });

  it('observación duplicada ⇒ NO se cuenta dos veces (experimentosUnicos = 1)', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    await prepararEval(t, c, 'e1', 'orden1'); // crea obs_e1
    await t.evaluaciones.evaluar(c, 'e1b', { observacionId: 'obs_e1', segmento: 'pymes', expectativa: { kpiId: 'ctr', direccion: 'subir', baseline: 0.02, umbral: 0.03, meta: 0.05, muestraMinima: 100, calidadMinima: 'media', coberturaMinima: 0.6 }, hipotesisVersion: 1, evidenciaAFavor: 3, evidenciaEnContra: 0, observacionesExcluidas: 0, suficiente: true, pertinente: true, atribucion: entradaAtribucion() }, attr, O);
    const cons = await t.consolidaciones.consolidar(c, 'cons1', K, ['e1', 'e1b'], attr, O);
    expect(cons.cuerpo?.experimentosUnicos).toBe(1); // misma observación
    expect(cons.cuerpo?.alcance).toBe('LOCAL'); // uno solo no transfiere
  });

  it('una sola ejecución ⇒ LOCAL, no transferible', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    await prepararEval(t, c, 'e1', 'orden1');
    const cons = await t.consolidaciones.consolidar(c, 'cons1', K, ['e1'], attr, O);
    expect(cons.cuerpo?.alcance).toBe('LOCAL');
  });

  for (const [nombre, obsOver, evalOver] of [
    ['unidad', { unidad: 'porcentaje' as const }, {}],
    ['ventana', {}, { atribucion: { ...entradaAtribucion(), ventana: '30d' } }],
    ['atribución', {}, { atribucion: { ...entradaAtribucion(), modelo: 'last_touch' as const } }],
    ['segmento', {}, { segmento: 'enterprise' }],
    ['naturaleza', { naturaleza: 'ESTIMADA' as const }, {}],
    ['contexto', {}, { contexto: 'otro_ctx' }],
  ] as const) {
    it(`distinta ${nombre} ⇒ excluida (no comparable, no se promedia)`, async () => {
      const store = new InMemoryEventStore(); const c = ctx();
      const t = await montarTodo(store, c);
      await prepararEval(t, c, 'e1', 'orden1'); // canónica
      await prepararEval(t, c, 'e2', 'orden2', obsOver, evalOver); // incompatible en un eje
      const cons = await t.consolidaciones.consolidar(c, 'cons1', K, ['e1', 'e2'], attr, O);
      expect(cons.cuerpo?.incluidas).toContain('e1');
      expect(cons.cuerpo?.excluidas.some((x) => x.evaluacionId === 'e2')).toBe(true);
    });
  }

  it('cross-tenant: un evaluacionId ajeno no se incorpora (aislamiento por organización)', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    await prepararEval(t, c, 'e1', 'orden1');
    const cons = await t.consolidaciones.consolidar(c, 'cons1', K, ['e1', 'fantasma_de_otra_org'], attr, O);
    expect(cons.cuerpo?.experimentosUnicos).toBe(1); // el id inexistente/ajeno no cuenta
  });

  it('idempotencia + concurrencia: dos consolidaciones con el mismo id convergen (un evento)', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    await prepararEval(t, c, 'e1', 'orden1');
    await prepararEval(t, c, 'e2', 'orden2');
    await Promise.all([t.consolidaciones.consolidar(c, 'cons1', K, ['e1', 'e2'], attr, O), t.consolidaciones.consolidar(c, 'cons1', K, ['e1', 'e2'], attr, O)]);
    expect((await store.readStream(c, 'consolidacion-op:org-a:cons1')).filter((e) => e.type === 'consolidacion.emitida')).toHaveLength(1);
  });

  it('replay frío: la consolidación se reconstruye idéntica desde un store nuevo', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await montarTodo(store, c);
    await prepararEval(t, c, 'e1', 'orden1');
    await prepararEval(t, c, 'e2', 'orden2');
    const cal = JSON.parse(JSON.stringify((await t.consolidaciones.consolidar(c, 'cons1', K, ['e1', 'e2'], attr, O)).cuerpo));
    const frio = InMemoryEventStore.desdeInstantanea(JSON.parse(JSON.stringify(store.exportar())));
    const f = montarLectura(frio);
    const frioCuerpo = JSON.parse(JSON.stringify((await f.consolidaciones.cargar(c, 'cons1')).cuerpo));
    expect(frioCuerpo).toEqual(cal);
  });
});
