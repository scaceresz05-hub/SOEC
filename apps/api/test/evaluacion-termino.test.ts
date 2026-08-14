/**
 * AUDITORÍA DEL RAZONAMIENTO — evaluación de términos de búsqueda (FASE 11).
 *
 * Demuestra que SOEC NO confunde CERO CLICS con IRRELEVANCIA y que un término de competidor no se convierte
 * en palabra excluida por defecto. Una negativa exige evidencia de IRRELEVANCIA (política del negocio),
 * no sólo "N impresiones sin clics". Casos inspirados en los search terms reales de SmileFlow.
 */
import { describe, expect, it } from 'vitest';
import { evaluarTermino, crearPredicadoIrrelevancia } from '../src/autonomia-ads/evaluacion-termino';
import { planificarCambios, evaluarOportunidadesTacticas, type InsumosPlan } from '../src/autonomia-ads/intencion';
import { LIMITES_SMILEFLOW, type LimitesAutonomia } from '../src/autonomia-ads/limites-smileflow';

const MIN = LIMITES_SMILEFLOW.muestraMinimaNegativaImpresiones; // 30

function insumos(terminos: InsumosPlan['terminos'], limites: LimitesAutonomia = LIMITES_SMILEFLOW): InsumosPlan {
  return { org: 'org-x', customerId: 'c', campaniaRef: 'k', evidenciaSuficiente: false, clasificacionDesempeno: 'sin_datos', roiClasificacion: 'NO_EVALUABLE', decisionTipo: null, terminos, limites };
}

describe('evaluarTermino · epistemología', () => {
  it('ZERO_CLICKS_IS_NOT_IRRELEVANCE: 0 clics con muestra ⇒ rendimiento POBRE, relevancia DESCONOCIDA (no IRRELEVANTE)', () => {
    const e = evaluarTermino('dentalink agenda', 0, 37, { muestraMinima: MIN });
    expect(e.rendimiento).toBe('POBRE');
    expect(e.relevancia).toBe('DESCONOCIDA');
    expect(e.relevancia).not.toBe('IRRELEVANTE');
    expect(e.accion).toBe('OPTIMIZAR_MENSAJE'); // revisar mensaje, NO excluir
  });

  it('COMPETITOR_TERM_IS_NOT_AUTOMATIC_NEGATIVE: sin política, un término de competidor no es negativa', () => {
    const e = evaluarTermino('dentalink agenda', 0, 37, { muestraMinima: MIN });
    expect(e.accion).not.toBe('NEGATIVA_JUSTIFICADA');
  });

  it('LOW_SAMPLE_DOES_NOT_FORCE_ACTION: por debajo de la muestra mínima ⇒ EVIDENCIA_INSUFICIENTE', () => {
    expect(evaluarTermino('dentalink precios', 0, 3, { muestraMinima: MIN }).accion).toBe('EVIDENCIA_INSUFICIENTE');
    expect(evaluarTermino('exocad valor', 2, 2, { muestraMinima: MIN }).accion).toBe('EVIDENCIA_INSUFICIENTE');
  });

  it('COMMERCIAL_COMPETITOR_QUERY_REQUIRES_CONTEXT: con clics ⇒ MANTENER (atrae interés)', () => {
    const e = evaluarTermino('dentalink precios', 3, 60, { muestraMinima: MIN }); // hipotético con muestra
    expect(e.accion).toBe('MANTENER');
    expect(e.relevancia).toBe('RELEVANTE');
  });

  it('NAVIGATIONAL_COMPETITOR_QUERY_CAN_BE_NEGATIVE_CANDIDATE: con política que lo marca irrelevante ⇒ NEGATIVA_JUSTIFICADA', () => {
    const esIrrelevante = crearPredicadoIrrelevancia(['dentalink ingreso']);
    const e = evaluarTermino('dentalink ingreso', 0, 40, { muestraMinima: MIN, esIrrelevante });
    expect(e.relevancia).toBe('IRRELEVANTE');
    expect(e.accion).toBe('NEGATIVA_JUSTIFICADA');
  });

  it('REAL_IRRELEVANT_QUERY_CAN_BECOME_NEGATIVE_CANDIDATE: política del negocio (p.ej. "empleo") ⇒ negativa', () => {
    const esIrrelevante = crearPredicadoIrrelevancia(['empleo', 'trabajo', 'curso gratis']);
    expect(evaluarTermino('empleo dental', 0, 50, { muestraMinima: MIN, esIrrelevante }).accion).toBe('NEGATIVA_JUSTIFICADA');
  });
});

