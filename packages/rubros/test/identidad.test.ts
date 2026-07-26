/**
 * Identidad y versionado (criterio 6): IDs permanentes únicos dentro del rubro; una
 * biblioteca con IDs duplicados o referencias rotas es rechazada. Versión de biblioteca
 * ≠ versión de aparición de una entrada. (Se usan módulos internos: la representación
 * cruda está disponible solo para pruebas.)
 */
import { describe, it, expect } from 'vitest';
import { todasLasEntradas } from '../src/domain/tipos';
import { crearBiblioteca } from '../src/domain/port';
import { validarBiblioteca, BibliotecaInvalidaError } from '../src/domain/validacion';
import { conocimientoClinicaDental } from '../src/rubros/clinica-dental';
import { crearBibliotecaClinicaDental } from '../src/index';

describe('@soec/rubros · identidad y versionado', () => {
  it('todos los IDs son únicos dentro del rubro', () => {
    const ids = todasLasEntradas(conocimientoClinicaDental).map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('rechaza IDs duplicados', () => {
    const primero = conocimientoClinicaDental.objetivos[0]!;
    const dup = {
      ...conocimientoClinicaDental,
      objetivos: [...conocimientoClinicaDental.objetivos, primero],
    };
    const v = validarBiblioteca(dup);
    expect(v.valido).toBe(false);
    expect(v.errores.some((e) => e.codigo === 'id_duplicado')).toBe(true);
    expect(() => crearBiblioteca(dup)).toThrow(BibliotecaInvalidaError);
  });

  it('rechaza estrategias que atienden objetivos inexistentes', () => {
    const rota = {
      ...conocimientoClinicaDental,
      estrategias: [{ ...conocimientoClinicaDental.estrategias[0]!, atiende: ['OBJ-NO-EXISTE'] }],
    };
    const v = validarBiblioteca(rota);
    expect(v.valido).toBe(false);
    expect(v.errores.some((e) => e.codigo === 'referencia_invalida')).toBe(true);
  });

  it('distingue la versión de la biblioteca de la de aparición de una entrada', () => {
    expect(crearBibliotecaClinicaDental().version().biblioteca).toBe('1.1.0');
    expect(conocimientoClinicaDental.objetivos[0]!.apareceEn).toBe('v1.0');
  });
});
