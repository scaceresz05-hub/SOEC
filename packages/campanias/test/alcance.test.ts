/**
 * Alcance geográfico de campaña: siempre a nivel de comuna, por presencia, y comprobable contra el
 * alcance permitido. Lo que se protege es que nadie pueda "ampliar a la región" por omisión.
 */
import { describe, it, expect } from 'vitest';
import { describirAlcance, fueraDeAlcance, validarAlcanceGeografico, type AlcanceGeografico } from '../src/index';

const PROVINCIA: AlcanceGeografico = {
  pais: 'Chile',
  region: 'Región del Maule',
  provincia: 'Provincia de Curicó',
  comunas: ['Curicó', 'Teno', 'Romeral', 'Rauco', 'Molina', 'Sagrada Familia', 'Hualañé', 'Licantén', 'Vichuquén'],
  criterioUbicacion: 'PRESENCIA',
};

describe('alcance geográfico', () => {
  it('un alcance provincial con sus comunas es válido y se describe de forma canónica', () => {
    expect(validarAlcanceGeografico(PROVINCIA)).toEqual([]);
    expect(describirAlcance(PROVINCIA)).toBe('Provincia de Curicó, Región del Maule, Chile');
  });

  it('una región sin comunas NO es un alcance: no se puede ampliar a la región por omisión', () => {
    const region: AlcanceGeografico = { ...PROVINCIA, provincia: null, comunas: [] };
    expect(validarAlcanceGeografico(region)).toContain('alcance_sin_comunas');
  });

  it('comunas duplicadas (aunque cambien tildes o mayúsculas) se rechazan', () => {
    expect(validarAlcanceGeografico({ ...PROVINCIA, comunas: ['Curicó', 'curico'] })).toContain('alcance_comuna_duplicada:curico');
  });

  it('sólo se admite segmentar por PRESENCIA, nunca por interés', () => {
    expect(validarAlcanceGeografico({ ...PROVINCIA, criterioUbicacion: 'INTERES' as never })).toContain(
      'alcance_criterio_ubicacion_no_admitido',
    );
  });

  it('fueraDeAlcance detecta comunas de otra provincia y cambios de provincia', () => {
    const conTalca: AlcanceGeografico = { ...PROVINCIA, comunas: [...PROVINCIA.comunas, 'Talca'] };
    expect(fueraDeAlcance(conTalca, PROVINCIA)).toEqual(['comuna:Talca']);
    const otraProvincia: AlcanceGeografico = { ...PROVINCIA, provincia: 'Provincia de Talca', comunas: ['Talca'] };
    expect(fueraDeAlcance(otraProvincia, PROVINCIA)).toEqual(['provincia:Provincia de Talca', 'comuna:Talca']);
    expect(fueraDeAlcance(PROVINCIA, PROVINCIA)).toEqual([]);
  });

  it('la comparación ignora tildes y mayúsculas, pero no el nombre', () => {
    const sinTildes: AlcanceGeografico = { ...PROVINCIA, comunas: ['curico', 'HUALANE'] };
    expect(fueraDeAlcance(sinTildes, PROVINCIA)).toEqual([]);
  });
});
