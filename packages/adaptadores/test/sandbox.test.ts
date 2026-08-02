/**
 * @soec/adaptadores · M4-C-A · sandbox. Rechazo de ejecución REAL sin consumibilidad/estado (Art. 3/8),
 * normalización total de errores (incluida excepción no prevista → DESCONOCIDO), cancelación y evidencia
 * reproducible. Neutral y determinista (instante inyectado).
 */
import { describe, expect, it } from 'vitest';
import { ActorId, OrganizationId, type RequestContext } from '@soec/contracts';
import type { VeredictoConsumo } from '@soec/plataforma-capacidades';
import {
  AdaptadorFake,
  type AdaptadorExterno,
  type PeticionAdaptador,
  Sandbox,
  estadoInicialAdaptador,
} from '../src/index';

const O = '2026-08-02T00:00:00.000Z';
const ctx = (): RequestContext => {
  const o = OrganizationId('org-a');
  return { organizationId: o, actor: ActorId('sistema'), scope: { organizationId: o, permissions: ['events:read'] }, correlationId: 't' };
};
const consumible = (v: boolean): VeredictoConsumo => ({ consumible: v, motivo: v ? '' : 'no está EN_USO', modo: 'REAL', degradada: false, degradacion: null });
const habilitado = { activacion: 'ACTIVADO', modo: 'REAL', credencial: 'CON_CREDENCIAL', consumo: 'CONSUMIBLE', secretRef: 'env:GEN' } as const;
const pet: PeticionAdaptador = { operacion: 'generar', parametros: { a: '1' } };

describe('@soec/adaptadores · Sandbox', () => {
  const sb = new Sandbox();
  const fake = new AdaptadorFake({ capacidad: 'generacion', respuestas: { generar: { titulo: 'Hola' } } });

  it('SIMULADO ejecuta y produce evidencia reproducible', async () => {
    const { resultado, evidencia } = await sb.ejecutar(fake, ctx(), pet, O);
    expect(resultado.estado).toBe('OK');
    expect(evidencia.clave).toBe('generar(a=1)');
    expect(evidencia.capacidad).toBe('generacion');
    expect(evidencia.salud).toBe('SALUDABLE');
    expect(evidencia.observadoEn).toBe(O);
  });

  it('REAL sin estado de frontera habilitado → NO_AUTORIZADO (no ejecuta)', async () => {
    const { resultado } = await sb.ejecutar(fake, ctx(), pet, O, { modoDeseado: 'REAL', estadoAdaptador: estadoInicialAdaptador(), veredicto: consumible(true) });
    expect(resultado.estado).toBe('ERROR');
    expect(resultado.error?.clase).toBe('NO_AUTORIZADO');
    expect(resultado.error?.mensaje).toBe('adaptador DESACTIVADO');
  });

  it('REAL con estado habilitado pero capacidad NO consumible → NO_AUTORIZADO', async () => {
    const { resultado } = await sb.ejecutar(fake, ctx(), pet, O, { modoDeseado: 'REAL', estadoAdaptador: habilitado, veredicto: consumible(false) });
    expect(resultado.error?.clase).toBe('NO_AUTORIZADO');
    expect(resultado.error?.mensaje).toBe('no está EN_USO');
  });

  it('REAL con estado habilitado y capacidad consumible → deja ejecutar (sin proveedor real, sigue fake)', async () => {
    const { resultado } = await sb.ejecutar(fake, ctx(), pet, O, { modoDeseado: 'REAL', estadoAdaptador: habilitado, veredicto: consumible(true) });
    expect(resultado.estado).toBe('OK');
  });

  it('normaliza una excepción no prevista del adaptador → DESCONOCIDO (fail-safe)', async () => {
    const roto: AdaptadorExterno = {
      nombre: 'roto',
      capacidad: 'x',
      version: '0.0.0',
      async salud() {
        return { estado: 'SALUDABLE', detalle: '', observadoEn: O };
      },
      async ejecutar() {
        throw new Error('detalle interno peligroso');
      },
    };
    const { resultado } = await sb.ejecutar(roto, ctx(), pet, O);
    expect(resultado.estado).toBe('ERROR');
    expect(resultado.error?.clase).toBe('DESCONOCIDO');
    expect(resultado.error?.mensaje).not.toContain('detalle interno peligroso'); // no filtra el mensaje original
  });

  it('propaga cancelación como resultado normalizado', async () => {
    const c = new AbortController();
    c.abort('cancel');
    const { resultado } = await sb.ejecutar(fake, ctx(), pet, O, { signal: c.signal });
    expect(resultado.error?.clase).toBe('CANCELADO');
  });

  it('si la salud falla, la evidencia la marca NO_DISPONIBLE sin romper la ejecución', async () => {
    const saludRota: AdaptadorExterno = {
      nombre: 'saludrota',
      capacidad: 'x',
      version: '0.0.0',
      async salud() {
        throw new Error('sin salud');
      },
      async ejecutar() {
        return { estado: 'OK', salida: {}, error: null, modo: 'SIMULADO', adaptador: 'saludrota', version: '0.0.0', observadoEn: O };
      },
    };
    const { resultado, evidencia } = await sb.ejecutar(saludRota, ctx(), pet, O);
    expect(resultado.estado).toBe('OK');
    expect(evidencia.salud).toBe('NO_DISPONIBLE');
  });
});
