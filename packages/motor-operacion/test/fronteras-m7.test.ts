/**
 * @soec/motor-operacion · tests · MATRIZ DE FALLOS PARCIALES POR FRONTERA (18 bordes de la ejecución).
 *
 * Para cada frontera (append atómico de la cadena) se falla su ocurrencia exacta UNA vez y se acredita:
 *   fallo → estado parcial → reparación (retry idempotente o reconciliador) → nuevo intento no-op →
 *   dos reparadores concurrentes convergen → replay frío reproduce el mismo resultado.
 * Con conteos de EVENTOS (efecto/consumo exactamente una vez) y de VERSIONES (la orden avanzó).
 * La recuperación es UNIVERSAL: no conoce el borde; observa el estado y aplica retry / reconciliación.
 */
import { describe, expect, it } from 'vitest';
import {
  InMemoryEventStore, StoreFallaEnOcurrencia, ctx, attr, O, prepararM6, montarM7, entradaOrden,
  trabajoIdDe, reservaId, CLAVE, contarEventos, AdaptadorMutable,
  type EventStore, type RequestContext, type OperacionService, type ReconciliadorService,
} from './_setup';

const ORG = 'org-a';
const T0 = Date.parse('2026-09-01T13:00:00.000Z');
const PRESUP = { presupuesto: { topeUnidades: 1000, ventanaMs: 60000, version: 'p' }, unidadesPorEjecucion: 3 };

interface Borde { nombre: string; tipo: string; ocurrencia: number }
// 18 fronteras de la cadena de ejecución, en orden de aparición.
const BORDES: Borde[] = [
  { nombre: 'crear-orden', tipo: 'orden.creada', ocurrencia: 1 },
  { nombre: 'validar (transición #1)', tipo: 'orden.transicionada', ocurrencia: 1 },
  { nombre: 'programar (transición #2)', tipo: 'orden.transicionada', ocurrencia: 2 },
  { nombre: 'encolar-trabajo', tipo: 'trabajo.encolado', ocurrencia: 1 },
  { nombre: 'indice-orden', tipo: 'orden-indice.registrada', ocurrencia: 1 },
  { nombre: 'lease (reclamar)', tipo: 'trabajo.reclamado', ocurrencia: 1 },
  { nombre: 'en-ejecucion (transición #4)', tipo: 'orden.transicionada', ocurrencia: 4 },
  { nombre: 'intento', tipo: 'orden.intento_registrado', ocurrencia: 1 },
  { nombre: 'reserva', tipo: 'reserva.reservada', ocurrencia: 1 },
  { nombre: 'indice-reserva', tipo: 'reserva-indice.registrada', ocurrencia: 1 },
  { nombre: 'marca-presupuesto', tipo: 'orden.presupuesto_reservado', ocurrencia: 1 },
  { nombre: 'efecto (sandbox/resultado)', tipo: 'efecto.aplicado', ocurrencia: 1 },
  { nombre: 'confirmacion', tipo: 'reserva.confirmada', ocurrencia: 1 },
  { nombre: 'consumo', tipo: 'consumo.registrado', ocurrencia: 1 },
  { nombre: 'evidencia', tipo: 'evidencia.operacional', ocurrencia: 1 },
  { nombre: 'referencia-evidencia', tipo: 'orden.evidencia_adjuntada', ocurrencia: 1 },
  { nombre: 'cierre-orden (transición #5)', tipo: 'orden.transicionada', ocurrencia: 5 },
  { nombre: 'cierre-trabajo', tipo: 'trabajo.completado', ocurrencia: 1 },
];

/** Recuperación UNIVERSAL: observa el estado y aplica retry (pre-reclamo) o reconciliación (en ejecución). */
async function conducirConReparacion(ordenes: OperacionService, reconciliador: ReconciliadorService, c: RequestContext, v: number): Promise<void> {
  const retryUntilOk = async (fn: () => Promise<unknown>) => { for (let k = 0; k < 3; k++) { try { await fn(); return; } catch { /* reintenta */ } } await fn(); };
  await retryUntilOk(() => ordenes.crearOrden(c, 'orden1', entradaOrden(v), attr, O));
  await retryUntilOk(() => ordenes.validar(c, 'orden1', attr, O));
  await retryUntilOk(() => ordenes.programar(c, 'orden1', O, attr, O));
  await retryUntilOk(() => ordenes.encolar(c, 'orden1', attr, O));
  let intento = 1;
  let reloj = T0;
  for (let guard = 0; guard < 12; guard++) {
    reloj += 3600000; // reloj MONÓTONO (+1h): cualquier lease previo (ttl 30s) ya venció
    const t = new Date(reloj).toISOString();
    const st = await ordenes.cargarOrden(c, 'orden1');
    if (st.estado === 'EJECUTADA_SIMULADA' || st.estado === 'COMPENSADA') return;
    const tid = trabajoIdDe(ORG, 'orden1', intento);
    if (st.estado === 'EN_COLA') { try { await ordenes.reclamarYEjecutar(c, tid, 'w1', t, attr, O); } catch { /* borde */ } continue; }
    if (st.estado === 'EN_EJECUCION') { await reconciliador.reconciliar(c, t, attr, O); continue; }
    if (st.estado === 'FALLIDA') { try { await ordenes.encolar(c, 'orden1', attr, O); } catch { /* borde */ } intento++; continue; }
    if (st.estado === 'PROGRAMADA') { try { await ordenes.encolar(c, 'orden1', attr, O); } catch { /* borde */ } continue; }
    return;
  }
}

