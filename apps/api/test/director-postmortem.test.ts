/**
 * Motor del Director V1 — cierre: separa KEYWORD ≠ SEARCH TERM ≠ gasto NO DIVULGADO, con etiquetas epistémicas.
 * Caso obligatorio §15 (experimento real 24194332264, ventana post-change): el diagnóstico DEBE salir del motor.
 * Números reales: post-change spend 3.001, clicks 4; keyword "software de administración dental" 2.414 (80,4%);
 * término visible "dentidesk inicio de sesión" 714 (23,8%); no divulgado 2.287 (76,2%). Confianza LOW.
 */
import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import {
  analizarExperimento, analizarCalidadTrafico, analizarConcentracionKeywords, contabilidadPrivacidad,
  evaluarMuestra, esAccionReductoraDeRiesgo, intentComercial, type EvidenciaExperimento,
} from '../src/autonomia-ads/director-postmortem';
import { clasificarTermino } from '../src/campana/intent-classifier';
import { ExperimentMemoryService } from '../src/autonomia-ads/experiment-memory';

const ev15 = (over: Partial<EvidenciaExperimento> = {}): EvidenciaExperimento => ({
  campaignId: '24194332264', status: 'PAUSED', periodoTerminado: false,
  spend: 3001, experimentBudgetClp: 15000, impressions: 160, clicks: 4, contacts: 0, conversions: 0,
  avgCpcClp: 750, ctr: 2.5,
  keywords: [{ keyword: 'software de administración dental', matchType: 'BROAD', impresiones: 100, clics: 2, gasto: 2414, conversions: 0 }],
  terminos: [{ termino: 'dentidesk inicio de sesión', impresiones: 60, clics: 1, gasto: 714 }],
  devices: [{ clave: 'MOBILE', impresiones: 120, clics: 3, gasto: 2200, conversions: 0 }],
  geos: [{ clave: 'geo:2152', impresiones: 160, clics: 4, gasto: 3001, conversions: 0 }],
  networks: [{ clave: 'SEARCH', impresiones: 160, clics: 4, gasto: 3001, conversions: 0 }],
  trackingValid: true, landingValid: true, zeroContactStopClp: 7500,
  stopTriggered: true, stopRule: 'STOP_ZERO_CONVERSION',
  cpcInicialClp: 4759, cpcPosteriorClp: 750,
  phases: [
    { label: 'PHASE_1', startAt: '2026-08-28', endAt: '2026-09-02', biddingStrategy: 'PREVIOUS', maxCpc: null, spend: 4759, impressions: 112, clicks: 1, avgCpcClp: 4759 },
    { label: 'PHASE_2', startAt: '2026-09-03', endAt: '2026-09-06', biddingStrategy: 'TARGET_SPEND', maxCpc: 900, spend: 3001, impressions: 48, clicks: 4, avgCpcClp: 750 },
  ],
  phaseSegmentation: 'SEGMENTED', analyzedPhaseLabel: 'PHASE_2',
  ...over,
});

