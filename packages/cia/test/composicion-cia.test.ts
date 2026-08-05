/**
 * @soec/cia · tests · COMPOSICIÓN CIA ↔ PCE/M4 (BLOQUE 1). Prueba que CIA NO tiene un motor de proveedores
 * paralelo: la ejecución simulada rutea por el `OrquestadorAdaptadores` real (sandbox autoritativo, evidencia)
 * y la consumibilidad/degradación la decide la PCE (`esConsumible`). El proveedor vive detrás de la frontera.
 */
import { describe, expect, it } from 'vitest';
import type { CapacidadState } from '@soec/plataforma-capacidades';
import {
  EjecutorCapacidadCIA, ProveedorCapacidadSimulado, type ProveedorCapacidadPCE,
  todosLosProveedoresRef, verificarSinFugaDeProveedor,
} from '../src/index';
import { ctx } from './_setup';

const INSTANTE = '2026-08-04T10:00:00.000Z';

/** Proveedor de capacidad PCE con estado configurable (para probar degradación gobernada). */
class ProveedorConfigurable implements ProveedorCapacidadPCE {
  constructor(private readonly over: Partial<CapacidadState>) {}
  capacidadState(org: string, tipo: string): CapacidadState {
    return { ...new ProveedorCapacidadSimulado().capacidadState(org, tipo), ...this.over };
  }
}

describe('CIA · composición: la ejecución rutea por el orquestador M4 real', () => {
  it('una capacidad consumible ejecuta en SIMULADO y produce evidencia operativa del sandbox M4', async () => {
    const ej = new EjecutorCapacidadCIA();
    const r = await ej.ejecutar(ctx(), { capacidadTipoPCE: 'correo', proveedorElegidoRef: 'correo-alfa', operacion: 'ejecutar', instante: INSTANTE });
    expect(r.ejecutado).toBe(true);
    expect(r.motivo).toBe('EJECUTADA_SIMULADA');
    expect(r.evidenciaOperativaRef).toBeTruthy(); // evidencia del sandbox M4 (no un segundo sandbox)
    // el mensaje de producto no filtra proveedor
    verificarSinFugaDeProveedor({ mensaje: r.mensajeProducto }, todosLosProveedoresRef());
  });

  it('sustituir el proveedor detrás de la frontera NO cambia el mensaje de producto (sólo la auditoría)', async () => {
    const ej = new EjecutorCapacidadCIA();
    const a = await ej.ejecutar(ctx(), { capacidadTipoPCE: 'correo', proveedorElegidoRef: 'correo-alfa', operacion: 'ejecutar', instante: INSTANTE });
    const b = await ej.ejecutar(ctx(), { capacidadTipoPCE: 'correo', proveedorElegidoRef: 'correo-beta', operacion: 'ejecutar', instante: INSTANTE });
    expect(a.mensajeProducto).toBe(b.mensajeProducto); // misma experiencia
    expect(a.proveedorElegidoRef).not.toBe(b.proveedorElegidoRef); // distinta herramienta detrás
  });
});

describe('CIA · composición: degradación gobernada por la PCE, en lenguaje de producto', () => {
  it('capacidad no consumible con política DETENER → no ejecuta y lo explica sin enums ni proveedor', async () => {
    const ej = new EjecutorCapacidadCIA(undefined, new ProveedorConfigurable({ estado: 'PAUSADA', politicaDegradacion: 'DETENER' }));
    const r = await ej.ejecutar(ctx(), { capacidadTipoPCE: 'captar-clientes', proveedorElegidoRef: 'ads-alfa', operacion: 'ejecutar', instante: INSTANTE });
    expect(r.ejecutado).toBe(false);
    expect(r.motivo).toBe('DETENIDA');
    expect(r.mensajeProducto).toContain('presupuesto'); // "Detuve la acción para proteger tu presupuesto."
    expect(r.mensajeProducto).not.toMatch(/DETENER|PAUSADA|SIMULADA/); // sin enums
    verificarSinFugaDeProveedor({ mensaje: r.mensajeProducto }, todosLosProveedoresRef());
  });

  it('capacidad no consumible con política ABSTENER → se abstiene, sin inventar resultado', async () => {
    const ej = new EjecutorCapacidadCIA(undefined, new ProveedorConfigurable({ salud: 'NO_CONFIABLE', politicaDegradacion: 'ABSTENER' }));
    const r = await ej.ejecutar(ctx(), { capacidadTipoPCE: 'medir', proveedorElegidoRef: 'analitica-alfa', operacion: 'ejecutar', instante: INSTANTE });
    expect(r.ejecutado).toBe(false);
    expect(r.motivo).toBe('ABSTENIDA');
    expect(r.evidenciaOperativaRef).toBeNull(); // no hubo ejecución, no hay evidencia de acción
  });
});
