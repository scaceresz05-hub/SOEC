/**
 * @soec/motor-operacion · tests · RE-EVALUACIÓN DE GATES ENTRE INTENTOS (retry canónico con backoff).
 *
 * Tras un fallo temporal (attempt 1), durante el backoff se MODIFICA individualmente cada gate; el siguiente
 * intento debe DETENERSE con el gate correcto y SIN duplicar el efecto lógico. Los gates del orquestador M7
 * (PAUSA, vigencia M6, aprobación, calendario, expiración, cancelación) se prueban directamente; los del
 * sandbox M4 (capacidad/health/breaker/kill-switch) se re-evalúan porque el adaptador se RE-INVOCA en cada
 * intento (su lógica interna está probada en @soec/adaptadores).
 */
import { describe, expect, it } from 'vitest';
import {
  InMemoryEventStore, ctx, attr, O, EXEC, prepararM6, montarM7, entradaOrden, hastaEnCola,
  AdaptadorMutable, AprobacionService, trabajoIdDe, CLAVE, contarEventos,
  type EscenarioSimulado, type PuertoEjecucionSimulada, type PeticionEjecucion,
} from './_setup';
import { PausaService, ALCANCE_GLOBAL } from '@soec/control';

const ORG = 'org-a';
const politica = (baseMs: number) => ({ habilitado: true, maxIntentos: 5, erroresReintentables: ['TIMEOUT'] as const, backoff: 'FIJO' as const, baseMs, jitter: false, version: 'g' });
const sinEfecto = async (store: InMemoryEventStore, c = ctx(), v = 1) => (await contarEventos(store, c, `efecto:${ORG}:${CLAVE(v)}`, 'efecto.aplicado')) === 0;

/** attempt 1 = FALLO_TEMPORAL ⇒ orden FALLIDA + intento 2 re-encolado con backoff. Devuelve tid del intento 2. */
async function attempt1Temporal(ordenes: ReturnType<typeof montarM7>['ordenes'], c: ReturnType<typeof ctx>, v: number, ordenId = 'orden1'): Promise<string> {
  const tid1 = await hastaEnCola(ordenes, c, v, ordenId);
  await ordenes.reclamarYEjecutar(c, tid1, 'w1', EXEC, attr, O);
  return trabajoIdDe(ORG, ordenId, 2);
}
const H2 = '2026-09-01T13:00:00.000Z'; // > EXEC + backoff (2h)