describe('§15 — el motor reproduce el diagnóstico real separando keyword/term/privacidad', () => {
  it('keyword ~80%, término visible navegacional ~24% (NUNCA 80%), no divulgado ~76%, muestra LOW, no reanudar, Exp.2 con aprobación', () => {
    const { postMortem: pm, recomendacion: rec, decisionPack } = analizarExperimento(ev15());
    // C: keyword concentration en la KEYWORD (no en el término)
    expect(pm.keywordConcentration).toHaveLength(1);
    expect(pm.keywordConcentration[0]!.keyword).toBe('software de administración dental');
    expect(pm.keywordConcentration[0]!.sharePct).toBeCloseTo(80.4, 0);
    // C: el término visible es navegacional/irrelevante y su share es ~24%, JAMÁS 80%
    const term = pm.searchTermFindings.find((t) => t.termino.includes('dentidesk'))!;
    expect(['NAVIGATIONAL', 'IRRELEVANT']).toContain(term.intent);
    expect(term.shareCampaignPct).toBeCloseTo(23.8, 0);
    expect(term.shareCampaignPct).not.toBeCloseTo(80, 0);
    // privacidad: ~76% no divulgado
    expect(pm.searchTermPrivacy.unreportedPct).toBeCloseTo(76.2, 0);
    expect(pm.searchTermPrivacy.epistemic).toBe('INFERRED');
    // muestra + control de puja + reinicio + acción
    expect(pm.sample.confidence).toBe('LOW');
    expect(pm.causalConfidence).toBe('LOW');
    expect(pm.biddingControlWorked).toBe(true);
    expect(pm.restartRecommended).toBe(false);
    expect(rec.action).toBe('PREPARE_EXPERIMENT_2');
    expect(rec.humanApprovalRequired).toBe(true);
    expect(decisionPack).not.toBeNull();
    // la recomendación NO atribuye el gasto oculto al término visible
    expect(rec.why).not.toMatch(/dentidesk[^.]*80/i);
    // fases: 2 fases segmentadas; el análisis usa la fase POST-cambio
    expect(pm.phaseSegmentation).toBe('SEGMENTED');
    expect(pm.phases).toHaveLength(2);
    expect(pm.analyzedPhaseLabel).toBe('PHASE_2');
    expect(pm.phases[1]!.spend).toBe(3001);
  });
});

describe('3/4/5/6/7 — keyword ≠ search term ≠ no divulgado', () => {
  it('3+4: concentración por KEYWORD 2414/3001 ≈ 80,4%', () => {
    const f = analizarConcentracionKeywords(ev15().keywords, 3001, 0);
    expect(f).toHaveLength(1);
    expect(f[0]!.sharePct).toBeCloseTo(80.4, 0);
    expect(f[0]!.epistemic).toBe('OBSERVED');
  });
  it('5: término 714/3001 ≈ 23,8%, nunca 80%', () => {
    const cal = analizarCalidadTrafico(ev15().terminos, 3001);
    expect(cal.findings[0]!.shareCampaignPct).toBeCloseTo(23.8, 0);
    expect(cal.findings[0]!.shareCampaignPct).not.toBeCloseTo(80, 0);
  });
  it('6: gasto no divulgado 2287/3001 ≈ 76,2%', () => {
    const p = contabilidadPrivacidad(ev15().terminos, 3001);
    expect(p.reportedSpend).toBe(714);
    expect(p.unreportedSpend).toBe(2287);
    expect(p.unreportedPct).toBeCloseTo(76.2, 0);
  });
  it('7: el gasto oculto queda UNKNOWN, no se atribuye a ningún término visible', () => {
    const p = contabilidadPrivacidad(ev15().terminos, 3001);
    // suma de términos visibles < gasto de campaña ⇒ el resto es no divulgado (no hay finding que lo cubra)
    const sumaVisible = ev15().terminos.reduce((a, t) => a + (t.gasto ?? 0), 0);
    expect(sumaVisible).toBeLessThan(3001);
    expect(p.unreportedSpend).toBe(3001 - sumaVisible);
  });
});

describe('8 — 4 clics + mayoría no divulgada ⇒ confianza LOW', () => {
  it('degrada a LOW por muestra chica y por >50% no divulgado', () => {
    const { postMortem: pm } = analizarExperimento(ev15({ clicks: 4 }));
    expect(pm.causalConfidence).toBe('LOW');
  });
});

