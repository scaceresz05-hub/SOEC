/**
 * @soec/motor-operacion · tests · CONTRATOS M8 (LecturaOperativa) — revalidación definitiva.
 *
 * M8 mide resultados; NO muta la ejecución. Debe: (1) NO presentar una ejecución sin evidencia como
 * completa (PARCIAL, no medible); (2) marcar lo NO reconciliado; (3) excluir huérfanas del listado;
 * (4) preservar compensación y consumo; (5) ser profundamente inmutable; (6) quedar IDÉNTICA tras replay frío.
 */
import { describe, expect, it } from 'vitest';
import {
  InMemoryEventStore, ctx, attr, O, FUTURO, EXEC, prepararM6, montarM7, entradaOrden, hastaEnCola,
  AdaptadorMutable, reservaId, CLAVE, type RequestContext, type EventStore,
} from './_setup';

const ORG = 'org-a';
const PRESUP = { presupuesto: { topeUnidades: 100, ventanaMs: 60000, version: 'p' }, unidadesPorEjecucion: 3 };
const raw = async (store: EventStore, c: RequestContext, stream: string, type: string, payload: unknown) => {
  await store.append(c, stream, await store.currentVersion(c, stream), [{ type, payload, attribution: attr, occurredAt: O }]);
};
const buscar = <T extends { ordenId: string }>(xs: readonly T[], id: string): T | undefined => xs.find((x) => x.ordenId === id);

describe('M8 · LecturaOperativa — clasificación honesta y exclusión de huérfanas', () => {
  it('ejecutada SIN evidencia ⇒ PARCIAL y NO medible (no se presenta como completa)', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const v = await prepararM6(store, c);
    const { ordenes, lectura } = montarM7(store);
    await ordenes.crearOrden(c, 'orden1', entradaOrden(v), attr, O);
    for (const e of ['VALIDADA', 'PROGRAMADA', 'EN_COLA', 'EN_EJECUCION', 'EJECUTADA_SIMULADA']) {
      await raw(store, c, `orden:${ORG}:orden1`, 'orden.transicionada', { estado: e, motivo: 'inyección' });
    }
    const m8 = buscar(await lectura.listarOrdenes(c), 'orden1')!;
    expect(m8.estado).toBe('EJECUTADA_SIMULADA');
    expect(m8.clasificacion).toBe('PARCIAL');
    expect(m8.medible).toBe(false);
  });

  it('EN_EJECUCION ⇒ NO_RECONCILIADA y NO medible', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const v = await prepararM6(store, c);
    const { ordenes, lectura } = montarM7(store);
    await ordenes.crearOrden(c, 'orden1', entradaOrden(v), attr, O);
    for (const e of ['VALIDADA', 'PROGRAMADA', 'EN_COLA', 'EN_EJECUCION']) {
      await raw(store, c, `orden:${ORG}:orden1`, 'orden.transicionada', { estado: e, motivo: 'x' });
    }
    const m8 = buscar(await lectura.listarOrdenes(c), 'orden1')!;
    expect(m8.clasificacion).toBe('NO_RECONCILIADA');
    expect(m8.medible).toBe(false);
  });

  it('una orden con stream pero ausente del índice NO aparece en el listado M8 (huérfana excluida)', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const v = await prepararM6(store, c);
    const { ordenes, lectura } = montarM7(store);
    const tid = await hastaEnCola(ordenes, c, v, 'orden1');
    await ordenes.reclamarYEjecutar(c, tid, 'w1', EXEC, attr, O);
    await raw(store, c, `orden:${ORG}:huerf`, 'orden.creada', { capacidad: 'publicacion_social', pieza: { id: 'paq1', version: v }, variante: { id: 'v1', version: 1 }, calendario: { programaId: 'prog1', entradaId: 'ent1' }, contextoId: 'ctx1', segmento: 'pymes', canalLogico: 'blog', instantePlanificado: FUTURO, zonaHoraria: 'UTC', politicaVersion: 'op-v1', idempotencyKey: CLAVE(v, 'huerf') });
    const listado = await lectura.listarOrdenes(c);
    expect(buscar(listado, 'orden1')).toBeTruthy();
    expect(buscar(listado, 'huerf')).toBeUndefined(); // no indexada ⇒ excluida
  });

  it('los snapshots M8 son profundamente inmutables; mutarlos falla y una relectura queda intacta', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const v = await prepararM6(store, c);
    const { ordenes, lectura } = montarM7(store);
    const tid = await hastaEnCola(ordenes, c, v);
    await ordenes.reclamarYEjecutar(c, tid, 'w1', EXEC, attr, O);
    const listado = await lectura.listarOrdenes(c);
    expect(Object.isFrozen(listado)).toBe(true);
    expect(() => ((listado[0] as { estado: string }).estado = 'HACKEADO')).toThrow();
    expect(buscar(await lectura.listarOrdenes(c), 'orden1')!.estado).toBe('EJECUTADA_SIMULADA');
  });
});

describe('M8 · preservación e idempotencia tras replay frío', () => {
  it('tras ejecutar+compensar, el listado M8 y el consumo son IDÉNTICOS desde un store nuevo (log serializado)', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const v = await prepararM6(store, c);
    const { ordenes, lectura } = montarM7(store, new AdaptadorMutable('EXITO'), PRESUP);
    const tid = await hastaEnCola(ordenes, c, v);
    await ordenes.reclamarYEjecutar(c, tid, 'w1', EXEC, attr, O);
    await ordenes.compensar(c, 'orden1', 'reverso', attr, O);
    const listadoCaliente = JSON.parse(JSON.stringify(await lectura.listarOrdenes(c)));
    const consumoCaliente = await ordenes.consumoTotal(c);

    const frio = InMemoryEventStore.desdeInstantanea(JSON.parse(JSON.stringify(store.exportar())));
    const m7f = montarM7(frio, new AdaptadorMutable('EXITO'), PRESUP);
    const listadoFrio = JSON.parse(JSON.stringify(await m7f.lectura.listarOrdenes(c)));

    expect(listadoFrio).toEqual(listadoCaliente); // M8 idéntico tras replay frío
    expect(buscar(listadoFrio as Array<{ ordenId: string; clasificacion: string }>, 'orden1')!.clasificacion).toBe('COMPENSADA');
    expect(await m7f.ordenes.consumoTotal(c)).toBe(consumoCaliente); // consumo preservado
    expect((await m7f.ordenes.cargarReserva(c, reservaId(ORG, 'orden1', CLAVE(v)))).estado).toBe('CONFIRMADA'); // reserva preservada
    expect((await m7f.ordenes.cargarCompensacion(c, `comp:${ORG}:orden1:${CLAVE(v)}`)).estado).toBe('COMPENSADA'); // compensación preservada
  });
});
