/**
 * MOTOR DE ESTRATEGIA DEL DIRECTOR (puro). Caso de aceptación REAL de SmileFlow + invariantes:
 * evidencia → diagnóstico → hipótesis → estrategia → decisiones humanas, sin ejecutar nada.
 */
import { describe, expect, it } from 'vitest';
import { evaluarEstrategiaDirector } from '../src/autonomia-ads/estrategia-director';
import { AUTONOMOUS_REAL } from '@soec/cia';

// Snapshot REAL de SmileFlow bajo prueba.
const SMILEFLOW = {
  impresiones: 1361,
  clics: 50,
  gasto: 30137,
  contactosReales: 0,
  capAutorizado: null,
  campaignStatus: 'PAUSED',
  moneda: 'CLP',
} as const;

describe('estrategia-director · caso de aceptación SmileFlow (1361 impr / 50 clics / 30137 CLP / 0 contactos)', () => {
  const r = evaluarEstrategiaDirector({ ...SMILEFLOW });

  it('FUNNEL_ZERO_CONVERSION = YES', () => {
    expect(r.funnelZeroConversion).toBe(true);
    expect(r.decisiones.some((d) => d.tipo === 'FUNNEL_ZERO_CONVERSION')).toBe(true);
  });

  it('DIAGNOSIS_REQUIRED = YES', () => {
    const d = r.decisiones.find((x) => x.tipo === 'FUNNEL_ZERO_CONVERSION')!;
    expect(d.decisionRequerida).toBe(true);
    expect(d.prioridad).toBe('HIGH');
  });

  it('CONTINUE_SPENDING_RECOMMENDATION = NO', () => {
    expect(r.continuarGastoRecomendado).toBe(false);
  });

  it('REQUEST_AUTHORIZED_BUDGET = YES', () => {
    expect(r.decisiones.some((d) => d.tipo === 'REQUEST_AUTHORIZED_BUDGET')).toBe(true);
  });

  it('RELAUNCH_EXPERIMENT = PROPOSED / PENDING_DIAGNOSIS', () => {
    expect(r.siguienteExperimento?.estado).toBe('PROPOSED');
    expect(r.siguienteExperimento?.cambioAProbar).toBe('PENDING_DIAGNOSIS');
  });

  it('DECISIONS_COUNT >= 2', () => {
    expect(r.decisiones.length).toBeGreaterThanOrEqual(2);
  });

  it('INSUFFICIENT_DATA_DOES_NOT_SUPPRESS_STRATEGY = PASS', () => {
    expect(r.insufficientDataSuppressed).toBe(true);
    expect(r.generada).toBe(true);
    expect(r.estrategia.length).toBeGreaterThan(0);
  });

  it('clicks_with_zero_contacts_triggers_diagnosis', () => {
    expect(r.diagnostico).toContain('no existe evidencia de conversión');
  });

  it('zero_contact_diagnosis_separates_fact_from_hypothesis', () => {
    const d = r.decisiones.find((x) => x.tipo === 'FUNNEL_ZERO_CONVERSION')!;
    // HECHO: afirma clics/contactos observados.
    expect(d.diagnostico).toBe('La campaña generó clics pero no contactos reales.');
    expect(d.hechos.join(' ')).toContain('50 clics');
    expect(d.hechos.join(' ')).toContain('0 contactos');
    // HIPÓTESIS: causas posibles, NUNCA afirmadas como hechos, y disjuntas de los hechos.
    expect(d.hipotesis.length).toBeGreaterThanOrEqual(6);
    expect(d.hipotesis.some((h) => /landing|CTA|tracking|oferta|fricción/i.test(h))).toBe(true);
    for (const h of d.hipotesis) expect(d.hechos).not.toContain(h);
  });

  it('zero_contacts_blocks_spend_escalation_recommendation', () => {
    expect(r.continuarGastoRecomendado).toBe(false);
    expect(r.estrategia.some((s) => /pausada/i.test(s))).toBe(true);
  });

  it('spend_without_human_cap_requests_budget_authorization', () => {
    const b = r.decisiones.find((x) => x.tipo === 'REQUEST_AUTHORIZED_BUDGET')!;
    expect(b.decisionRequerida).toBe(true);
    expect(b.recomendacion).toMatch(/presupuesto TOTAL/i);
  });

  it('historical_cap_is_not_invented', () => {
    const b = r.decisiones.find((x) => x.tipo === 'REQUEST_AUTHORIZED_BUDGET')!;
    // No fabrica un tope; lo pide. No aparece "30137" como si fuese un cap autorizado.
    expect(b.hechos.join(' ')).toMatch(/NONE|no se inventa/i);
    expect(JSON.stringify(r)).not.toContain('"capAutorizado":30137');
  });

  it('relaunch_experiment_requires_human_budget', () => {
    expect(r.siguienteExperimento?.requiereCapAutorizado).toBe(true);
    const exp = r.decisiones.find((x) => x.tipo === 'PREPARE_RELAUNCH_EXPERIMENT')!;
    expect(exp.decisionRequerida).toBe(false); // requiere diagnóstico + presupuesto antes de aprobar
  });

  it('no ejecuta marketing: ninguna decisión es una mutación de Google Ads', () => {
    // Las decisiones son PLANES HUMANOS (auditar/definir/aprobar), no palancas de Ads (negativa/budget/pausa API).
    const texto = JSON.stringify(r.decisiones);
    expect(texto).not.toMatch(/agregar_negativa|campaign_criterion|mutate|amount_micros/i);
  });

  it('autonomous_real_remains_false (invariante de seguridad)', () => {
    expect(AUTONOMOUS_REAL).toBe(false);
  });
});

describe('estrategia-director · controles negativos (no dispara sin evidencia)', () => {
  it('con contactos reales > 0 ⇒ NO es funnel-zero-conversion', () => {
    const r = evaluarEstrategiaDirector({ ...SMILEFLOW, contactosReales: 3 });
    expect(r.funnelZeroConversion).toBe(false);
    expect(r.decisiones.some((d) => d.tipo === 'FUNNEL_ZERO_CONVERSION')).toBe(false);
    expect(r.continuarGastoRecomendado).toBe(true);
  });

  it('sin gasto ⇒ ninguna estrategia (evidencia insuficiente honesta)', () => {
    const r = evaluarEstrategiaDirector({ impresiones: 0, clics: 0, gasto: 0, contactosReales: 0, capAutorizado: null, campaignStatus: 'PAUSED' });
    expect(r.funnelZeroConversion).toBe(false);
    expect(r.generada).toBe(false);
    expect(r.decisiones).toHaveLength(0);
  });

  it('con cap autorizado registrado ⇒ NO pide presupuesto (no duplica)', () => {
    const r = evaluarEstrategiaDirector({ ...SMILEFLOW, capAutorizado: 50000 });
    expect(r.decisiones.some((d) => d.tipo === 'REQUEST_AUTHORIZED_BUDGET')).toBe(false);
    // pero la señal de cero conversión sigue vigente
    expect(r.funnelZeroConversion).toBe(true);
  });
});
