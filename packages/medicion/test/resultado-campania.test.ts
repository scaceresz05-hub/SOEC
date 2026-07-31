/**
 * Resultado de campaña con procedencia y atribución (Bloque F). El ROI sólo es REAL cuando
 * TODOS sus componentes son verificables (gasto e ingresos reales/observados, atribución
 * suficiente, ventana definida, misma org y campaña). Pruebas obligatorias de la auditoría:
 *   1. gasto simulado + ingreso simulado → ROI SIMULADO;
 *   2. gasto observado + ingreso estimado → ROI ESTIMADO;
 *   3. ingreso observado sin atribución suficiente → NO_CONCLUYENTE;
 *   4. división por cero → sin infinito ni falso éxito;
 *   5. campaña simulada nunca produce ROI REAL;
 *   6. sólo datos observados y atribución suficiente permiten ROI REAL.
 */
import { describe, it, expect } from 'vitest';
import {
  evaluarResultadoCampania,
  dividirSeguro,
  esProcedenciaReal,
  peorProcedencia,
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

describe('@soec/medicion · clasificación honesta del ROI', () => {
  it('6. sólo datos observados y atribución suficiente permiten ROI REAL', () => {
    const r = evaluarResultadoCampania(entrada());
    expect(r.clasificacion).toBe('REAL');
    expect(r.concluyente).toBe(true);
    expect(r.roiReal).toBeCloseTo(2); // (300000-100000)/100000
    expect(r.ingresosObservados).toBe(true);
  });

  it('1. gasto simulado + ingreso simulado → ROI SIMULADO', () => {
    const r = evaluarResultadoCampania(entrada({ gasto: { valor: 100000, procedencia: 'SIMULADA' }, ingresos: { valor: 300000, procedencia: 'SIMULADA' } }));
    expect(r.clasificacion).toBe('SIMULADO');
    expect(r.roiReal).toBeNull();
    expect(r.concluyente).toBe(false);
    expect(r.roiEstimado).not.toBeNull(); // ilustrativo, jamás real
  });

  it('5. campaña simulada (sólo el gasto simulado ya basta) nunca produce ROI REAL', () => {
    const r = evaluarResultadoCampania(entrada({ gasto: { valor: 100000, procedencia: 'SIMULADA' } }));
    expect(r.clasificacion).toBe('SIMULADO');
    expect(r.roiReal).toBeNull();
    // Y a la inversa: sólo los ingresos simulados también degradan a SIMULADO.
    const r2 = evaluarResultadoCampania(entrada({ ingresos: { valor: 300000, procedencia: 'SIMULADA' } }));
    expect(r2.clasificacion).toBe('SIMULADO');
    expect(r2.roiReal).toBeNull();
  });

  it('2. gasto observado + ingreso estimado → ROI ESTIMADO (no observado)', () => {
    const r = evaluarResultadoCampania(entrada({ ingresos: { valor: 300000, procedencia: 'ESTIMADA' } }));
    expect(r.clasificacion).toBe('ESTIMADO');
    expect(r.ingresosObservados).toBe(false);
    expect(r.roiReal).toBeNull();
    expect(r.concluyente).toBe(false);
  });

  it('la simulación domina sobre la estimación (peor procedencia)', () => {
    expect(peorProcedencia('OBSERVADA', 'SIMULADA')).toBe('SIMULADA');
    expect(peorProcedencia('ESTIMADA', 'SIMULADA')).toBe('SIMULADA');
    expect(peorProcedencia('OBSERVADA', 'ESTIMADA')).toBe('ESTIMADA');
    expect(peorProcedencia('OBSERVADA', 'IMPORTADA')).toBe('OBSERVADA');
    // gasto estimado + ingreso simulado ⇒ SIMULADO
    const r = evaluarResultadoCampania(entrada({ gasto: { valor: 100000, procedencia: 'ESTIMADA' }, ingresos: { valor: 300000, procedencia: 'SIMULADA' } }));
    expect(r.clasificacion).toBe('SIMULADO');
  });

  it('3. ingreso observado sin atribución suficiente → NO_CONCLUYENTE', () => {
    // Conversiones sin identificador de campaña ⇒ no atribuidas.
    const r = evaluarResultadoCampania(entrada({ conversiones: [conv(null, 300000, 'v1')] }));
    expect(r.clasificacion).toBe('NO_CONCLUYENTE');
    expect(r.atribucion.clase).not.toBe('atribucion');
    expect(r.roiReal).toBeNull();
    expect(r.concluyente).toBe(false);
    expect(r.motivo).toContain('atribución');
  });

  it('4. división por cero (gasto 0) → NO_CONCLUYENTE, sin infinito ni falso éxito', () => {
    const r = evaluarResultadoCampania(entrada({ gasto: { valor: 0, procedencia: 'OBSERVADA' }, ingresos: { valor: 300000, procedencia: 'OBSERVADA' }, conversiones: [conv(CAMP, 300000, 'v1')] }));
    expect(r.clasificacion).toBe('NO_CONCLUYENTE');
    expect(r.roiReal).toBeNull();
    expect(r.roiEstimado).toBeNull(); // NO se inventa un infinito ni un número
    expect(Number.isFinite(r.roiReal as number)).toBe(false);
    expect(r.concluyente).toBe(false);
    expect(dividirSeguro(10, 0)).toBeNull();
    expect(dividirSeguro(10, 5)).toBe(2);
  });

  it('período incompleto → NO_CONCLUYENTE, ROI provisional no real', () => {
    const r = evaluarResultadoCampania(entrada({ periodoCompleto: false }));
    expect(r.clasificacion).toBe('NO_CONCLUYENTE');
    expect(r.concluyente).toBe(false);
    expect(r.roiReal).toBeNull();
    expect(r.roiEstimado).toBeCloseTo(2); // ilustrativo
    expect(r.motivo).toContain('incompleto');
  });

  it('ausencia total de datos → NO_EVALUABLE (la falta de datos no es un resultado)', () => {
    const r = evaluarResultadoCampania({ organizacionId: ORG, campaignRef: CAMP, ventana, gasto: { valor: 0, procedencia: 'OBSERVADA' }, ingresos: { valor: 0, procedencia: 'OBSERVADA' }, conversiones: [], periodoCompleto: true });
    expect(r.clasificacion).toBe('NO_EVALUABLE');
    expect(r.roiReal).toBeNull();
    expect(r.roiEstimado).toBeNull();
  });

  it('métricas de otra organización no pueden incorporarse', () => {
    expect(() => evaluarResultadoCampania(entrada({ organizacionPorConversion: ['otra-org'] }))).toThrow(MetricaCruzadaError);
  });

  it('esProcedenciaReal distingue reales de estimadas/simuladas', () => {
    expect(esProcedenciaReal('OBSERVADA')).toBe(true);
    expect(esProcedenciaReal('IMPORTADA')).toBe(true);
    expect(esProcedenciaReal('CALCULADA')).toBe(true);
    expect(esProcedenciaReal('ESTIMADA')).toBe(false);
    expect(esProcedenciaReal('SIMULADA')).toBe(false);
  });
});
