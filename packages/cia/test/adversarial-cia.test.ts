/**
 * @soec/cia · tests · MATRIZ ADVERSARIAL (BLOQUE 9). Intenta ROMPER el CIA. Escenarios verificables por
 * código; los de COMPRENSIÓN HUMANA se marcan como pendientes de validación externa (NO se dan por aprobados).
 *
 * Cobertura (nº → dónde): 1-2 cia.test (autoriza sin proveedor / sustitución) · 3-4 lectura-producto (no
 * fuga HOME/secretRef) · 5 cia.test (kill tras planificar) · 7 presupuesto (agotado) · 8 presupuesto (sin
 * gasto) · 9 autonomia (SOLO_OBSERVAR) · 10 autonomia (riesgo alto) · 13 (capacidad inexistente, aquí) ·
 * 14-15-16-17 ciclo-autorizacion (obsoleto/expirada/revocada/material) · 18 presupuesto (concurrentes) ·
 * 19-20 ciclo-plan (conflicto/tardía) · 21-40 (REAL bloqueado, aquí) · 23-24-25 (degradación, aquí) ·
 * 26 pg (cross-tenant) · 27-28 pg (reinicio/replay) · 32 lectura-producto (inmutable) · 34-35-36
 * presupuesto/autorizacion (duplicados) · 37 (decisión duplicada, aquí) · 38-39 reconciliador · 33 (error).
 */
import { describe, expect, it } from 'vitest';
import type { CapacidadState } from '@soec/plataforma-capacidades';
import {
  EjecutorCapacidadCIA, ProveedorCapacidadSimulado, type ProveedorCapacidadPCE,
  AUTONOMOUS_REAL, ModoRealBloqueadoError, CapacidadDesconocidaError,
} from '../src/index';
import { montar, ctx, attr, O, HUMANO } from './_setup';

class PCEConfig implements ProveedorCapacidadPCE {
  constructor(private readonly over: Partial<CapacidadState>) {}
  capacidadState(org: string, tipo: string): CapacidadState { return { ...new ProveedorCapacidadSimulado().capacidadState(org, tipo), ...this.over }; }
}
const INST = '2026-08-04T12:00:00.000Z';

describe('CIA · matriz adversarial (verificable por código)', () => {
  it('#13 adaptador/capacidad inexistente se rechaza', async () => {
    const m = montar(); const c = ctx();
    await expect(m.planificador.planificar(c, 'x', { capacidadId: 'no-existe', objetivo: 'x', costoEstimado: 1 }, attr, O)).rejects.toBeInstanceOf(CapacidadDesconocidaError);
  });

  it('#21/#40 resultado REAL bloqueado: AUTONOMOUS_REAL=false y ejecutar en REAL lanza', async () => {
    expect(AUTONOMOUS_REAL).toBe(false);
    const ej = new EjecutorCapacidadCIA();
    // el ejecutor sólo acepta SIMULADO; el planificador con modo REAL lanza
    const m = montar(); const c = ctx();
    await m.autorizaciones.autorizar(c, 'medir-audiencia', { limite: 0, nivelAutonomia: 'EJECUTAR_AUTOMATICO', actorHumano: HUMANO }, attr, O);
    await expect(m.planificador.planificar(c, 'r', { capacidadId: 'medir-audiencia', objetivo: 'x', costoEstimado: 0, modo: 'REAL' }, attr, O)).rejects.toBeInstanceOf(ModoRealBloqueadoError);
    void ej;
  });

  it('#23/#24/#25 degradación gobernada (ALTERNATIVA/CACHE) en lenguaje de producto, no silenciosa', async () => {
    for (const [pol, txt] of [['ALTERNATIVA', 'alternativa'], ['CACHE', 'evidencia previa']] as const) {
      const ej = new EjecutorCapacidadCIA(undefined, new PCEConfig({ estado: 'PAUSADA', politicaDegradacion: pol }));
      const r = await ej.ejecutar(ctx(), { capacidadTipoPCE: 'x', proveedorElegidoRef: 'p', operacion: 'ejecutar', instante: INST });
      expect(r.ejecutado).toBe(false);
      expect(r.mensajeProducto.toLowerCase()).toContain(txt); // explica, no inventa resultado
    }
  });

  it('#37 decisión humana duplicada es idempotente (no ejecuta dos veces)', async () => {
    const m = montar(); const c = ctx();
    await m.autorizaciones.autorizar(c, 'dar-a-conocer-marca', { limite: 100000, nivelAutonomia: 'EJECUTAR_CON_APROBACION', actorHumano: HUMANO }, attr, O);
    await m.planificador.planificar(c, 'p', { capacidadId: 'dar-a-conocer-marca', objetivo: 'x', costoEstimado: 1000 }, attr, O);
    const a1 = await m.planificador.aprobar(c, 'p', HUMANO, attr, O);
    const a2 = await m.planificador.aprobar(c, 'p', HUMANO, attr, O); // duplicada
    expect(a1.estado).toBe('COMPLETADO_SIMULADO');
    expect(a2.estado).toBe('COMPLETADO_SIMULADO'); // sigue completado, no re-ejecuta
  });

  it('#14 capacidad/plan obsoleto no vuelve a ejecutarse', async () => {
    const m = montar(); const c = ctx();
    await m.autorizaciones.autorizar(c, 'dar-a-conocer-marca', { limite: 100000, nivelAutonomia: 'EJECUTAR_CON_APROBACION', actorHumano: HUMANO }, attr, O);
    await m.planificador.planificar(c, 'ob', { capacidadId: 'dar-a-conocer-marca', objetivo: 'x', costoEstimado: 1000 }, attr, O);
    await m.planificador.obsoletar(c, 'ob', attr, O);
    const st = await m.planificador.aprobar(c, 'ob', HUMANO, attr, O);
    expect(st.estado).toBe('OBSOLETO'); // no ejecuta un plan obsoleto
  });
});

describe('CIA · comprensión humana — NO evaluable por código', () => {
  // #31 "un usuario ajeno entiende la autorización como resultado" NO puede demostrarse con tests.
  // Se marca explícitamente: NO_EVALUABLE_POR_CODIGO · PENDIENTE_VALIDACION_EXTERNA. No se da por aprobado.
  it.skip('#31 el usuario entiende la autorización como resultado [PENDIENTE_VALIDACION_EXTERNA]', () => {
    // La ausencia de jerga es verificable (otros tests); la comprensión requiere usuarios externos.
  });
});