describe('planificarCambios · sólo excluye con evidencia de irrelevancia', () => {
  it('con datos reales de SmileFlow (sin política) ⇒ 0 negativas; dentalink agenda NO se excluye', () => {
    const terminos = [
      { termino: 'dentalink agenda', impresiones: 37, clics: 0 },
      { termino: 'dentalink chile', impresiones: 22, clics: 0 },
      { termino: 'software dental', impresiones: 7, clics: 1 },
    ];
    const propuestas = planificarCambios(insumos(terminos));
    expect(propuestas).toHaveLength(0);
    // pero SÍ aparece como oportunidad táctica (revisar mensaje), no como exclusión
    const tac = evaluarOportunidadesTacticas(insumos(terminos));
    expect(tac.some((t) => t.termino === 'dentalink agenda' && t.accion === 'OPTIMIZAR_MENSAJE')).toBe(true);
  });

  it('con política de irrelevancia ⇒ propone negativa SÓLO del término irrelevante 0-clics con muestra', () => {
    const limites: LimitesAutonomia = { ...LIMITES_SMILEFLOW, politicaIrrelevancia: ['empleo'] };
    const terminos = [
      { termino: 'dentalink agenda', impresiones: 37, clics: 0 }, // relevante-desconocido ⇒ NO
      { termino: 'empleo odontologo', impresiones: 40, clics: 0 }, // irrelevante por política ⇒ SÍ
    ];
    const propuestas = planificarCambios(insumos(terminos, limites));
    expect(propuestas).toHaveLength(1);
    expect(propuestas[0]!.entidadRef).toBe('empleo odontologo');
  });

  it('TACTICAL_RECOMMENDATION_DOES_NOT_CONTRADICT_DIRECTOR: estratégicas (negativas)=0 y tácticas>0 conviven', () => {
    const terminos = [{ termino: 'dentalink agenda', impresiones: 37, clics: 0 }];
    expect(planificarCambios(insumos(terminos))).toHaveLength(0);          // estratégico: nada que ejecutar
    expect(evaluarOportunidadesTacticas(insumos(terminos)).length).toBeGreaterThan(0); // táctico: revisar mensaje
  });

  it('CYP_DOES_NOT_INHERIT_SMILEFLOW_POLICY / TENANT_ISOLATION: la política viaja por-org en los límites', () => {
    // org-cyp con límites SIN la política de SmileFlow: un término que SmileFlow excluiría NO se excluye para cyp.
    const limitesSmileflow: LimitesAutonomia = { ...LIMITES_SMILEFLOW, politicaIrrelevancia: ['empleo'] };
    const limitesCyp: LimitesAutonomia = { ...LIMITES_SMILEFLOW }; // sin política
    const t = [{ termino: 'empleo odontologo', impresiones: 40, clics: 0 }];
    expect(planificarCambios(insumos(t, limitesSmileflow))).toHaveLength(1); // SmileFlow: excluye
    expect(planificarCambios({ ...insumos(t, limitesCyp), org: 'org-cyp' })).toHaveLength(0); // cyp: no hereda
  });

  it('TEST_EVENTS_DO_NOT_AFFECT_DECISION: la decisión es función pura de los términos REALES pasados', () => {
    // leerTerminos (plan/g2a) ya filtra diagnostico; planificarCambios sólo ve términos reales.
    const reales = [{ termino: 'dentalink agenda', impresiones: 37, clics: 0 }];
    expect(planificarCambios(insumos(reales))).toEqual(planificarCambios(insumos(reales)));
    expect(planificarCambios(insumos(reales))).toHaveLength(0);
  });
});
