import { describe, expect, it } from 'vitest';
import type { ProductoCapacidad } from '../src/domain/product';
import { esOpacaCapacidad, violaSoberaniaCapacidad } from '../src/domain/product';
import { attr } from './helpers';

function producto(over: Partial<ProductoCapacidad>): ProductoCapacidad {
  return {
    capabilityId: 'cap',
    version: 1,
    nombre: 'n',
    proposito: 'p',
    operacionesEjecutadas: [{ stepId: 's', operacion: 'detectar', operacionExecutionId: 'x:s', abstenido: false, causaAbstencion: null, resumen: '1 señal' }],
    productosIntermedios: ['x:s'],
    productoCompuesto: ['detectar [s]: 1 señal'],
    evidencia: ['e1'],
    procedencia: 'x',
    incertidumbre: 'x',
    limitaciones: [],
    faltante: [],
    contradiccionesAbiertas: [],
    cuestionesJuicioHumano: ['la decisión corresponde a la persona'],
    abstenido: false,
    causaAbstencion: null,
    pasoAfectado: null,
    bindingDecision: false,
    atribucion: attr,
    ...over,
  } as ProductoCapacidad;
}

describe('Guardarraíles de producto de capacidad', () => {
  it('detecta un producto vinculante (soberanía)', () => {
    expect(violaSoberaniaCapacidad(producto({}))).toBe(false);
    expect(violaSoberaniaCapacidad({ ...producto({}), bindingDecision: true } as unknown as ProductoCapacidad)).toBe(true);
  });

  it('un producto bien formado no es opaco', () => {
    expect(esOpacaCapacidad(producto({}))).toBe(false);
  });

  it('un producto que oculta las operaciones es opaco', () => {
    expect(esOpacaCapacidad(producto({ operacionesEjecutadas: [] }))).toBe(true);
  });

  it('un producto que no deja nada al juicio humano es opaco', () => {
    expect(esOpacaCapacidad(producto({ cuestionesJuicioHumano: [] }))).toBe(true);
  });

  it('un producto sin soporte (ni composición ni evidencia ni faltante) es opaco', () => {
    expect(esOpacaCapacidad(producto({ productoCompuesto: [], evidencia: [], faltante: [] }))).toBe(true);
  });

  it('una abstención con causa y faltante es comprensible (no opaca)', () => {
    expect(esOpacaCapacidad(producto({ abstenido: true, causaAbstencion: 'x', faltante: ['dato'] }))).toBe(false);
  });
});
