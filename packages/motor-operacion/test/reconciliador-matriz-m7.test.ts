/**
 * @soec/motor-operacion · tests · MATRIZ EJECUTABLE DEL RECONCILIADOR.
 *
 * Una prueba por CLASE de inconsistencia del Bloque Maestro: construye la inconsistencia (por API o por
 * inyección de corrupción), corre el reconciliador y verifica detector + clasificación + acción. Al final:
 * convergencia concurrente y no-op tras replay frío. Clasificaciones: REPARADA / NO_REQUIERE_ACCION /
 * NO_REPARABLE / REQUIERE_INTERVENCION.
 */
import { describe, expect, it } from 'vitest';
import {
  InMemoryEventStore, ctx, attr, O, FUTURO, EXEC, EXEC_LATE, prepararM6, montarM7, entradaOrden, hastaEnCola,
  AdaptadorMutable, StoreFallaEvento, AprobacionService, trabajoIdDe, reservaId, CLAVE, contarEventos,
  type EventStore, type RequestContext,
} from './_setup';

const ORG = 'org-a';
const raw = async (store: EventStore, c: RequestContext, stream: string, type: string, payload: unknown, occurredAt = O) => {
  const v = await store.currentVersion(c, stream);
  await store.append(c, stream, v, [{ type, payload, attribution: attr, occurredAt }]);
};
const clase = (h: readonly { clase: string; clasificacion: string }[], k: string) => h.find((x) => x.clase === k);

