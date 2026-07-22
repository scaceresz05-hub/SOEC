import { describe, expect, it } from 'vitest';
import {
  atribuir,
  calcularIndicador,
  detectarAnomalias,
  deduplicar,
  evaluar,
  evaluarCalidad,
  evaluarExperimento,
  generarDecision,
  normalizar,
  type CriterioObjetivo,
  type Observacion,
  type PoliticaOptimizacion,
} from '../src';

function obs(over: Partial<Observacion>): Observacion {
  return { fuenteId: 'f', canal: 'blog', cuenta: 'c', externalRef: 'ext-1', metricaProveedor: 'clics', valor: 10, unidad: 'conteo', moneda: null, periodo: '2026-07-21', dimension: 'total', ocurridoEn: 'x', recibidoEn: 'y', proveedorSeq: 1, acumulativa: true, estimada: false, ...over };
}
const criterio: CriterioObjetivo = { objetivoId: 'o', indicador: 'tasa_conversion', lineaBase: 0.02, meta: 0.05, tolerancia: 0.2, muestraMinima: 500 };
const policy: PoliticaOptimizacion = { muestraMinima: 500, umbralPausaTasaConversion: 0.01, umbralEscalamiento: 0.05, variacionMaxPresupuesto: 0.2, cooldownDias: 1, campaniasProtegidas: [], actividadesNoModificables: [], escalamientoRequiereAprobacion: true };

describe('Dominio de medición', () => {
  it('deduplica conservando la corrección (mayor secuencia) y descartando el duplicado exacto', () => {
    const r = deduplicar([obs({ valor: 10, proveedorSeq: 1 }), obs({ valor: 10, proveedorSeq: 1 }), obs({ valor: 13, proveedorSeq: 2 })]);
    expect(r.conservadas.length).toBe(1);
    expect(r.conservadas[0]!.valor).toBe(13);
    expect(r.duplicadosDescartados).toBe(1);
    expect(r.correcciones).toBe(1);
  });

  it('normaliza al vocabulario canónico y conserva el dato original; ignora métricas desconocidas', () => {
    expect(normalizar(obs({ metricaProveedor: 'clicks' }))?.metrica).toBe('clics');
    expect(normalizar(obs({ metricaProveedor: 'gasto', unidad: 'monetario', moneda: 'CLP' }))?.unidad).toBe('monetario');
    expect(normalizar(obs({ metricaProveedor: 'metrica_rara' }))).toBeNull();
  });

  it('calcula indicadores deterministas y representa lo no calculable (división por cero)', () => {
    expect(calcularIndicador('tasa_conversion', { conversiones: 8, clics: 100 }).valor).toBeCloseTo(0.08);
    expect(calcularIndicador('ctr', { clics: 5, impresiones: 0 }).valor).toBeNull();
  });

  it('la ausencia de datos no es fracaso; distingue insuficiente de bajo umbral', () => {
    const cal0 = evaluarCalidad({ observaciones: 0, muestra: 0, duplicados: 0, inconsistencias: 0, estimadas: 0, cobertura: 0 }, 500);
    expect(cal0.nivel).toBe('no_disponible');
    const evSin = evaluar(criterio, null, 'no_disponible', false, false, ['impresiones']);
    expect(evSin.clasificacion).toBe('sin_datos');
    const evIns = evaluar(criterio, 0.03, 'insuficiente', false, false, []);
    expect(evIns.clasificacion).toBe('evidencia_insuficiente');
    const evBajo = evaluar(criterio, 0.005, 'alta', true, false, []);
    expect(evBajo.clasificacion).toBe('bajo_umbral');
    const evSobre = evaluar(criterio, 0.08, 'alta', true, false, []);
    expect(evSobre.clasificacion).toBe('sobre_objetivo');
  });

  it('atribuye con cautela: directa por identificador; sin identificador es inferencia, no conversión confirmada', () => {
    const directa = atribuir('camp-1', [{ id: 'c1', externalRef: 'ext-1', campaignRef: 'camp-1', valor: 1, ocurridoEn: 'x' }], 'v');
    expect(directa.clase).toBe('atribucion');
    expect(directa.conversiones).toBe(1);
    const incierta = atribuir('camp-1', [{ id: 'c2', externalRef: 'ext-1', campaignRef: null, valor: 1, ocurridoEn: 'x' }], 'v');
    expect(incierta.clase).toBe('inferencia');
    expect(incierta.conversiones).toBe(0);
  });

  it('detecta anomalía de gasto superior al autorizado', () => {
    const an = detectarAnomalias({ gasto: 9000, conversiones: 8, impresiones: 1000, clics: 100 }, 300);
    expect(an.some((a) => a.codigo === 'gasto_superior_autorizado')).toBe(true);
  });

  it('el motor de optimización propone esperar / pausar / escalar según la evidencia', () => {
    const ctx = { campaniaId: 'cmp', actividadId: 'act', canal: 'blog', tasaConversion: 0.005 };
    const dInsuf = generarDecision(evaluar(criterio, 0.03, 'insuficiente', false, false, []), atribuir('c', [], 'v'), [], policy, ctx);
    expect(dInsuf.tipo).toBe('esperar_datos');
    const dPausa = generarDecision(evaluar(criterio, 0.005, 'alta', true, false, []), atribuir('c', [], 'v'), [], policy, ctx);
    expect(dPausa.tipo).toBe('pausar_actividad');
    const dEscala = generarDecision(evaluar(criterio, 0.08, 'alta', true, false, []), atribuir('c', [], 'v'), [], policy, { ...ctx, tasaConversion: 0.08 });
    expect(dEscala.tipo).toBe('aumentar_frecuencia');
  });

  it('el experimento no declara ganador sin cumplir el mínimo de observaciones', () => {
    const exp = { experimentoId: 'e', hipotesis: 'h', metricaPrincipal: 'tasa_conversion', control: { actividadId: 'a', publicationId: 'pa' }, variante: { actividadId: 'b', publicationId: 'pb' }, minimoObservaciones: 500, margenMinimo: 0.2 };
    expect(evaluarExperimento(exp, 0.02, 100, 0.05, 100).estado).toBe('inconcluso');
    expect(evaluarExperimento(exp, 0.02, 1000, 0.05, 1000).ganador).toBe('variante');
  });
});
