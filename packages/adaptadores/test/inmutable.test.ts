/**
 * @soec/adaptadores · M4-C-A-H · inmutabilidad (C-5). Clonado y congelado profundos; rechazo de tipos
 * mutables/no soportados y referencias circulares.
 */
import { describe, expect, it } from 'vitest';
import { AdaptadorInvalidoError, blindar, clonarProfundo, congelarProfundo } from '../src/index';

describe('@soec/adaptadores · inmutable', () => {
  it('clona en profundidad datos simples (copia independiente)', () => {
    const orig = { a: '1', n: [{ b: '2' }] };
    const copia = clonarProfundo(orig);
    expect(copia).toEqual(orig);
    (orig.n[0] as { b: string }).b = 'X';
    expect(copia.n[0]?.b).toBe('2'); // independiente
  });

  it('congela en profundidad', () => {
    const c = congelarProfundo({ a: { b: '1' } });
    expect(Object.isFrozen(c)).toBe(true);
    expect(Object.isFrozen(c.a)).toBe(true);
  });

  it('blindar = clonar + congelar', () => {
    const b = blindar({ x: '1' });
    expect(Object.isFrozen(b)).toBe(true);
  });

  it('rechaza Function / Map / Set / referencias circulares / prototipos arbitrarios', () => {
    expect(() => clonarProfundo({ f: () => 1 })).toThrow(AdaptadorInvalidoError);
    expect(() => clonarProfundo({ m: new Map() })).toThrow(AdaptadorInvalidoError);
    expect(() => clonarProfundo({ s: new Set() })).toThrow(AdaptadorInvalidoError);
    const circ: Record<string, unknown> = {};
    circ.self = circ;
    expect(() => clonarProfundo(circ)).toThrow(AdaptadorInvalidoError);
    class Raro { x = 1; }
    expect(() => clonarProfundo({ r: new Raro() })).toThrow(AdaptadorInvalidoError);
  });
});
