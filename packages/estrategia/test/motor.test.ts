/**
 * Motor de Estrategia v1.1: derivación CAUSAL por señales activas y mapeos versionados,
 * cobertura parcial sin candidatos artificiales, y confianza explicable/monotónica.
 */
import { describe, it, expect } from 'vitest';
import { proponerEstrategia } from '../src/index';
import { clinic, comp, hecho, hechoSenal, faltante, contradiccion, candidatosDe } from './helpers';

const rango = (c: string) => ['LOW', 'MEDIUM', 'HIGH'].indexOf(c);
const objetivos = (r: ReturnType<typeof proponerEstrategia>) =>
  candidatosDe(r).map((c) => c.objetivoId);

describe('@soec/estrategia · derivación causal', () => {
  it('misma comprensión + biblioteca → mismo resultado (determinista)', () => {
    const c = comp({ hechos: [hechoSenal(clinic(), 'POCAS_SOLICITUDES')] });
    expect(proponerEstrategia(c, clinic())).toEqual(proponerEstrategia(c, clinic()));
  });

  it('POCAS_SOLICITUDES → OBJ-CD-01 (captación), con el mapeo en la procedencia', () => {
    const r = proponerEstrategia(
      comp({ hechos: [hechoSenal(clinic(), 'POCAS_SOLICITUDES')] }),
      clinic(),
    );
    const cand = candidatosDe(r).find((c) => c.objetivoId === 'OBJ-CD-01')!;
    expect(cand).toBeTruthy();
    expect(cand.procedencia.entradasRubro).toContain('MAP-CD-01');
    expect(cand.procedencia.senalesActivas).toContain('SIG-CD-01');
  });

  it('BAJA_TASA_AGENDAMIENTO → OBJ-CD-07 (no OBJ-CD-02), por MAP-CD-02', () => {
    const r = proponerEstrategia(
      comp({ hechos: [hechoSenal(clinic(), 'BAJA_TASA_AGENDAMIENTO')] }),
      clinic(),
    );
    expect(objetivos(r)).toContain('OBJ-CD-07');
    expect(objetivos(r)).not.toContain('OBJ-CD-02');
  });

  it('cambiar solo la señal cambia el conjunto de candidatos', () => {
    const pocas = objetivos(
      proponerEstrategia(comp({ hechos: [hechoSenal(clinic(), 'POCAS_SOLICITUDES')] }), clinic()),
    );
    const noshow = objetivos(
      proponerEstrategia(comp({ hechos: [hechoSenal(clinic(), 'ALTO_NO_SHOW')] }), clinic()),
    );
    expect(pocas).toEqual(['OBJ-CD-01']);
    expect(noshow).toEqual(['OBJ-CD-03']);
  });

  it('un objetivo sin mapeo aplicable no aparece aunque esté RATIFIED (OBJ-CD-05)', () => {
    const r = proponerEstrategia(
      comp({ hechos: [hechoSenal(clinic(), 'POCAS_SOLICITUDES')] }),
      clinic(),
    );
    expect(objetivos(r)).not.toContain('OBJ-CD-05');
  });

  it('una señal no se activa por la mera existencia de un hecho (valor=false → INACTIVA)', () => {
    const r = proponerEstrategia(
      comp({ hechos: [hechoSenal(clinic(), 'POCAS_SOLICITUDES', false)] }),
      clinic(),
    );
    expect(r.tipo).toBe('ABSTENCION');
  });

  it('cobertura: dos señales activas → 2 fundados = esperados; una → cobertura parcial', () => {
    const dos = proponerEstrategia(
      comp({
        hechos: [
          hechoSenal(clinic(), 'POCAS_SOLICITUDES'),
          hechoSenal(clinic(), 'BAJA_TASA_AGENDAMIENTO'),
        ],
      }),
      clinic(),
    );
    if (dos.tipo !== 'PROPUESTA') throw new Error('esperaba PROPUESTA');
    expect(dos.cobertura.candidatosFundados).toBe(2);
    expect(dos.cobertura.motivoDeCoberturaParcial).toBeUndefined();

    const uno = proponerEstrategia(
      comp({ hechos: [hechoSenal(clinic(), 'POCAS_SOLICITUDES')] }),
      clinic(),
    );
    if (uno.tipo !== 'PROPUESTA') throw new Error('esperaba PROPUESTA');
    expect(uno.cobertura.candidatosFundados).toBe(1);
    expect(uno.cobertura.motivoDeCoberturaParcial).toBeTruthy();
  });

  it('sin señales activas → abstención evaluable (no candidatos artificiales)', () => {
    const r = proponerEstrategia(comp({ faltantes: [faltante('¿A?')] }), clinic());
    expect(r.tipo).toBe('ABSTENCION');
    if (r.tipo !== 'ABSTENCION') return;
    expect(r.abstencion.faltantesRelevantes).toContain('¿A?');
  });

  it('cada candidato explica detecté/observé/necesito/me falta', () => {
    const r = proponerEstrategia(
      comp({ hechos: [hechoSenal(clinic(), 'POCAS_SOLICITUDES')], faltantes: [faltante('¿A?')] }),
      clinic(),
    );
    for (const c of candidatosDe(r)) {
      expect(c.explicacion.detecte).toContain('señal');
      expect(c.explicacion.observe).toContain('observé');
      expect(c.explicacion.necesito).toContain('necesito');
      expect(c.explicacion.meFalta.length).toBeGreaterThan(0);
    }
  });

  it('confianza explicable y monotónica', () => {
    const rubro = clinic();
    const base = comp({ hechos: [hechoSenal(rubro, 'POCAS_SOLICITUDES')] });
    const conFaltantes = comp({
      hechos: [hechoSenal(rubro, 'POCAS_SOLICITUDES')],
      faltantes: [faltante('¿A?'), faltante('¿B?')],
    });
    const conContra = comp({
      hechos: [hechoSenal(rubro, 'POCAS_SOLICITUDES')],
      contradicciones: [contradiccion('¿X?')],
    });
    const conMasEvidencia = comp({
      hechos: [hechoSenal(rubro, 'POCAS_SOLICITUDES'), hecho('¿otro?', 'dato de apoyo')],
    });

    const conf = (c: ReturnType<typeof proponerEstrategia>) =>
      candidatosDe(c).find((x) => x.objetivoId === 'OBJ-CD-01')!.confianza;
    const c0 = conf(proponerEstrategia(base, clinic()));
    // agregar faltante relevante no aumenta; agregar contradicción no aumenta.
    expect(rango(conf(proponerEstrategia(conFaltantes, clinic())))).toBeLessThanOrEqual(rango(c0));
    expect(rango(conf(proponerEstrategia(conContra, clinic())))).toBeLessThanOrEqual(rango(c0));
    // agregar evidencia respaldatoria no reduce.
    expect(rango(conf(proponerEstrategia(conMasEvidencia, clinic())))).toBeGreaterThanOrEqual(
      rango(c0),
    );

    // factoresConfianza expone las razones.
    const cand = candidatosDe(proponerEstrategia(conContra, clinic())).find(
      (x) => x.objetivoId === 'OBJ-CD-01',
    )!;
    expect(cand.factoresConfianza.contradiccionesQueReducen).toContain('¿X?');
    expect(cand.factoresConfianza.resultado).toBe(cand.confianza);
  });
});
