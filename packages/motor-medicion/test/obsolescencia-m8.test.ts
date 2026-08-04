/**
 * @soec/motor-medicion · tests · MATRIZ DE OBSOLESCENCIA E INVALIDACIÓN.
 *
 * Ante un cambio de supuestos, la evaluación vigente pasa a OBSOLETA/REQUIERE_REVISION (nunca en silencio);
 * el aprendizaje deja de ser vigente; la recomendación anterior no se hereda; la memoria conserva el
 * histórico; una nueva versión no sobrescribe la anterior; el contrato M9 marca la versión inválida; el
 * evento de obsolescencia es idempotente y concurrentemente seguro.
 */
import { describe, expect, it } from 'vitest';
import { InMemoryEventStore, ctx, attr, O, montarTodo, ejecutarOrden, observar, evalEntrada } from './_setup';

const CAUSAS = [
  'hipótesis cambia de versión', 'KPI cambia', 'segmento cambia', 'estrategia cambia', 'pieza cambia',
  'variante cambia', 'evidencia se retira', 'medición se corrige', 'atribución cambia', 'contradicción dominante',
];

async function base(store: InMemoryEventStore, c = ctx()) {
  const t = await montarTodo(store, c);
  const ordenId = await ejecutarOrden(t.ordenes, c, t.v);
  await observar(t.observaciones, c, 'obs1', ordenId);
  await t.evaluaciones.evaluar(c, 'eval1', evalEntrada('obs1'), attr, O);
  await t.aprendizajesOp.aprenderDesde(c, 'apr1', 'eval1', attr, O);
  return t;
}

describe('M8 · obsolescencia por cada causa', () => {
  for (const causa of CAUSAS) {
    it(`causa "${causa}" ⇒ evaluación OBSOLETA; aprendizaje no vigente; memoria conserva histórico; M9 marca`, async () => {
      const store = new InMemoryEventStore(); const c = ctx();
      const t = await base(store, c);
      await t.evaluaciones.invalidar(c, 'eval1', causa, attr, O);
      expect((await t.evaluaciones.cargar(c, 'eval1')).estado).toBe('OBSOLETA');
      // Aprendizaje deja de ser vigente.
      const apr9 = (await t.lecturaM9.listarAprendizajes(c)).find((x) => x.aprendizajeId === 'apr1');
      expect(apr9?.vigente).toBe(false);
      // Memoria conserva el histórico (intento persiste) pero la hipótesis ya no está respaldada-vigente.
      const memo = await t.lecturaM9.memoria(c);
      expect(memo.intentos).toBe(1);
      expect(memo.respaldadas).not.toContain('hip1');
      expect(memo.aprendizajesInvalidados).toContain('apr1');
      // M9 marca la evaluación como no vigente y no medible; conserva la explicación.
      const ev9 = (await t.lecturaM9.listarEvaluaciones(c)).find((x) => x.evaluacionId === 'eval1');
      expect(ev9?.estado).toBe('OBSOLETA');
      expect(ev9?.vigente).toBe(false);
      expect(ev9?.medible).toBe(false);
    });
  }
});

describe('M8 · invalidación — invariantes', () => {
  it('REQUIERE_REVISION marca la evaluación y su aprendizaje deja de ser vigente', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await base(store, c);
    await t.evaluaciones.marcarRevision(c, 'eval1', 'medición sospechosa', attr, O);
    expect((await t.evaluaciones.cargar(c, 'eval1')).estado).toBe('REQUIERE_REVISION');
    const apr9 = (await t.lecturaM9.listarAprendizajes(c)).find((x) => x.aprendizajeId === 'apr1');
    expect(apr9?.vigente).toBe(false);
  });

  it('una NUEVA versión no sobrescribe la anterior: la histórica queda OBSOLETA y la nueva vigente', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await base(store, c);
    await t.evaluaciones.invalidar(c, 'eval1', 'KPI cambia', attr, O);
    // Nueva versión (nuevo id) para la misma observación.
    await t.evaluaciones.evaluar(c, 'eval1v2', evalEntrada('obs1'), attr, O);
    expect((await t.evaluaciones.cargar(c, 'eval1')).estado).toBe('OBSOLETA'); // histórica intacta
    expect((await t.evaluaciones.cargar(c, 'eval1v2')).estado).toBe('EMITIDA'); // nueva vigente
    const memo = await t.lecturaM9.memoria(c);
    expect(memo.intentos).toBe(2); // memoria conserva ambos intentos
    expect(memo.respaldadas).toContain('hip1'); // la vigente respalda
  });

  it('el evento de obsolescencia es IDEMPOTENTE (invalidar dos veces ⇒ un solo evento)', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await base(store, c);
    await t.evaluaciones.invalidar(c, 'eval1', 'KPI cambia', attr, O);
    await t.evaluaciones.invalidar(c, 'eval1', 'KPI cambia otra vez', attr, O);
    expect((await store.readStream(c, 'evaluacion-op:org-a:eval1')).filter((e) => e.type === 'evaluacion.obsoleta')).toHaveLength(1);
  });

  it('la invalidación es concurrentemente segura (dos invalidaciones convergen)', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await base(store, c);
    await Promise.all([t.evaluaciones.invalidar(c, 'eval1', 'a', attr, O), t.evaluaciones.invalidar(c, 'eval1', 'b', attr, O)]);
    expect((await t.evaluaciones.cargar(c, 'eval1')).estado).toBe('OBSOLETA');
    expect((await store.readStream(c, 'evaluacion-op:org-a:eval1')).filter((e) => e.type === 'evaluacion.obsoleta')).toHaveLength(1);
  });

  it('el reconciliador marca el aprendizaje ligado a una evaluación no vigente', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const t = await base(store, c);
    await t.evaluaciones.invalidar(c, 'eval1', 'evidencia se retira', attr, O);
    const h = await t.reconciliador.reconciliar(c, attr, O);
    expect(h.some((x) => x.clase === 'APRENDIZAJE_CON_EVALUACION_OBSOLETA')).toBe(true);
  });
});