describe('M7 · gates del orquestador re-evaluados entre intentos', () => {
  it('PAUSA activada durante el backoff ⇒ el intento 2 se detiene (sin efecto)', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const v = await prepararM6(store, c);
    const { ordenes } = montarM7(store, new AdaptadorMutable('FALLO_TEMPORAL'), { politicaRetry: politica(7200000) });
    const tid2 = await attempt1Temporal(ordenes, c, v);
    await new PausaService(store).pausar(c, ALCANCE_GLOBAL, 'freno', 'director', attr, O);
    await expect(ordenes.reclamarYEjecutar(c, tid2, 'w1', H2, attr, O)).rejects.toThrow();
    expect(await sinEfecto(store, c, v)).toBe(true);
  });

  it('vigencia M6 perdida (variante revocada) durante el backoff ⇒ intento 2 FALLIDA (sin efecto)', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const v = await prepararM6(store, c);
    const { ordenes } = montarM7(store, new AdaptadorMutable('FALLO_TEMPORAL'), { politicaRetry: politica(7200000) });
    const tid2 = await attempt1Temporal(ordenes, c, v);
    await new AprobacionService(store).decidir(c, { resourceType: 'VARIANTE', resourceId: 'v1', resourceVersion: 1, decision: 'RECHAZADA' }, attr, O);
    expect((await ordenes.reclamarYEjecutar(c, tid2, 'w1', H2, attr, O)).estado).toBe('FALLIDA');
    expect(await sinEfecto(store, c, v)).toBe(true);
  });

  it('aprobación de PIEZA revocada durante el backoff ⇒ intento 2 FALLIDA (sin efecto)', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const v = await prepararM6(store, c);
    const { ordenes } = montarM7(store, new AdaptadorMutable('FALLO_TEMPORAL'), { politicaRetry: politica(7200000) });
    const tid2 = await attempt1Temporal(ordenes, c, v);
    await new AprobacionService(store).decidir(c, { resourceType: 'PIEZA', resourceId: 'paq1', resourceVersion: v, decision: 'RECHAZADA' }, attr, O);
    expect((await ordenes.reclamarYEjecutar(c, tid2, 'w1', H2, attr, O)).estado).toBe('FALLIDA');
    expect(await sinEfecto(store, c, v)).toBe(true);
  });

  it('entrada de calendario cancelada durante el backoff ⇒ intento 2 FALLIDA (sin efecto)', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const v = await prepararM6(store, c);
    const { ordenes } = montarM7(store, new AdaptadorMutable('FALLO_TEMPORAL'), { politicaRetry: politica(7200000) });
    const tid2 = await attempt1Temporal(ordenes, c, v);
    const s = `calendario:${ORG}:prog1`;
    await store.append(c, s, await store.currentVersion(c, s), [{ type: 'cal.entrada_transicionada', payload: { entradaId: 'ent1', estado: 'CANCELADA' }, attribution: attr, occurredAt: O }]);
    expect((await ordenes.reclamarYEjecutar(c, tid2, 'w1', H2, attr, O)).estado).toBe('FALLIDA');
    expect(await sinEfecto(store, c, v)).toBe(true);
  });

  it('ventana de expiración vencida durante el backoff ⇒ intento 2 EXPIRADA (sin efecto)', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const v = await prepararM6(store, c);
    // instante planificado = EXEC; ventana 1h; backoff 2h ⇒ el intento 2 cae fuera de la ventana.
    const { ordenes } = montarM7(store, new AdaptadorMutable('FALLO_TEMPORAL'), { politicaRetry: politica(7200000), ventanaExpiracionMs: 3600000 });
    await ordenes.crearOrden(c, 'orden1', entradaOrden(v, { instantePlanificado: EXEC }), attr, O);
    await ordenes.validar(c, 'orden1', attr, O);
    await ordenes.programar(c, 'orden1', O, attr, O);
    await ordenes.encolar(c, 'orden1', attr, O);
    await ordenes.reclamarYEjecutar(c, trabajoIdDe(ORG, 'orden1', 1), 'w1', EXEC, attr, O); // temporal → intento 2
    expect((await ordenes.reclamarYEjecutar(c, trabajoIdDe(ORG, 'orden1', 2), 'w1', H2, attr, O)).estado).toBe('EXPIRADA');
    expect(await sinEfecto(store, c, v)).toBe(true);
  });

  it('cancelación durante el backoff ⇒ intento 2 no produce efecto; la orden queda CANCELADA', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const v = await prepararM6(store, c);
    const { ordenes } = montarM7(store, new AdaptadorMutable('FALLO_TEMPORAL'), { politicaRetry: politica(7200000) });
    const tid2 = await attempt1Temporal(ordenes, c, v); // orden EN_COLA (intento 2)
    await ordenes.cancelar(c, 'orden1', 'stop', attr, O);
    expect((await ordenes.reclamarYEjecutar(c, tid2, 'w1', H2, attr, O)).estado).toBe('CANCELADA');
    expect(await sinEfecto(store, c, v)).toBe(true);
  });

  it('presupuesto: la reserva del intento 1 se HONRA en el reintento (compromiso ya tomado), sin doble reserva', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const v = await prepararM6(store, c);
    // tope 3 = unidades por ejecución: alcanza para UNA ejecución lógica. El reintento reutiliza su reserva.
    const { ordenes } = montarM7(store, new AdaptadorMutable('FALLO_TEMPORAL'), { politicaRetry: politica(7200000), presupuesto: { topeUnidades: 3, ventanaMs: 60000, version: 'p' }, unidadesPorEjecucion: 3 });
    const tid2 = await attempt1Temporal(ordenes, c, v);
    // El adaptador ya no falla en el intento 2: al reutilizar la reserva no vuelve a chocar con el tope.
    const m7ok = montarM7(store, new AdaptadorMutable('EXITO'), { politicaRetry: politica(7200000), presupuesto: { topeUnidades: 3, ventanaMs: 60000, version: 'p' }, unidadesPorEjecucion: 3 });
    expect((await m7ok.ordenes.reclamarYEjecutar(c, tid2, 'w1', H2, attr, O)).estado).toBe('EJECUTADA_SIMULADA');
    expect(await contarEventos(store, c, `efecto:${ORG}:${CLAVE(v)}`, 'efecto.aplicado')).toBe(1); // efecto una vez
    expect(await m7ok.ordenes.consumoTotal(c)).toBe(3); // consumo una vez (no doble)
  });
});