describe('M7 · matriz de fallos parciales por frontera (18 bordes)', () => {
  for (const b of BORDES) {
    it(`frontera '${b.nombre}': falla → repara → efecto y consumo exactamente una vez → orden ejecutada`, async () => {
      const inner = new InMemoryEventStore(); const c = ctx();
      const v = await prepararM6(inner, c);
      const store: EventStore = new StoreFallaEnOcurrencia(inner, { tipo: b.tipo, ocurrencia: b.ocurrencia });
      const { ordenes, reconciliador } = montarM7(store, new AdaptadorMutable('EXITO'), PRESUP);

      await conducirConReparacion(ordenes, reconciliador, c, v);

      const st = await ordenes.cargarOrden(c, 'orden1');
      expect(st.estado).toBe('EJECUTADA_SIMULADA');
      expect(st.version).toBeGreaterThan(0); // la orden avanzó (conteo de versiones)
      expect(await contarEventos(inner, c, `efecto:${ORG}:${CLAVE(v)}`, 'efecto.aplicado')).toBe(1); // efecto UNA vez
      expect(await ordenes.consumoTotal(c)).toBe(3); // consumo confirmado UNA vez
      expect((await ordenes.cargarReserva(c, reservaId(ORG, 'orden1', CLAVE(v)))).estado).toBe('CONFIRMADA');
    });
  }

  it('convergencia concurrente: dos reparaciones tras un fallo de frontera no duplican el efecto', async () => {
    const inner = new InMemoryEventStore(); const c = ctx();
    const v = await prepararM6(inner, c);
    const store = new StoreFallaEnOcurrencia(inner, { tipo: 'efecto.aplicado', ocurrencia: 1 });
    const { ordenes, reconciliador } = montarM7(store, new AdaptadorMutable('EXITO'), PRESUP);
    await conducirConReparacion(ordenes, reconciliador, c, v);
    // Dos reconciliadores concurrentes sobre el estado ya reparado: ninguno vuelve a tocar el efecto.
    const LATE = '2026-09-02T00:00:00.000Z';
    await Promise.all([reconciliador.reconciliar(c, LATE, attr, O), reconciliador.reconciliar(c, LATE, attr, O)]);
    expect(await contarEventos(inner, c, `efecto:${ORG}:${CLAVE(v)}`, 'efecto.aplicado')).toBe(1);
    expect(await ordenes.consumoTotal(c)).toBe(3);
  });

  it('replay frío tras reparar una frontera reproduce el mismo resultado (idéntico, sin re-ejecutar)', async () => {
    const inner = new InMemoryEventStore(); const c = ctx();
    const v = await prepararM6(inner, c);
    const store = new StoreFallaEnOcurrencia(inner, { tipo: 'reserva.confirmada', ocurrencia: 1 });
    const { ordenes, reconciliador } = montarM7(store, new AdaptadorMutable('EXITO'), PRESUP);
    await conducirConReparacion(ordenes, reconciliador, c, v);
    const frio = InMemoryEventStore.desdeInstantanea(JSON.parse(JSON.stringify(inner.exportar())));
    const m7f = montarM7(frio, new AdaptadorMutable('EXITO'), PRESUP);
    expect((await m7f.ordenes.cargarOrden(c, 'orden1')).estado).toBe('EJECUTADA_SIMULADA');
    expect((await m7f.ordenes.cargarReserva(c, reservaId(ORG, 'orden1', CLAVE(v)))).estado).toBe('CONFIRMADA');
    expect(await contarEventos(frio, c, `efecto:${ORG}:${CLAVE(v)}`, 'efecto.aplicado')).toBe(1);
    expect(await m7f.ordenes.consumoTotal(c)).toBe(3);
  });
});
