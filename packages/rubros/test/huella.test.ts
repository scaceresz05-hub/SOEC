/**
 * Huella canónica SHA-256 (criterio 6): 64 hex; determinista y repetible; independiente
 * del orden accidental de las colecciones; sensible al contenido; forma corta solo para
 * presentación. La canonicalización no incorpora timestamps de ejecución, rutas ni
 * metadatos transitorios (se demuestra por repetibilidad e independencia de orden).
 */
import { describe, it, expect } from 'vitest';
import { huellaCompleta, huellaCorta, canonicalizar } from '../src/domain/huella';
import { conocimientoClinicaDental } from '../src/rubros/clinica-dental';

const reordenado = {
  ...conocimientoClinicaDental,
  objetivos: [...conocimientoClinicaDental.objetivos].reverse(),
  estrategias: [...conocimientoClinicaDental.estrategias].reverse(),
  regulatorio: [...conocimientoClinicaDental.regulatorio].reverse(),
};

describe('@soec/rubros · huella determinista SHA-256', () => {
  it('la huella completa es SHA-256 (64 hex) y repetible', () => {
    const h = huellaCompleta(conocimientoClinicaDental);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(huellaCompleta(conocimientoClinicaDental));
  });

  it('no depende del orden accidental de las colecciones', () => {
    expect(huellaCompleta(reordenado)).toBe(huellaCompleta(conocimientoClinicaDental));
    expect(canonicalizar(reordenado)).toBe(canonicalizar(conocimientoClinicaDental));
  });

  it('cambia si cambia el contenido', () => {
    const distinto = { ...conocimientoClinicaDental, version: '1.0.1' };
    expect(huellaCompleta(distinto)).not.toBe(huellaCompleta(conocimientoClinicaDental));
  });

  it('la forma corta son los primeros 12 hex, solo para presentación', () => {
    const h = huellaCompleta(conocimientoClinicaDental);
    expect(huellaCorta(h)).toBe(h.slice(0, 12));
    expect(huellaCorta(h)).toMatch(/^[0-9a-f]{12}$/);
  });
});
