/**
 * Motor del Director Autónomo V1: post-mortem + calidad de tráfico + concentración + conciencia de muestra +
 * diagnóstico causal + recomendación + decision pack, más la memoria de experimentos. Caso obligatorio §15:
 * el experimento REAL finalizado (campaign 24194332264) — el diagnóstico DEBE salir del motor, no hardcodeado.
 */
import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import {
  analizarExperimento, analizarCalidadTrafico, analizarConcentracion, evaluarMuestra, esAccionReductoraDeRiesgo,
  intentComercial, type EvidenciaExperimento,
} from '../src/autonomia-ads/director-postmortem';
import { clasificarTermino } from '../src/campana/intent-classifier';
import { ExperimentMemoryService } from '../src/autonomia-ads/experiment-memory';

// Evidencia del experimento REAL finalizado (§15). Modelada a nivel de TÉRMINO DE BÚSQUEDA (el único con gasto
// disponible; keyword-level no lo entrega Google): el término navegacional concentró el gasto y no convirtió.
const ev15 = (over: Partial<EvidenciaExperimento> = {}): EvidenciaExperimento => ({
  campaignId: '24194332264', status: 'PAUSED', periodoTerminado: false,
  spend: 7760, experimentBudgetClp: 15000, impressions: 520, clicks: 5, contacts: 0, conversions: 0,
  avgCpcClp: 750, ctr: 0.96,
  terminos: [
    { termino: 'dentidesk inicio de sesión', impresiones: 300, clics: 3, gasto: 6200 },   // navegacional, ~80%
    { termino: 'software de administración dental para clínica', impresiones: 120, clics: 1, gasto: 900 }, // comercial
    { termino: 'descargar app dental', impresiones: 100, clics: 1, gasto: 660 },           // ambiguo
  ],
  trackingValid: true, landingValid: true, zeroContactStopClp: 7500,
  stopTriggered: true, stopRule: 'STOP_ZERO_CONVERSION',
  cpcInicialClp: 4759, cpcPosteriorClp: 750,
  ...over,
});

describe('§15 — el motor reproduce el diagnóstico del experimento real (sin hardcodear)', () => {
  it('produce TRAFFIC_QUALITY pobre/mixta, muestra baja, control de puja OK, no reanudar, preparar Exp.2, aprobación humana', () => {
    const { postMortem: pm, recomendacion: rec, decisionPack } = analizarExperimento(ev15());
    expect(['POOR', 'MIXED']).toContain(pm.trafficQuality);              // TRAFFIC_QUALITY = POOR/MIXED
    expect(pm.sample.confidence).toBe('LOW');                            // SAMPLE_CONFIDENCE = LOW
    expect(pm.sample.suficienteParaConcluirNoConvierte).toBe(false);
    expect(pm.biddingControlWorked).toBe(true);                          // BIDDING_CONTROL_WORKED = YES
    expect(pm.restartRecommended).toBe(false);                           // CURRENT_CAMPAIGN_RESTART = NOT_RECOMMENDED
    expect(rec.action).toBe('PREPARE_EXPERIMENT_2');                     // NEXT_ACTION = PREPARE_EXPERIMENT_2
    expect(rec.humanApprovalRequired).toBe(true);                        // HUMAN_APPROVAL_REQUIRED = YES
    expect(decisionPack).not.toBeNull();
    expect(pm.stopReason).toBe('STOP_ZERO_CONVERSION');
  });
});

describe('A — el stop dispara un post-mortem', () => {
  it('con stop disparado, el análisis trae post-mortem con stopReason y evento STOP_TRIGGERED', () => {
    const a = analizarExperimento(ev15());
    expect(a.postMortem.stopReason).toBe('STOP_ZERO_CONVERSION');
    expect(a.eventos.some((e) => e.evento === 'STOP_TRIGGERED' && e.outcome === 'AUTO_PAUSE')).toBe(true);
  });
});

describe('B — 0 contactos + muestra pequeña NO concluye que el producto no convierte', () => {
  it('muestra insuficiente ⇒ no verdicto de "no convierte"; se prepara mejor targeting', () => {
    const { postMortem: pm, recomendacion: rec } = analizarExperimento(ev15({ clicks: 4 }));
    expect(pm.sample.suficienteParaConcluirNoConvierte).toBe(false);
    expect(rec.why.toLowerCase()).toContain('no convierte');
    expect(rec.why.toLowerCase()).toContain('suficiente');
    expect(rec.action).not.toBe('STOP_MARKETING_CHANNEL');
  });
});

describe('C — concentración de gasto >80% sin contactos ⇒ KEYWORD_REVIEW_REQUIRED', () => {
  it('marca el término dominante, sin eliminarlo automáticamente', () => {
    const c = analizarConcentracion(ev15().terminos, 7760, 0);
    const f = c.findings.find((x) => x.termino.includes('dentidesk'));
    expect(f).toBeTruthy();
    expect(f!.flag).toBe('KEYWORD_REVIEW_REQUIRED');
    expect(f!.sharePct).toBeGreaterThanOrEqual(60);
  });
  it('reporta el % de gasto NO divulgado por privacidad cuando el total supera lo conocido', () => {
    const c = analizarConcentracion([{ termino: 'x', impresiones: 10, clics: 1, gasto: 2000 }], 10000, 0);
    expect(c.gastoNoDivulgadoPct).toBe(80);
  });
});

