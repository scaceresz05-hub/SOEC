/**
 * Freshness UX: estado explícito del dato (FRESH/STALE/NO_DATA/ERROR) y tiempo futuro relativo.
 * Invariante: un dato STALE/NO_DATA/ERROR nunca se etiqueta como "Actualizado".
 */
import { describe, it, expect } from 'vitest';
import { estadoDato, en } from './meta-ux';

describe('estadoDato', () => {
  it('mapea freshness a estado explícito', () => {
    expect(estadoDato('FRESH').estado).toBe('FRESH');
    expect(estadoDato('STALE').estado).toBe('STALE');
    expect(estadoDato('NEVER_SYNCED').estado).toBe('NO_DATA');
    expect(estadoDato('DEGRADED').estado).toBe('ERROR');
    expect(estadoDato('REAUTH_REQUIRED').estado).toBe('ERROR');
    expect(estadoDato(null).estado).toBe('NO_DATA');
    expect(estadoDato('cualquier-otro').estado).toBe('NO_DATA');
  });
  it('sólo FRESH se rotula "Actualizado"', () => {
    expect(estadoDato('FRESH').texto).toBe('Actualizado');
    for (const f of ['STALE', 'NEVER_SYNCED', 'DEGRADED', 'REAUTH_REQUIRED', null]) {
      expect(estadoDato(f).texto).not.toBe('Actualizado');
    }
  });
});

describe('en (tiempo futuro relativo)', () => {
  it('null ⇒ —; pasado ⇒ en breve', () => {
    expect(en(null)).toBe('—');
    expect(en('2000-01-01T00:00:00.000Z')).toBe('en breve');
  });
  it('futuro ⇒ nunca ISO crudo', () => {
    const fut = new Date(Date.now() + 90 * 60_000).toISOString();
    expect(en(fut)).toMatch(/aprox\. en/);
    expect(en(fut)).not.toContain('T');
  });
});
