/**
 * @soec/secretos · M4-B · la caja opaca NUNCA filtra el valor (Art. 4). El valor sólo se accede por
 * `usar(fn)`; toString/JSON/inspect están redactados.
 */
import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { FugaDeSecretoError, SecretoResuelto } from '../src/index';

const VALOR = 'VALOR-SINTETICO-DE-PRUEBA-1234567890';

describe('@soec/secretos · SecretoResuelto opaco', () => {
  const sr = new SecretoResuelto('env:GEN_PRIMARY', VALOR);

  it('el valor sólo se usa por usar(fn) para producir un resultado NO secreto', () => {
    expect(sr.usar((v) => v.length)).toBe(VALOR.length);
    expect(sr.usar((v) => v.startsWith('VALOR-SINTETICO'))).toBe(true);
    expect(sr.secretRef).toBe('env:GEN_PRIMARY');
  });

  it('usar(fn) rechaza el caso identidad (devolver el propio secreto, F-5)', () => {
    expect(() => sr.usar((v) => v)).toThrow(FugaDeSecretoError);
  });

  it('usar(fn) NO detecta exfiltración indirecta — es responsabilidad del callback (documentado)', () => {
    // Objetos/codificaciones/excepciones escapan a la guarda: el contrato lo declara explícitamente.
    expect(sr.usar((v) => ({ token: v })).token).toBe(VALOR);
  });

  it('RIESGO CONTRACTUAL: un callback que lanza con el valor lo expone — responsabilidad de la frontera', () => {
    // No es un camino feliz: demuestra que el ámbito de usar(fn) es privilegiado y su mal uso
    // (throw v, log v, persistir v) queda fuera del alcance técnico del holder. Ver ADR-0022 §F-5.
    let capturado = '';
    try {
      sr.usar((v) => {
        throw new Error(v);
      });
    } catch (e) {
      capturado = (e as Error).message;
    }
    expect(capturado).toContain(VALOR); // el holder NO puede impedir esto; el adaptador consumidor sí debe.
  });

  it('toString / JSON.stringify / util.inspect NO filtran el valor', () => {
    expect(String(sr)).not.toContain(VALOR);
    expect(String(sr)).toContain('REDACTADO');
    expect(JSON.stringify(sr)).not.toContain(VALOR);
    expect(JSON.stringify(sr)).toContain('[REDACTADO]');
    expect(inspect(sr)).not.toContain(VALOR);
    expect(inspect({ anidado: sr })).not.toContain(VALOR);
  });

  it('el campo privado no es enumerable', () => {
    expect(Object.keys(sr)).not.toContain('valor');
    expect(Object.values(sr).join(' ')).not.toContain(VALOR);
  });
});