describe('M7 · matriz del reconciliador — 12 clases de inconsistencia', () => {
  it('ORDEN_PROGRAMADA_SIN_TRABAJO ⇒ REPARADA (encola) [esc. 15]', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const v = await prepararM6(store, c);
    const { ordenes, reconciliador } = montarM7(store);
    await ordenes.crearOrden(c, 'orden1', entradaOrden(v), attr, O);
    await ordenes.validar(c, 'orden1', attr, O);
    await ordenes.programar(c, 'orden1', O, attr, O);
    const h = await reconciliador.reconciliar(c, EXEC, attr, O);
    expect(clase(h, 'ORDEN_PROGRAMADA_SIN_TRABAJO')?.clasificacion).toBe('REPARADA');
    expect((await ordenes.cargarOrden(c, 'orden1')).estado).toBe('EN_COLA');
  });

  it('ORDEN_EN_EJECUCION_ABANDONADA (lease vencido, sin efecto) ⇒ REPARADA (FALLIDA) [esc. 6]', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const v = await prepararM6(store, c);
    const { ordenes, reconciliador } = montarM7(store);
    const tid = await hastaEnCola(ordenes, c, v);
    await raw(store, c, `trabajo:${ORG}:${tid}`, 'trabajo.reclamado', { titular: 'w1', venceEn: '2026-09-01T11:00:01.000Z' });
    await raw(store, c, `orden:${ORG}:orden1`, 'orden.transicionada', { estado: 'EN_EJECUCION', motivo: 'x' });
    const h = await reconciliador.reconciliar(c, EXEC_LATE, attr, O);
    expect(clase(h, 'ORDEN_EN_EJECUCION_ABANDONADA')?.clasificacion).toBe('REPARADA');
    expect((await ordenes.cargarOrden(c, 'orden1')).estado).toBe('FALLIDA');
  });

  it('ORDEN_EJECUTADA_SIN_EVIDENCIA ⇒ REQUIERE_INTERVENCION (no fabrica traza) [esc. 12]', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const v = await prepararM6(store, c);
    const { ordenes, reconciliador } = montarM7(store);
    await ordenes.crearOrden(c, 'orden1', entradaOrden(v), attr, O);
    const s = `orden:${ORG}:orden1`;
    for (const e of ['VALIDADA', 'PROGRAMADA', 'EN_COLA', 'EN_EJECUCION', 'EJECUTADA_SIMULADA']) {
      await raw(store, c, s, 'orden.transicionada', { estado: e, motivo: 'inyección' });
    }
    const h = await reconciliador.reconciliar(c, EXEC, attr, O);
    expect(clase(h, 'ORDEN_EJECUTADA_SIN_EVIDENCIA')?.clasificacion).toBe('REQUIERE_INTERVENCION');
  });

  it('ORDEN_VIGENCIA_PERDIDA (aprobación revocada, pre-efecto) ⇒ REPARADA (OBSOLETA) [esc. 3/4/9]', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const v = await prepararM6(store, c);
    const { ordenes, reconciliador } = montarM7(store);
    await ordenes.crearOrden(c, 'orden1', entradaOrden(v), attr, O);
    await ordenes.validar(c, 'orden1', attr, O);
    await ordenes.programar(c, 'orden1', O, attr, O);
    await new AprobacionService(store).decidir(c, { resourceType: 'VARIANTE', resourceId: 'v1', resourceVersion: 1, decision: 'RECHAZADA' }, attr, O);
    const h = await reconciliador.reconciliar(c, EXEC, attr, O);
    expect(clase(h, 'ORDEN_VIGENCIA_PERDIDA')?.clasificacion).toBe('REPARADA');
    expect((await ordenes.cargarOrden(c, 'orden1')).estado).toBe('OBSOLETA');
  });

  it('EFECTO_SIN_CONSUMO (efecto aplicado, cierre falló) ⇒ REPARADA (confirma + cierra) [esc. 11/13]', async () => {
    const inner = new InMemoryEventStore(); const c = ctx();
    const v = await prepararM6(inner, c);
    const store = new StoreFallaEvento(inner, new Map([['reserva.confirmada', 1]]));
    const { ordenes, lectura, reconciliador } = montarM7(store, new AdaptadorMutable('EXITO'), { presupuesto: { topeUnidades: 100, ventanaMs: 60000, version: 'p' }, unidadesPorEjecucion: 3 });
    const tid = await hastaEnCola(ordenes, c, v);
    await expect(ordenes.reclamarYEjecutar(c, tid, 'w1', EXEC, attr, O)).rejects.toThrow(); // cierre (confirmar) falla tras aplicar el efecto
    const h = await reconciliador.reconciliar(c, EXEC_LATE, attr, O);
    expect(clase(h, 'EFECTO_SIN_CONSUMO')?.clasificacion).toBe('REPARADA');
    expect((await ordenes.cargarOrden(c, 'orden1')).estado).toBe('EJECUTADA_SIMULADA');
    expect((await ordenes.cargarReserva(c, reservaId(ORG, 'orden1', CLAVE(v)))).estado).toBe('CONFIRMADA');
    expect(await contarEventos(inner, c, `efecto:${ORG}:${CLAVE(v)}`, 'efecto.aplicado')).toBe(1); // efecto UNA vez
    expect(await ordenes.consumoTotal(c)).toBe(3); // consumo confirmado UNA vez
    void lectura;
  });

  it('CONSUMO_INCOHERENTE (consumo > confirmado) ⇒ REQUIERE_INTERVENCION [esc. 6/read-model]', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const v = await prepararM6(store, c);
    const { ordenes, reconciliador } = montarM7(store, new AdaptadorMutable('EXITO'), { presupuesto: { topeUnidades: 100, ventanaMs: 60000, version: 'p' }, unidadesPorEjecucion: 3 });
    const tid = await hastaEnCola(ordenes, c, v);
    await ordenes.reclamarYEjecutar(c, tid, 'w1', EXEC, attr, O);
    await raw(store, c, `consumo-op:${ORG}`, 'consumo.registrado', { unidades: 5 }); // corrupción: consumo duplicado/inflado
    const h = await reconciliador.reconciliar(c, EXEC, attr, O);
    expect(clase(h, 'CONSUMO_INCOHERENTE')?.clasificacion).toBe('REQUIERE_INTERVENCION');
  });

  it('TRABAJO_EN_ORDEN_TERMINAL (trabajo activo con orden cancelada) ⇒ REPARADA (falla el trabajo) [esc. 22/26]', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const v = await prepararM6(store, c);
    const { ordenes, lectura, reconciliador } = montarM7(store);
    const tid = await hastaEnCola(ordenes, c, v);
    await ordenes.cancelar(c, 'orden1', 'stop', attr, O);
    const h = await reconciliador.reconciliar(c, EXEC, attr, O);
    expect(clase(h, 'TRABAJO_EN_ORDEN_TERMINAL')?.clasificacion).toBe('REPARADA');
    expect((await lectura.cargarTrabajo(c, tid)).estado).toBe('FALLIDO');
  });

  it('TRABAJO_HUERFANO (trabajo sin orden) ⇒ REPARADA (falla el trabajo) [esc. 1/read-model]', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    await prepararM6(store, c);
    const tid = trabajoIdDe(ORG, 'fantasma', 1);
    await raw(store, c, `orden-indice:${ORG}`, 'orden-indice.registrada', { ordenId: 'fantasma' });
    await raw(store, c, `trabajo:${ORG}:${tid}`, 'trabajo.encolado', { ordenId: 'fantasma', intentoLogico: 1, prioridad: 0, disponibleDesde: O });
    const { lectura, reconciliador } = montarM7(store);
    const h = await reconciliador.reconciliar(c, EXEC, attr, O);
    expect(clase(h, 'TRABAJO_HUERFANO')?.clasificacion).toBe('REPARADA');
    expect((await lectura.cargarTrabajo(c, tid)).estado).toBe('FALLIDO');
  });

  it('RESERVA_HUERFANA (reserva sin ejecución, orden cancelada) ⇒ REPARADA (libera) [esc. 10/11]', async () => {
    const inner = new InMemoryEventStore(); const c = ctx();
    const v = await prepararM6(inner, c);
    const store = new StoreFallaEvento(inner, new Map([['efecto.aplicado', 1]]));
    const { ordenes, reconciliador } = montarM7(store, new AdaptadorMutable('EXITO'), { presupuesto: { topeUnidades: 100, ventanaMs: 60000, version: 'p' }, unidadesPorEjecucion: 3 });
    const tid = await hastaEnCola(ordenes, c, v);
    await expect(ordenes.reclamarYEjecutar(c, tid, 'w1', EXEC, attr, O)).rejects.toThrow(); // reserva creada; efecto falla
    await reconciliador.reconciliar(c, EXEC_LATE, attr, O); // EN_EJECUCION sin efecto → FALLIDA
    await ordenes.cancelar(c, 'orden1', 'stop', attr, O); // FALLIDA → CANCELADA
    const h = await reconciliador.reconciliar(c, EXEC_LATE, attr, O);
    expect(clase(h, 'RESERVA_HUERFANA')?.clasificacion).toBe('REPARADA');
    expect((await ordenes.cargarReserva(c, reservaId(ORG, 'orden1', CLAVE(v)))).estado).toBe('LIBERADA');
  });

  it('COMPENSACION_INCOMPLETA (quedó EN_EJECUCION) ⇒ REPARADA (la lleva a término) [esc. 20]', async () => {
    const inner = new InMemoryEventStore(); const c = ctx();
    const v = await prepararM6(inner, c);
    const store = new StoreFallaEvento(inner, new Map([['compensacion.compensada', 1]]));
    const { ordenes, reconciliador } = montarM7(store);
    const tid = await hastaEnCola(ordenes, c, v);
    await ordenes.reclamarYEjecutar(c, tid, 'w1', EXEC, attr, O);
    await expect(ordenes.compensar(c, 'orden1', 'reverso', attr, O)).rejects.toThrow(); // compensación queda EN_EJECUCION
    const h = await reconciliador.reconciliar(c, EXEC, attr, O);
    expect(clase(h, 'COMPENSACION_INCOMPLETA')?.clasificacion).toBe('REPARADA');
    expect((await ordenes.cargarOrden(c, 'orden1')).estado).toBe('COMPENSADA');
  });

  it('INDICE_INCOMPLETO (orden con reserva ausente del índice) ⇒ REPARADA (reindexar) [esc. 14]', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const v = await prepararM6(store, c);
    const { ordenes, reconciliador } = montarM7(store);
    const clv = CLAVE(v, 'huerf');
    const rid = reservaId(ORG, 'huerf', clv);
    // Orden con stream pero SIN entrada en el índice de órdenes; una reserva la referencia.
    await raw(store, c, `orden:${ORG}:huerf`, 'orden.creada', { capacidad: 'publicacion_social', pieza: { id: 'paq1', version: v }, variante: { id: 'v1', version: 1 }, calendario: { programaId: 'prog1', entradaId: 'ent1' }, contextoId: 'ctx1', segmento: 'pymes', canalLogico: 'blog', instantePlanificado: FUTURO, zonaHoraria: 'UTC', politicaVersion: 'op-v1', idempotencyKey: clv });
    await raw(store, c, `reserva:${ORG}:${rid}`, 'reserva.reservada', { ordenId: 'huerf', claveLogica: clv, unidades: 1, ventanaMs: 0, politicaVersion: 'op-v1' });
    await raw(store, c, `reserva-indice:${ORG}`, 'reserva-indice.registrada', { rid });
    expect(await ordenes.estaEnIndice(c, 'huerf')).toBe(false);
    const h = await reconciliador.reconciliar(c, EXEC, attr, O);
    expect(clase(h, 'INDICE_INCOMPLETO')?.clasificacion).toBe('REPARADA');
    expect(await ordenes.estaEnIndice(c, 'huerf')).toBe(true);
  });

  it('EVIDENCIA_INCOHERENTE (naturaleza ≠ SIMULADO) ⇒ REQUIERE_INTERVENCION [esc. 24]', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const v = await prepararM6(store, c);
    const { ordenes, reconciliador } = montarM7(store);
    const tid = await hastaEnCola(ordenes, c, v);
    await ordenes.reclamarYEjecutar(c, tid, 'w1', EXEC, attr, O);
    // Inyección: una evidencia marcada REAL referenciada por la orden (nunca debe existir).
    await raw(store, c, `evidencia:${ORG}:orden1:evREAL`, 'evidencia.operacional', { naturaleza: 'REAL', resultado: 'EJECUTADA_SIMULADA' });
    await raw(store, c, `orden:${ORG}:orden1`, 'orden.evidencia_adjuntada', { evidenciaRef: 'orden1:evREAL' });
    const h = await reconciliador.reconciliar(c, EXEC, attr, O);
    expect(clase(h, 'EVIDENCIA_INCOHERENTE')?.clasificacion).toBe('REQUIERE_INTERVENCION');
  });
});

