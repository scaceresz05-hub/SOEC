/**
 * Aplicabilidad regulatoria ESPECÍFICA por candidato/estrategia: una regla se activa
 * solo por un activador declarado de la estrategia; una estrategia educativa no carga
 * advertencias que no le corresponden; PRELIMINARY nunca certifica.
 */
import { describe, it, expect } from 'vitest';
import { proponerEstrategia } from '../src/index';
import { clinic, comp, hechoSenal, candidatosDe } from './helpers';

describe('@soec/estrategia · regulatorio por candidato', () => {
  it('una regla aplicable se vincula a la estrategia correcta; ninguna certifica', () => {
    // ALTO_NO_SHOW → OBJ-CD-03 → EST-CD-03 (contacta base/usa datos) → activa REG-CD-01 (ADVIERTE).
    const r = proponerEstrategia(
      comp({ hechos: [hechoSenal(clinic(), 'ALTO_NO_SHOW')] }),
      clinic(),
    );
    const cand = candidatosDe(r).find((c) => c.objetivoId === 'OBJ-CD-03')!;
    const adv = cand.advertenciasRegulatorias.find((a) => a.reglaId === 'REG-CD-01')!;
    expect(adv).toBeTruthy();
    expect(adv.estrategiaId).toBe('EST-CD-03');
    expect(adv.efecto).toBe('ADVIERTE');
    for (const a of cand.advertenciasRegulatorias) {
      expect(a.certificaCumplimiento).toBe(false);
      expect(a.estado).toBe('PRELIMINARY');
    }
  });

  it('una estrategia sin activadores (captación local) no carga advertencias', () => {
    // POCAS_SOLICITUDES → OBJ-CD-01 → EST-CD-01 (sin activadores).
    const r = proponerEstrategia(
      comp({ hechos: [hechoSenal(clinic(), 'POCAS_SOLICITUDES')] }),
      clinic(),
    );
    const cand = candidatosDe(r).find((c) => c.objetivoId === 'OBJ-CD-01')!;
    expect(cand.advertenciasRegulatorias).toEqual([]);
    expect(cand.estrategiasSugeridas.every((e) => !e.bloqueada)).toBe(true);
  });
});
