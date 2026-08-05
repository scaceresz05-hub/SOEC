/**
 * apps/web · lib · tests del cliente CIA (contrato web↔API). El usuario ve resultados, nunca herramientas;
 * los mensajes de error son comprensibles y nunca códigos crudos; el resumen no filtra proveedor.
 */
import { describe, it, expect } from 'vitest';
import { mensajeDeError, resumenCapacidad } from './cia-client';
import type { CapacidadActiva } from './cia-types';

describe('cia-client · mensajeDeError', () => {
  it('usa el mensaje del servicio cuando está presente', () => {
    expect(mensajeDeError({ error: 'ComandoCiaInvalidoError', mensaje: 'Falta un actor humano.' })).toBe('Falta un actor humano.');
  });
  it('mapea códigos conocidos a texto comprensible', () => {
    expect(mensajeDeError({ error: 'ModoRealBloqueadoError' })).toContain('simulado');
    expect(mensajeDeError({ error: 'NO_AUTORIZADO' })).toContain('sesión');
  });
  it('cae a un mensaje genérico seguro (nunca el código crudo)', () => {
    expect(mensajeDeError({ error: 'AlgoRaroInterno' })).not.toContain('AlgoRaroInterno');
  });
});

describe('cia-client · resumenCapacidad', () => {
  it('expresa el estado y el uso del límite, sin proveedor', () => {
    const c: CapacidadActiva = { capacidadId: 'captar-clientes-publicidad', titulo: 'Captar clientes con publicidad', estado: 'Activa', limite: 100000, consumidoSimulado: 25000, disponible: 75000 };
    const r = resumenCapacidad(c);
    expect(r).toContain('25%');
    expect(r.toLowerCase()).not.toMatch(/meta|google|ads-|proveedor/);
  });
});
