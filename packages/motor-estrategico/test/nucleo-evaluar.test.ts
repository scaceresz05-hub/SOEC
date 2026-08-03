/**
 * @soec/motor-estrategico · núcleo · tests adversariales del motor de evaluación canónico.
 *
 * Verifica la semántica INVIOLABLE de los cuatro estados y la cadena SSOT → Evaluabilidad → Pertinencia
 * → Suficiencia → Confianza. El objetivo es ROMPER la regla fundacional: que la ausencia de información
 * jamás produzca FALSO, y que GRIS y NO_EVALUABLE nunca se confundan.
 */
import { describe, expect, it } from 'vitest';
import type { TipoEvidencia } from '@soec/negocio';
import {
  type Evidencia,
  type PoliticaEvaluacion,
  type Sentido,
  POLITICA_EVALUACION_DEFECTO,
  esAbstencion,
  esConcluyente,
  evaluar,
} from '../src/index';

let n = 0;
function ev(
  sentido: Sentido,
  origen: TipoEvidencia = 'DATO_IMPORTADO',
  pertinente = true,
): Evidencia {
  n += 1;
  return { evidenciaId: `e${n}`, enunciado: `evidencia ${n}`, origen, sentido, pertinente, motivoPertinencia: null, fuente: null };
}

describe('núcleo · ausencia ≠ conclusión', () => {
  it('sin evidencia alguna ⇒ NO_EVALUABLE (jamás FALSO), confianza null', () => {
    const r = evaluar('la empresa vende a pymes', []);
    expect(r.estado).toBe('NO_EVALUABLE');
    expect(r.confianza).toBeNull();
    expect(r.suficiente).toBe(false);
    expect(r.explicacion.evidenciaUsada).toEqual([]);
    expect(r.explicacion.queImpediriaConcluir.length).toBeGreaterThan(0);
  });

  it('con evidencia registrada pero NINGUNA pertinente ⇒ NO_EVALUABLE, y la evidencia se conserva (no se borra)', () => {
    const r = evaluar('x', [ev('A_FAVOR', 'DATO_IMPORTADO', false), ev('EN_CONTRA', 'HECHO_VERIFICADO', false)]);
    expect(r.estado).toBe('NO_EVALUABLE');
    expect(r.noPertinentes).toBe(2);
    expect(r.pertinentes).toBe(0);
    expect(r.explicacion.queFalta.join(' ')).toContain('pertinente');
  });
});

describe('núcleo · veredictos concluyentes', () => {
  it('1 evidencia fuerte a favor, sin contra ⇒ VERDADERO, confianza ALTA', () => {
    const r = evaluar('x', [ev('A_FAVOR', 'DATO_IMPORTADO')]);
    expect(r.estado).toBe('VERDADERO');
    expect(r.confianza).toBe('ALTA');
    expect(esConcluyente(r.estado)).toBe(true);
    expect(r.explicacion.queImpediriaConcluir).toEqual([]);
  });

  it('1 evidencia NO fuerte a favor, sin contra ⇒ VERDADERO, confianza MEDIA', () => {
    const r = evaluar('x', [ev('A_FAVOR', 'INFERENCIA')]);
    expect(r.estado).toBe('VERDADERO');
    expect(r.confianza).toBe('MEDIA');
    expect(r.explicacion.queFalta.join(' ')).toContain('fuerte');
  });

  it('evidencia en contra dominante y fuerte ⇒ FALSO (veredicto positivo), confianza ALTA', () => {
    const r = evaluar('x', [ev('EN_CONTRA', 'HECHO_VERIFICADO'), ev('EN_CONTRA', 'DATO_IMPORTADO')]);
    expect(r.estado).toBe('FALSO');
    expect(r.confianza).toBe('ALTA');
  });

  it('dominante a favor PERO con evidencia en contra ⇒ confianza degradada a BAJA (contestada)', () => {
    const r = evaluar('x', [ev('A_FAVOR', 'DATO_IMPORTADO'), ev('A_FAVOR', 'DATO_IMPORTADO'), ev('EN_CONTRA', 'INFERENCIA')]);
    expect(r.estado).toBe('VERDADERO');
    expect(r.confianza).toBe('BAJA');
    expect(r.explicacion.queFalta.join(' ')).toContain('contra');
  });
});

describe('núcleo · GRIS (se evaluó, no alcanzó) — distinto de NO_EVALUABLE', () => {
  it('evidencia pertinente equilibrada (1 a favor, 1 en contra) ⇒ GRIS, confianza null', () => {
    const r = evaluar('x', [ev('A_FAVOR', 'DATO_IMPORTADO'), ev('EN_CONTRA', 'DATO_IMPORTADO')]);
    expect(r.estado).toBe('GRIS');
    expect(r.confianza).toBeNull();
    expect(esAbstencion(r.estado)).toBe(true);
    expect(r.explicacion.queImpediriaConcluir.join(' ')).toContain('contradictoria');
  });

  it('por debajo del mínimo de suficiencia ⇒ GRIS, no VERDADERO', () => {
    const politica: PoliticaEvaluacion = { minEvidenciaPertinente: 2, exigeOrigenFuerte: false, version: 'p2' };
    const r = evaluar('x', [ev('A_FAVOR', 'DATO_IMPORTADO')], politica);
    expect(r.estado).toBe('GRIS');
    expect(r.explicacion.queImpediriaConcluir.join(' ')).toContain('insuficiente');
  });

  it('política exige origen fuerte y el lado dominante no lo tiene ⇒ GRIS', () => {
    const politica: PoliticaEvaluacion = { minEvidenciaPertinente: 1, exigeOrigenFuerte: true, version: 'pf' };
    const r = evaluar('x', [ev('A_FAVOR', 'INFERENCIA')], politica);
    expect(r.estado).toBe('GRIS');
    expect(r.explicacion.queImpediriaConcluir.join(' ')).toContain('fuerte');
  });

  it('GRIS y NO_EVALUABLE NO se confunden: mismo enunciado, con/ sin evidencia pertinente', () => {
    const gris = evaluar('x', [ev('A_FAVOR', 'DATO_IMPORTADO'), ev('EN_CONTRA', 'DATO_IMPORTADO')]);
    const noEval = evaluar('x', []);
    expect(gris.estado).toBe('GRIS');
    expect(noEval.estado).toBe('NO_EVALUABLE');
    expect(gris.estado).not.toBe(noEval.estado);
  });
});

describe('núcleo · determinismo y explicabilidad', () => {
  it('el mismo input produce SIEMPRE el mismo resultado (replay determinista)', () => {
    const evs = [ev('A_FAVOR', 'DATO_IMPORTADO'), ev('EN_CONTRA', 'INFERENCIA')];
    expect(evaluar('x', evs)).toEqual(evaluar('x', evs));
  });

  it('toda evaluación explica (porQué) y declara la política usada', () => {
    const r = evaluar('x', [ev('A_FAVOR', 'DATO_IMPORTADO')]);
    expect(r.explicacion.porQue.length).toBeGreaterThan(0);
    expect(r.politicaVersion).toBe(POLITICA_EVALUACION_DEFECTO.version);
    expect(r.explicacion.evidenciaUsada.length).toBe(1);
  });
});