describe('A/B/K — stop→postmortem; muestra chica sin veredicto; ausencia⇒UNKNOWN', () => {
  it('A: stop dispara post-mortem + evento STOP_TRIGGERED', () => {
    const a = analizarExperimento(ev15());
    expect(a.postMortem.stopReason).toBe('STOP_ZERO_CONVERSION');
    expect(a.eventos.some((e) => e.evento === 'STOP_TRIGGERED')).toBe(true);
  });
  it('B: 0 contactos + muestra chica NO concluye "no convierte"', () => {
    const { recomendacion: rec } = analizarExperimento(ev15());
    expect(rec.why.toLowerCase()).toContain('no convierte');
    expect(rec.why.toLowerCase()).toContain('suficiente');
    expect(rec.action).not.toBe('STOP_MARKETING_CHANNEL');
  });
  it('K: sin datos ⇒ UNKNOWN sin inventar', () => {
    const { postMortem: pm, recomendacion: rec } = analizarExperimento(ev15({
      spend: null, clicks: null, impressions: null, contacts: null, keywords: [], terminos: [], devices: [], geos: [], networks: [], stopTriggered: false, stopRule: null,
    }));
    expect(pm.trafficQuality).toBe('UNKNOWN');
    expect(pm.keywordConcentration).toHaveLength(0);
    expect(pm.searchTermPrivacy.epistemic).toBe('UNKNOWN');
    expect(rec.action).toBe('COLLECT_MORE_DATA');
    expect(rec.humanApprovalRequired).toBe(false);
  });
  it('D: "dentidesk inicio de sesión" y "dentalink login" ⇒ navegacional/irrelevante', () => {
    for (const q of ['dentidesk inicio de sesión', 'dentalink login']) {
      const { category, confidence } = clasificarTermino(q);
      expect(['NAVIGATIONAL', 'IRRELEVANT']).toContain(intentComercial(category, confidence));
    }
  });
});

describe('12/13 — recomendación usa evidencia real; decision pack requiere aprobación', () => {
  it('12: la evidencia cita keyword, término y privacidad por separado (OBSERVED/INFERRED)', () => {
    const { recomendacion: rec } = analizarExperimento(ev15());
    const blob = rec.evidence.join(' ');
    expect(blob).toMatch(/keyword/i);
    expect(blob).toMatch(/search term visible/i);
    expect(blob).toMatch(/no divulgados/i);
    expect(blob).toMatch(/INFERRED/);
  });
  it('13: PREPARE_EXPERIMENT_2 no es reductora de riesgo ⇒ requiere aprobación humana', () => {
    expect(esAccionReductoraDeRiesgo('PREPARE_EXPERIMENT_2')).toBe(false);
    expect(esAccionReductoraDeRiesgo('PAUSE')).toBe(true);
  });
});

describe('I/J — memoria de experimentos', () => {
  it('I: idempotente por experimentId', async () => {
    const svc = new ExperimentMemoryService(new InMemoryEventStore());
    const l = { experimentId: 'e1', campaignId: 'c1', at: 't', hypothesis: null, configuration: {}, results: {}, stopReason: 'STOP_ZERO_CONVERSION', postmortemSummary: 's', learning: 'x', nextRecommendation: 'PREPARE_EXPERIMENT_2' as const, avoidAction: null };
    expect((await svc.registrar('o', l)).registrado).toBe(true);
    expect((await svc.registrar('o', l)).registrado).toBe(false);
    expect(await svc.listar('o')).toHaveLength(1);
  });
  it('J: la recomendación incorpora aprendizajes previos', async () => {
    const svc = new ExperimentMemoryService(new InMemoryEventStore());
    await svc.registrar('o', { experimentId: 'e0', campaignId: 'c0', at: 't', hypothesis: null, configuration: {}, results: {}, stopReason: null, postmortemSummary: 's', learning: 'Maximize Conversions sin señal dispara CPC.', nextRecommendation: 'PREPARE_EXPERIMENT_2', avoidAction: 'CHANGE_BIDDING' });
    const aprendizajes = await svc.aprendizajesPrevios('o', 'otro');
    const { recomendacion: rec } = analizarExperimento(ev15(), aprendizajes);
    expect(rec.usedLearnings.length).toBeGreaterThan(0);
  });
});
