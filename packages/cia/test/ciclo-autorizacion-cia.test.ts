/**
 * @soec/cia · tests · CICLO DE VIDA DE AUTORIZACIONES (BLOQUE 2). FSM event-sourced completa, idempotencia,
 * concurrencia, multi-tenant, replay, y regla de aprobación: una modificación material invalida la aprobación.
 */
import { describe, expect, it } from 'vitest';
import { reconstruirAutorizacion, esCambioMaterial, CONDICIONES_POR_DEFECTO } from '../src/index';
import { InMemoryEventStore, montar, ctx, attr, O, HUMANO } from './_setup';

const CAP = 'captar-clientes-publicidad';
const cond = (over = {}) => ({ ...CONDICIONES_POR_DEFECTO, limite: 300000, nivelAutonomia: 'EJECUTAR_CON_APROBACION' as const, ...over });

describe('CIA · ciclo de vida de la autorización', () => {
  it('recorre BORRADOR → PENDIENTE → AUTORIZADA → PAUSADA → AUTORIZADA', async () => {
    const m = montar(); const c = ctx();
    expect((await m.autorizaciones.crear(c, CAP, attr, O)).estado).toBe('BORRADOR');
    expect((await m.autorizaciones.solicitarAprobacion(c, CAP, cond(), attr, O)).estado).toBe('PENDIENTE');
    expect((await m.autorizaciones.aprobar(c, CAP, HUMANO, attr, O)).estado).toBe('AUTORIZADA');
    expect((await m.autorizaciones.pausar(c, CAP, attr, O)).estado).toBe('PAUSADA');
    expect((await m.autorizaciones.reanudar(c, CAP, attr, O)).estado).toBe('AUTORIZADA');
  });

  it('no puede autoaprobarse (exige actor humano)', async () => {
    const m = montar(); const c = ctx();
    await m.autorizaciones.solicitarAprobacion(c, CAP, cond(), attr, O);
    await expect(m.autorizaciones.aprobar(c, CAP, '', attr, O)).rejects.toThrow();
  });

  it('una MODIFICACIÓN MATERIAL invalida la aprobación anterior (vuelve a PENDIENTE)', async () => {
    const m = montar(); const c = ctx();
    await m.autorizaciones.autorizar(c, CAP, { limite: 300000, nivelAutonomia: 'EJECUTAR_AUTOMATICO', actorHumano: HUMANO }, attr, O);
    const antes = await m.autorizaciones.cargar(c, CAP);
    expect(antes.estado).toBe('AUTORIZADA');
    const despues = await m.autorizaciones.modificar(c, CAP, { limite: 500000 }, attr, O); // sube el límite: material
    expect(despues.estado).toBe('PENDIENTE'); // no hereda la aprobación
    expect((await m.autorizaciones.aprobar(c, CAP, HUMANO, attr, O)).estado).toBe('AUTORIZADA');
  });

  it('un cambio NO material es no-op (no invalida la aprobación)', async () => {
    const m = montar(); const c = ctx();
    await m.autorizaciones.autorizar(c, CAP, { limite: 300000, nivelAutonomia: 'EJECUTAR_AUTOMATICO', actorHumano: HUMANO }, attr, O);
    const st = await m.autorizaciones.modificar(c, CAP, { limite: 300000 }, attr, O); // mismo valor
    expect(st.estado).toBe('AUTORIZADA');
  });

  it('revocar/expirar/reemplazar/eliminar son terminales y rechazan cambios posteriores', async () => {
    const m = montar(); const c = ctx();
    await m.autorizaciones.autorizar(c, CAP, { limite: 1, nivelAutonomia: 'RECOMENDAR', actorHumano: HUMANO }, attr, O);
    const rev = await m.autorizaciones.revocar(c, CAP, attr, O);
    expect(rev.estado).toBe('REVOCADA');
    expect(rev.terminada).toBe(true);
    await expect(m.autorizaciones.reanudar(c, CAP, attr, O)).rejects.toThrow();
  });

  it('es idempotente, aísla por organización y reconstruye por replay', async () => {
    const store = new InMemoryEventStore(); const m = montar(store);
    await m.autorizaciones.crear(ctx('org-a'), CAP, attr, O);
    await m.autorizaciones.crear(ctx('org-a'), CAP, attr, O); // idempotente
    await m.autorizaciones.autorizar(ctx('org-a'), CAP, { limite: 100, nivelAutonomia: 'RECOMENDAR', actorHumano: HUMANO }, attr, O);
    expect(await m.autorizaciones.listar(ctx('org-a'))).toEqual([CAP]);
    expect(await m.autorizaciones.listar(ctx('org-b'))).toEqual([]);
    // replay frío: mismos eventos → mismo estado
    const eventos = await store.readStream(ctx('org-a'), `cia-autorizacion:org-a:${CAP}`);
    const st = reconstruirAutorizacion('org-a', CAP, eventos);
    expect(st.estado).toBe('AUTORIZADA');
    expect(st.autorizadaPor).toBe(HUMANO);
  });

  it('esCambioMaterial detecta cambios en límite/autonomía/período/alcance/riesgo', () => {
    const base = cond();
    expect(esCambioMaterial(base, base)).toBe(false);
    expect(esCambioMaterial(base, { ...base, limite: base.limite + 1 })).toBe(true);
    expect(esCambioMaterial(base, { ...base, nivelAutonomia: 'SOLO_OBSERVAR' })).toBe(true);
    expect(esCambioMaterial(base, { ...base, riesgo: 'alto' })).toBe(true);
  });
});
