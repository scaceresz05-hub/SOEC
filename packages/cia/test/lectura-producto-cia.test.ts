/**
 * @soec/cia · tests · LECTURA DE PRODUCTO (BLOQUE 8). Puerto único inmutable, sin fuga de proveedor ni
 * tecnicismos; auditoría técnica separada; congelamiento profundo con prueba de mutación en runtime.
 */
import { describe, expect, it } from 'vitest';
import { todosLosProveedoresRef } from '../src/index';
import { montar, ctx, attr, O, HUMANO } from './_setup';

async function prep(m: ReturnType<typeof montar>, c: ReturnType<typeof ctx>) {
  await m.autorizaciones.autorizar(c, 'captar-clientes-publicidad', { limite: 100000, nivelAutonomia: 'EJECUTAR_AUTOMATICO', actorHumano: HUMANO }, attr, O);
  await m.planificador.planificar(c, 'p', { capacidadId: 'captar-clientes-publicidad', objetivo: 'x', costoEstimado: 5000 }, attr, O);
}

describe('CIA · lectura de producto (LecturaCIAProducto)', () => {
  it('la instantánea de producto NO contiene proveedor, secreto, endpoint ni nombre comercial', async () => {
    const m = montar(); const c = ctx();
    await prep(m, c);
    const v = await m.producto.producto(c);
    const serial = JSON.stringify(v).toLowerCase();
    for (const ref of todosLosProveedoresRef()) expect(serial.includes(ref)).toBe(false);
    for (const t of ['secretref', 'sdk', 'endpoint', 'meta', 'google', 'ads-', 'https://']) expect(serial.includes(t)).toBe(false);
    expect(v.modo).toBe('simulado');
  });

  it('la auditoría técnica SÍ expone el proveedor detrás de la frontera (separada del producto)', async () => {
    const m = montar(); const c = ctx();
    await prep(m, c);
    const audit = await m.producto.auditoriaTecnica(c);
    expect(audit.length).toBeGreaterThan(0);
    expect(todosLosProveedoresRef()).toContain(audit[0]!.proveedorElegidoRef);
  });

  it('la instantánea está congelada en profundidad (no mutable en runtime)', async () => {
    const m = montar(); const c = ctx();
    await prep(m, c);
    const v = await m.producto.producto(c);
    expect(Object.isFrozen(v)).toBe(true);
    expect(Object.isFrozen(v.capacidades)).toBe(true);
    expect(() => { (v as { modo: string }).modo = 'real'; }).toThrow();
  });

  it('la salud refleja la pausa (kill-switch) en lenguaje de producto', async () => {
    const m = montar(); const c = ctx();
    await prep(m, c);
    await m.kill.activar(c, 'ORG', attr, O);
    const v = await m.producto.producto(c);
    expect(v.salud.estado).toBe('pausado');
  });
});
