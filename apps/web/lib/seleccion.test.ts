/**
 * Regresión del incidente HTTP 400 por URL obsoleta/ inválida en /evaluacion.
 * Verifica la reconciliación de (org, departamento) contra el catálogo gobernado: la UI
 * nunca debe mantener internamente una organización distinta de la mostrada.
 */
import { describe, it, expect } from 'vitest';
import type { Catalogo } from './evaluacion-types';
import { esParValido, primerPar, reconciliar } from './seleccion';

const CAT: Catalogo = {
  organizaciones: [
    {
      id: 'clinica-brille',
      nombre: 'Brille',
      descripcion: '',
      departamentos: [{ id: 'marketing', nombre: 'Marketing', rubroId: 'clinica-dental' }],
    },
    {
      id: 'clinica-nova',
      nombre: 'Nova',
      descripcion: '',
      departamentos: [{ id: 'marketing', nombre: 'Marketing', rubroId: 'clinica-dental' }],
    },
  ],
};

describe('reconciliar — par de la URL contra el catálogo', () => {
  it('URL válida: conserva el par y no marca reconciliado', () => {
    expect(reconciliar(CAT, 'clinica-brille', 'marketing')).toEqual({
      org: 'clinica-brille',
      dep: 'marketing',
      reconciliado: false,
    });
  });

  it('organización inválida (clinica-demo): cae al primer par gobernado, nunca conserva la org obsoleta', () => {
    const r = reconciliar(CAT, 'clinica-demo', 'marketing');
    expect(r.reconciliado).toBe(true);
    expect(r.org).toBe('clinica-brille');
    expect(r.org).not.toBe('clinica-demo');
    expect(r.dep).toBe('marketing');
  });

  it('departamento inválido: selecciona un departamento gobernado de la org válida', () => {
    const r = reconciliar(CAT, 'clinica-brille', 'ventas-inexistente');
    expect(r).toEqual({ org: 'clinica-brille', dep: 'marketing', reconciliado: true });
  });

  it('parámetros vacíos o ausentes: fallback gobernado coherente', () => {
    expect(reconciliar(CAT, '', 'marketing').org).toBe('clinica-brille');
    expect(reconciliar(CAT, 'clinica-brille', '')).toEqual({
      org: 'clinica-brille',
      dep: 'marketing',
      reconciliado: true,
    });
    expect(reconciliar(CAT, null, null)).toEqual({
      org: 'clinica-brille',
      dep: 'marketing',
      reconciliado: true,
    });
  });

  it('catálogo aún no cargado: no inventa selección', () => {
    expect(reconciliar(null, 'x', 'y')).toEqual({ org: '', dep: '', reconciliado: false });
  });
});

describe('esParValido y primerPar', () => {
  it('esParValido reconoce solo pares del catálogo', () => {
    expect(esParValido(CAT, 'clinica-brille', 'marketing')).toBe(true);
    expect(esParValido(CAT, 'clinica-demo', 'marketing')).toBe(false);
    expect(esParValido(CAT, 'clinica-brille', 'ventas')).toBe(false);
    expect(esParValido(null, 'clinica-brille', 'marketing')).toBe(false);
  });

  it('primerPar devuelve el primer par gobernado', () => {
    expect(primerPar(CAT)).toEqual({ org: 'clinica-brille', dep: 'marketing' });
    expect(primerPar(null)).toEqual({ org: '', dep: '' });
  });
});