describe('M7 · reconciliador — convergencia concurrente y no-op tras replay frío', () => {
  it('dos reconciliadores concurrentes convergen: una reparación, la otra NO_REQUIERE_ACCION [esc. 17]', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const v = await prepararM6(store, c);
    const { ordenes, reconciliador } = montarM7(store);
    await ordenes.crearOrden(c, 'orden1', entradaOrden(v), attr, O);
    await ordenes.validar(c, 'orden1', attr, O);
    await ordenes.programar(c, 'orden1', O, attr, O);
    const [r1, r2] = await Promise.all([reconciliador.reconciliar(c, EXEC, attr, O), reconciliador.reconciliar(c, EXEC, attr, O)]);
    const clsf = [r1, r2].map((r) => r.find((x) => x.clase === 'ORDEN_PROGRAMADA_SIN_TRABAJO')?.clasificacion);
    expect(clsf).toContain('REPARADA');
    expect(clsf).toContain('NO_REQUIERE_ACCION');
    expect((await ordenes.cargarOrden(c, 'orden1')).estado).toBe('EN_COLA');
  });

  it('tras reparar y hacer replay frío, un nuevo reconciliador no encuentra nada que reparar [esc. 16]', async () => {
    const store = new InMemoryEventStore(); const c = ctx();
    const v = await prepararM6(store, c);
    const { ordenes, reconciliador } = montarM7(store);
    await ordenes.crearOrden(c, 'orden1', entradaOrden(v), attr, O);
    await ordenes.validar(c, 'orden1', attr, O);
    await ordenes.programar(c, 'orden1', O, attr, O);
    await reconciliador.reconciliar(c, EXEC, attr, O); // repara (encola)
    const frio = InMemoryEventStore.desdeInstantanea(JSON.parse(JSON.stringify(store.exportar())));
    const m7f = montarM7(frio);
    const h = await m7f.reconciliador.reconciliar(c, EXEC, attr, O);
    expect(h.every((x) => x.clasificacion === 'NO_REQUIERE_ACCION' || x.clase === 'ORDEN_EJECUTADA_SIN_EVIDENCIA')).toBe(true);
    expect(h.some((x) => x.clase === 'ORDEN_PROGRAMADA_SIN_TRABAJO')).toBe(false); // ya reparada; no reaparece
  });
});
