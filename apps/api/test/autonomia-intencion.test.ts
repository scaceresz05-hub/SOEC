import { describe, expect, it } from 'vitest';
import { planificarCambios, type InsumosPlan } from '../src/autonomia-ads/intencion';
import { LIMITES_SMILEFLOW } from '../src/autonomia-ads/limites-smileflow';

const base = (terminos: InsumosPlan['terminos']): InsumosPlan => ({
  org: 'org-smileflow', customerId: '24120966895', campaniaRef: 'cmp-smileflow-search-chile',
  evidenciaSuficiente: false, clasificacionDesempeno: 'evidencia_insuficiente', roiClasificacion: 'NO_CONCLUYENTE',
  decisionTipo: 'esperar_datos', terminos, limites: LIMITES_SMILEFLOW,
});

describe('planificarCambios (Decision, puro)', () => {
  it('con términos reales de poca muestra (< mínimo) ⇒ CERO intenciones (prevalece observar)', () => {
    const insumos = base([
      { termino: 'dentalink agenda', impresiones: 6, clics: 0 },
      { termino: 'dentalink ingreso', impresiones: 6, clics: 0 },
      { termino: 'comprar exocad', impresiones: 2, clics: 1 },
    ]);
    expect(planificarCambios(insumos)).toEqual([]);
  });

  it('un término con muestra suficiente + 0 clics + IRRELEVANTE ⇒ 1 intención de negativa (bajo riesgo, humana)', () => {
    const insumos = base([{ termino: 'reparacion de autos', impresiones: 40, clics: 0 }]);
    const r = planificarCambios(insumos);
    expect(r).toHaveLength(1);
    const i = r[0]!;
    expect(i.palanca).toBe('agregar_negativa');
    expect(i.entidadRef).toBe('reparacion de autos');
    expect(i.habilitacionEtapa).toBe('HABILITADA_G1_DRYRUN');
    expect(i.autorizacionRequerida).toBe('HUMANA_POR_CAMBIO');
    expect(i.riesgo).toBe('bajo');
    expect(i.confianza).toBe('alta');
    expect(i.evidencia.suficiente).toBe(true);
    // lenguaje simple presente
    expect(i.problema.length).toBeGreaterThan(0);
    expect(i.recomendacion.length).toBeGreaterThan(0);
    expect(i.impactoEsperado).toContain('No sube tu gasto');
    expect(i.rollbackPrevisto.length).toBeGreaterThan(0);
    expect(i.customerId).toBe('24120966895');
  });

  it('un término con clics NO se propone (no es claramente irrelevante)', () => {
    expect(planificarCambios(base([{ termino: 'agenda dental', impresiones: 50, clics: 3 }]))).toEqual([]);
  });
});
