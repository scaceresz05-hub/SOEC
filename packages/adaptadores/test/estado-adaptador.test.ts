/**
 * @soec/adaptadores · M4-C-A · estado de frontera. Un adaptador nace en los cuatro estados seguros y sólo
 * habilita REAL con los cuatro avances (Art. 3/8).
 */
import { describe, expect, it } from 'vitest';
import { estadoInicialAdaptador, puedeEjecutarReal } from '../src/index';

describe('@soec/adaptadores · estado de frontera', () => {
  it('nace DESACTIVADO/SIMULADO/SIN_CREDENCIAL/NO_CONSUMIBLE, sin secretRef', () => {
    const e = estadoInicialAdaptador();
    expect(e).toEqual({ activacion: 'DESACTIVADO', modo: 'SIMULADO', credencial: 'SIN_CREDENCIAL', consumo: 'NO_CONSUMIBLE', secretRef: null });
    expect(puedeEjecutarReal(e).ok).toBe(false);
  });

  it('REAL exige los cuatro avances + secretRef', () => {
    let e = estadoInicialAdaptador();
    expect(puedeEjecutarReal(e).motivo).toBe('adaptador DESACTIVADO');
    e = { ...e, activacion: 'ACTIVADO' };
    expect(puedeEjecutarReal(e).motivo).toBe('adaptador en modo SIMULADO');
    e = { ...e, modo: 'REAL' };
    expect(puedeEjecutarReal(e).motivo).toBe('adaptador SIN_CREDENCIAL');
    e = { ...e, credencial: 'CON_CREDENCIAL', secretRef: 'env:GEN' };
    expect(puedeEjecutarReal(e).motivo).toBe('adaptador NO_CONSUMIBLE');
    e = { ...e, consumo: 'CONSUMIBLE' };
    expect(puedeEjecutarReal(e)).toEqual({ ok: true, motivo: '' });
  });
});
