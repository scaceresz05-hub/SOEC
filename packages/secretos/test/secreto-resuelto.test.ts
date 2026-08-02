/**
 * @soec/secretos · M4-B · la caja opaca NUNCA filtra el valor (Art. 4). El valor sólo se accede por
 * `usar(fn)`; toString/JSON/inspect están redactados.
 */
import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { SecretoResuelto } from '../src/index';

const VALOR = 'VALOR-SINTETICO-DE-PRUEBA-1234567890';

describe('@soec/secretos · SecretoResuelto opaco', () => {
  const sr = new SecretoResuelto('env:GEN_PRIMARY', VALOR);

  it('el valor sólo se accede por usar(fn)', () => {
    expect(sr.usar((v) => v)).toBe(VALOR);
    expect(sr.usar((v) => v.length)).toBe(VALOR.length);
    expect(sr.secretRef).toBe('env:GEN_PRIMARY');
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