describe('D — "dentidesk inicio de sesión" clasifica navegacional/irrelevante', () => {
  it('no es intención comercial de nuestro ICP', () => {
    const { category, confidence } = clasificarTermino('dentidesk inicio de sesión');
    expect(['NAVIGATIONAL', 'IRRELEVANT']).toContain(intentComercial(category, confidence));
  });
  it('un login de competidor también cae fuera de lo comercial', () => {
    const { category, confidence } = clasificarTermino('dentalink login');
    expect(['NAVIGATIONAL', 'IRRELEVANT']).toContain(intentComercial(category, confidence));
  });
});

describe('E/F/G — recomendación con evidencia; inversión nueva requiere humano; reducir riesgo es autónomo', () => {
  it('E: la recomendación incluye evidencia real (no vacía)', () => {
    const { recomendacion: rec } = analizarExperimento(ev15());
    expect(rec.evidence.length).toBeGreaterThan(0);
    expect(rec.evidence.join(' ')).toMatch(/gasto|clics|control de cpc|no divulgados/i);
  });
  it('F: PREPARE_EXPERIMENT_2 (inversión nueva) requiere aprobación humana', () => {
    expect(esAccionReductoraDeRiesgo('PREPARE_EXPERIMENT_2')).toBe(false);
  });
  it('G: PAUSE/STOP (reductoras de riesgo) NO requieren aprobación', () => {
    expect(esAccionReductoraDeRiesgo('PAUSE')).toBe(true);
    expect(esAccionReductoraDeRiesgo('STOP_MARKETING_CHANNEL')).toBe(true);
  });
});

describe('K — ausencia de datos ⇒ UNKNOWN, sin inventar', () => {
  it('sin términos ni gasto: calidad UNKNOWN, sin findings, recomendación de recolectar más datos', () => {
    const { postMortem: pm, recomendacion: rec } = analizarExperimento(ev15({
      terminos: [], spend: null, clicks: null, impressions: null, contacts: null, stopTriggered: false, stopRule: null,
    }));
    expect(pm.trafficQuality).toBe('UNKNOWN');
    expect(pm.concentration.findings.length).toBe(0);
    expect(rec.action).toBe('COLLECT_MORE_DATA');
    expect(rec.humanApprovalRequired).toBe(false); // observar no compromete gasto
  });
  it('calidad de tráfico UNKNOWN cuando no hay términos', () => {
    expect(analizarCalidadTrafico([]).quality).toBe('UNKNOWN');
  });
  it('muestra no evaluable sin clics', () => {
    expect(evaluarMuestra(null, 0).confidence).toBe('LOW');
  });
});

describe('I/J — memoria de experimentos: persiste y la siguiente recomendación la consume', () => {
  it('I: registrar es idempotente por experimentId y listar devuelve el aprendizaje', async () => {
    const svc = new ExperimentMemoryService(new InMemoryEventStore());
    const learning = {
      experimentId: '24194332264:STOP_ZERO_CONVERSION', campaignId: '24194332264', at: '2026-09-06T00:00:00Z',
      hypothesis: null, configuration: { bidding: 'Maximize Clicks cap 900' }, results: { spend: 7760, clicks: 5, contacts: 0 },
      stopReason: 'STOP_ZERO_CONVERSION', postmortemSummary: 'Targeting ambiguo, muestra baja.',
      learning: 'Concordancia amplia dejó entrar tráfico navegacional; sin negativas concentró el gasto.',
      nextRecommendation: 'PREPARE_EXPERIMENT_2' as const, avoidAction: 'CHANGE_BIDDING' as const,
    };
    expect((await svc.registrar('org-smileflow', learning)).registrado).toBe(true);
    expect((await svc.registrar('org-smileflow', learning)).registrado).toBe(false); // idempotente
    expect(await svc.listar('org-smileflow')).toHaveLength(1);
  });
  it('J: la recomendación siguiente incorpora aprendizajes previos', async () => {
    const svc = new ExperimentMemoryService(new InMemoryEventStore());
    await svc.registrar('org-smileflow', {
      experimentId: 'e1', campaignId: 'c1', at: '2026-09-01T00:00:00Z', hypothesis: null, configuration: {},
      results: {}, stopReason: 'STOP_ZERO_CONVERSION', postmortemSummary: 's',
      learning: 'Maximize Conversions sin señal dispara el CPC.', nextRecommendation: 'PREPARE_EXPERIMENT_2', avoidAction: 'CHANGE_BIDDING',
    });
    const aprendizajes = await svc.aprendizajesPrevios('org-smileflow', '24194332264:STOP_ZERO_CONVERSION');
    const { recomendacion: rec } = analizarExperimento(ev15(), aprendizajes);
    expect(rec.usedLearnings.length).toBeGreaterThan(0);
    expect(rec.usedLearnings[0]).toContain('Maximize Conversions');
  });
});
