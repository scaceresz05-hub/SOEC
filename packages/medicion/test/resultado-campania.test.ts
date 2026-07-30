/**
 * Resultado de campaña con procedencia y atribución (Bloque F). Verifica:
 *   - una métrica SIMULADA no produce ROI real;
 *   - una métrica ESTIMADA no se presenta como observada;
 *   - ingresos sin atribución suficiente ⇒ no concluyente;
 *   - métricas de otra organización no pueden incorporarse;
 *   - división por cero (gasto 0) y períodos incompletos se manejan explícitamente.
 */
import { describe, it, expect } from 'vitest';
import {
  evaluarResultadoCampania,
  dividirSeguro,
  esProcedenciaReal,
  MetricaCruzadaError,
  type ConversionObservada,
  type EntradaResultadoCampania,
} from '../src/index';

const ORG = 'smileflow';
const CAMP = 'c1';
const ventana = '2026-08';

function conv(campaignRef: string | null, valor: number, id = 'x'): ConversionObservada {
  return { id, externalRef: null, campaignRef, valor, ocurridoEn: '2026-08-10T00:00:00.000Z' };
}

function entrada(over: Partial<EntradaResultadoCampania> = {}): EntradaResultadoCampania {
  return {
    organizacionId: ORG,
    campaignRef: CAMP,
    ventana,
    gasto: { valor: 100000, procedencia: 'OBSERVADA' },
    ingresos: { valor: 300000, procedencia: 'OBSERVADA' },
    conversiones: [conv(CAMP, 300000, 'v1')],
    periodoCompleto: true,
    ...over,
  };
}

describe('@soec/medicion · resultado de campaña · ROI honesto', () => {
  it('camino concluyente: ingresos observados + atribuidos + gasto>0 + período cerrado', () => {
    const r = evaluarResultadoCampania(entrada());
    expect(r.concluyente).toBe(true);
    expect(r.roiReal).toBeCloseTo(2); // (300000-100000)/100000
    expect(r.ingresosObservados).toBe(true);
  });

  it('una métrica SIMULADA no produce ROI real', () => {
    const r = evaluarResultadoCampania(entrada({ ingresos: { valor: 300000, procedencia: 'SIMULADA' } }));
    expect(r.roiReal).toBeNull();
    expect(r.concluyente).toBe(false);
    expect(r.roiEstimado).not.toBeNull(); // se conserva como ilustrativo
    expect(r.motivo).toContain('simulad');
  });

  it('una métrica ESTIMADA no se presenta como observada', () => {
    const r = evaluarResultadoCampania(entrada({ ingresos: { valor: 300000, procedencia: 'ESTIMADA' } }));
    expect(r.ingresosObservados).toBe(false);
    expect(r.roiReal).toBeNull();
    expect(r.concluyente).toBe(false);
  });

  it('ingresos sin atribución suficiente ⇒ resultado no concluyente', () => {
    // Conversiones sin identificador de campaña ⇒ no atribuidas.
    const r = evaluarResultadoCampania(entrada({ conversiones: [conv(null, 300000, 'v1')] }));
    expect(r.atribucion.clase).not.toBe('atribucion');
    expect(r.roiReal).toBeNull();
    expect(r.concluyente).toBe(false);
    expect(r.motivo).toContain('atribución');
  });

  it('gasto 0 ⇒ ROI indefinido (división por cero manejada)', () => {
    const r = evaluarResultadoCampania(entrada({ gasto: { valor: 0, procedencia: 'OBSERVADA' } }));
    expect(r.roiReal).toBeNull();
    expect(r.concluyente).toBe(false);
    expect(r.motivo).toContain('gasto');
    expect(dividirSeguro(10, 0)).toBeNull();
    expect(dividirSeguro(10, 5)).toBe(2);
  });

  it('período incompleto ⇒ ROI provisional, no concluyente', () => {
    const r = evaluarResultadoCampania(entrada({ periodoCompleto: false }));
    expect(r.concluyente).toBe(false);
    expect(r.roiReal).toBeNull();
    expect(r.roiEstimado).toBeCloseTo(2);
    expect(r.motivo).toContain('incompleto');
  });

  it('métricas de otra organización no pueden incorporarse', () => {
    expect(() =>
      evaluarResultadoCampania(entrada({ organizacionPorConversion: ['otra-org'] })),
    ).toThrow(MetricaCruzadaError);
  });

  it('esProcedenciaReal distingue reales de estimadas/simuladas', () => {
    expect(esProcedenciaReal('OBSERVADA')).toBe(true);
    expect(esProcedenciaReal('IMPORTADA')).toBe(true);
    expect(esProcedenciaReal('CALCULADA')).toBe(true);
    expect(esProcedenciaReal('ESTIMADA')).toBe(false);
    expect(esProcedenciaReal('SIMULADA')).toBe(false);
  });
});