/** Adaptador que cuenta invocaciones y entrega un escenario distinto por intento (sandbox re-invocado). */
class AdaptadorPorIntento implements PuertoEjecucionSimulada {
  public llamadas = 0;
  constructor(private readonly guion: EscenarioSimulado[], private readonly clases: (string | undefined)[] = []) {}
  async ejecutar(_p: PeticionEjecucion) {
    const i = this.llamadas++;
    const esc = this.guion[i] ?? 'EXITO';
    const mapa: Record<EscenarioSimulado, { resultado: 'EJECUTADA_SIMULADA' | 'FALLIDA_TEMPORAL' | 'FALLIDA_PERMANENTE' | 'RECHAZADA'; codigoError: string | null; reintentable: boolean }> = {
      EXITO: { resultado: 'EJECUTADA_SIMULADA', codigoError: null, reintentable: false },
      FALLO_TEMPORAL: { resultado: 'FALLIDA_TEMPORAL', codigoError: 'TEMPORAL', reintentable: true },
      FALLO_PERMANENTE: { resultado: 'FALLIDA_PERMANENTE', codigoError: 'PERMANENTE', reintentable: false },
      RECHAZO: { resultado: 'RECHAZADA', codigoError: 'RECHAZO', reintentable: false },
    };
    const m = mapa[esc];
    return { ...m, naturaleza: 'SIMULADA' as const, ...(this.clases[i] ? { claseError: this.clases[i] } : {}) };
  }
}

describe('M7 · gates del sandbox M4 re-evaluados por RE-INVOCACIÓN del adaptador en cada intento', () => {
  it('el adaptador se re-invoca en el intento 2; una clase NO reintentable (p. ej. health/capacidad→NO_AUTORIZADO) lo detiene sin efecto', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const v = await prepararM6(store, c);
    // intento 1: temporal (retry); intento 2: el sandbox reporta una condición NO reintentable ⇒ terminal.
    const adaptador = new AdaptadorPorIntento(['FALLO_TEMPORAL', 'RECHAZO'], [undefined, 'NO_AUTORIZADO']);
    const { ordenes } = montarM7(store, adaptador, { politicaRetry: politica(7200000) });
    const tid1 = await hastaEnCola(ordenes, c, v);
    await ordenes.reclamarYEjecutar(c, tid1, 'w1', EXEC, attr, O); // intento 1 temporal
    const st = await ordenes.reclamarYEjecutar(c, trabajoIdDe(ORG, 'orden1', 2), 'w1', H2, attr, O); // intento 2 re-invoca
    expect(adaptador.llamadas).toBe(2); // RE-INVOCADO en cada intento (los gates del sandbox se re-evalúan)
    expect(st.estado).toBe('FALLIDA');
    expect(await sinEfecto(store, c, v)).toBe(true);
  });
});
