/**
 * apps/api · autonomia-ads · MOTOR DEL DIRECTOR (PURO, determinista, sin I/O).
 *
 * Convierte la EVIDENCIA REAL de un experimento (métricas de campaña + términos con gasto + contactos + muestra +
 * estado de stop + tracking/landing + control de puja) en un análisis estructurado accionable:
 *   calidad de tráfico → concentración de gasto → conciencia de muestra → diagnóstico causal → post-mortem →
 *   recomendación (con evidencia/confianza/efecto/riesgo/costo/aprobación) → decision pack listo para aprobar.
 *
 * Doctrina (marco de conocimiento SSR/SOEC):
 *  - Ausencia de datos ⇒ UNKNOWN, nunca una conclusión inventada.
 *  - 0 contactos con MUESTRA PEQUEÑA NO es evidencia suficiente para declarar "el producto no convierte".
 *  - Reducir riesgo (PAUSE/STOP/NOOP) es autónomo; escalar gasto/crear/reanudar/targeting SIEMPRE requiere humano.
 *  - Toda recomendación es explicable: sale de la evidencia, no de un LLM.
 */
import { clasificarTermino, LEXICO_DENTAL_POR_DEFECTO, type IntentCategory, type IntentLexicon, type Confidence } from '../campana/intent-classifier';

// ── Vocabulario ───────────────────────────────────────────────────────────────
export type CommercialIntent =
  | 'HIGH_COMMERCIAL_INTENT' | 'MEDIUM_COMMERCIAL_INTENT' | 'LOW_COMMERCIAL_INTENT'
  | 'NAVIGATIONAL' | 'IRRELEVANT' | 'UNKNOWN';
export type TrafficQuality = 'GOOD' | 'MIXED' | 'POOR' | 'UNKNOWN';
export type SampleConfidence = 'LOW' | 'MEDIUM' | 'HIGH';
export type CausalFactor =
  | 'TRAFFIC_QUALITY' | 'INSUFFICIENT_SAMPLE' | 'HIGH_CPC' | 'LANDING' | 'TRACKING'
  | 'OFFER' | 'AD_MESSAGE' | 'KEYWORD_MATCHING' | 'BIDDING' | 'GEO' | 'DEVICE' | 'OTHER';
export type RecommendedAction =
  | 'KEEP_RUNNING' | 'PAUSE' | 'DO_NOT_RESTART' | 'PREPARE_EXPERIMENT_2' | 'CHANGE_BIDDING'
  | 'RESTRICT_MATCH_TYPES' | 'ADD_NEGATIVES' | 'CHANGE_AD' | 'CHANGE_LANDING' | 'COLLECT_MORE_DATA'
  | 'STOP_MARKETING_CHANNEL';
export type DirectorEvent =
  | 'FIRST_IMPRESSION' | 'FIRST_CLICK' | 'FIRST_CONTACT' | 'ZERO_CONTACT_SPEND_THRESHOLD'
  | 'BUDGET_THRESHOLD' | 'STOP_TRIGGERED' | 'CAMPAIGN_PAUSED' | 'CAMPAIGN_ENDED'
  | 'TRACKING_INVALID' | 'LANDING_INVALID' | 'SEARCH_TERM_IRRELEVANCE' | 'KEYWORD_SPEND_CONCENTRATION'
  | 'CONVERSION_RECEIVED' | 'PERIOD_END_APPROACHING';
export type EventOutcome = 'NO_ACTION' | 'OBSERVE_MORE' | 'RECOMMENDATION' | 'AUTO_PAUSE' | 'HUMAN_DECISION_REQUIRED';

// ── Umbrales (GENERALES, no derivados de ningún experimento objetivo) ──────────
/** Bajo este nº de clics con 0 contactos NO se puede concluir "no convierte" (muestra insuficiente). */
export const CLICS_MIN_PARA_CONCLUIR = 30;
export const CLICS_MUESTRA_MEDIA = 100;
/** Un término que concentra ≥ esta fracción del gasto conocido SIN contactos ⇒ revisar. */
export const UMBRAL_CONCENTRACION = 0.6;
/** Reducción de CPC que se considera "el control de puja funcionó". */
export const FACTOR_MEJORA_CPC = 0.75;

export interface TermSpend { readonly termino: string; readonly impresiones: number; readonly clics: number; readonly gasto: number | null }

/** Evidencia REAL de un experimento (todo lo que el motor necesita; el caller la arma desde datos reales). */
export interface EvidenciaExperimento {
  readonly campaignId: string;
  readonly status: string | null;              // ENABLED | PAUSED | null
  readonly periodoTerminado: boolean;
  readonly spend: number | null;
  readonly experimentBudgetClp: number | null;  // presupuesto/cap del experimento
  readonly impressions: number | null;
  readonly clicks: number | null;
  readonly contacts: number | null;             // contactos first-party (leads)
  readonly conversions: number | null;
  readonly avgCpcClp: number | null;
  readonly ctr: number | null;
  readonly terminos: readonly TermSpend[];
  readonly trackingValid: boolean;
  readonly landingValid: boolean;
  readonly zeroContactStopClp: number;
  readonly stopTriggered: boolean;
  readonly stopRule: string | null;             // p.ej. STOP_ZERO_CONVERSION
  readonly cpcInicialClp: number | null;        // control de puja: CPC antes…
  readonly cpcPosteriorClp: number | null;      // …y después del cambio de estrategia
  readonly lexico?: IntentLexicon;
}

// ── Calidad de tráfico ─────────────────────────────────────────────────────────
export function intentComercial(cat: IntentCategory, conf: Confidence): CommercialIntent {
  switch (cat) {
    case 'CLINIC_MANAGEMENT_INTENT': return conf === 'HIGH' ? 'HIGH_COMMERCIAL_INTENT' : 'MEDIUM_COMMERCIAL_INTENT';
    case 'COMPETITOR_BUYER_INTENT': return 'MEDIUM_COMMERCIAL_INTENT';
    case 'PATIENT_INTENT': return 'LOW_COMMERCIAL_INTENT';         // paciente ≠ clínica-cliente
    case 'COMPETITOR_NAVIGATIONAL': return 'NAVIGATIONAL';
    case 'CLINICAL_TECH_SOFTWARE': return 'IRRELEVANT';            // producto clínico de competidor, no nuestro ICP
    case 'COMPETITOR_EDUCATIONAL_OR_INSTITUTIONAL':
    case 'EDUCATIONAL': return 'IRRELEVANT';
    default: return 'UNKNOWN';                                     // COMPETITOR_UNKNOWN / UNKNOWN
  }
}
const ES_COMERCIAL = (i: CommercialIntent): boolean => i === 'HIGH_COMMERCIAL_INTENT' || i === 'MEDIUM_COMMERCIAL_INTENT';

export interface TerminoClasificado extends TermSpend { readonly intent: CommercialIntent; readonly confidence: Confidence }
export interface CalidadTrafico {
  readonly quality: TrafficQuality;
  readonly terminos: readonly TerminoClasificado[];
  readonly gastoComercialPct: number | null;    // % del gasto conocido en términos comerciales
  readonly ejemplosNoComerciales: readonly string[];
}

export function analizarCalidadTrafico(terminos: readonly TermSpend[], lex: IntentLexicon = LEXICO_DENTAL_POR_DEFECTO): CalidadTrafico {
  const clasificados: TerminoClasificado[] = terminos.map((t) => {
    const { category, confidence } = clasificarTermino(t.termino, lex);
    return { ...t, intent: intentComercial(category, confidence), confidence };
  });
  if (clasificados.length === 0) return { quality: 'UNKNOWN', terminos: [], gastoComercialPct: null, ejemplosNoComerciales: [] };
  const gastoConocido = clasificados.reduce((a, t) => a + (t.gasto ?? 0), 0);
  const gastoComercial = clasificados.filter((t) => ES_COMERCIAL(t.intent)).reduce((a, t) => a + (t.gasto ?? 0), 0);
  const pct = gastoConocido > 0 ? gastoComercial / gastoConocido : null;
  // Si no hay gasto por término, usar reparto por impresiones como respaldo.
  const imprTotal = clasificados.reduce((a, t) => a + t.impresiones, 0);
  const imprComercial = clasificados.filter((t) => ES_COMERCIAL(t.intent)).reduce((a, t) => a + t.impresiones, 0);
  const share = pct ?? (imprTotal > 0 ? imprComercial / imprTotal : null);
  const quality: TrafficQuality = share == null ? 'UNKNOWN' : share >= 0.7 ? 'GOOD' : share >= 0.35 ? 'MIXED' : 'POOR';
  const ejemplosNoComerciales = clasificados.filter((t) => !ES_COMERCIAL(t.intent) && t.intent !== 'UNKNOWN')
    .sort((a, b) => (b.gasto ?? 0) - (a.gasto ?? 0) || b.impresiones - a.impresiones).slice(0, 5).map((t) => t.termino);
  return { quality, terminos: clasificados, gastoComercialPct: pct == null ? null : Math.round(pct * 100) / 100, ejemplosNoComerciales };
}

// ── Concentración de gasto ──────────────────────────────────────────────────────
export interface FindingConcentracion { readonly termino: string; readonly sharePct: number; readonly gasto: number; readonly contactos: number; readonly flag: 'KEYWORD_REVIEW_REQUIRED'; readonly porque: string }
export interface AnalisisConcentracion { readonly findings: readonly FindingConcentracion[]; readonly gastoNoDivulgadoPct: number | null }

export function analizarConcentracion(terminos: readonly TermSpend[], gastoTotal: number | null, contactos: number | null): AnalisisConcentracion {
  const conGasto = terminos.filter((t) => t.gasto != null && t.gasto > 0) as (TermSpend & { gasto: number })[];
  const gastoConocido = conGasto.reduce((a, t) => a + t.gasto, 0);
  const base = gastoConocido > 0 ? gastoConocido : (gastoTotal ?? 0);
  const findings: FindingConcentracion[] = [];
  if (base > 0) {
    for (const t of conGasto) {
      const share = t.gasto / base;
      if (share >= UMBRAL_CONCENTRACION && (contactos ?? 0) === 0) {
        findings.push({
          termino: t.termino, sharePct: Math.round(share * 100), gasto: Math.round(t.gasto), contactos: 0,
          flag: 'KEYWORD_REVIEW_REQUIRED',
          porque: `Concentra ~${Math.round(share * 100)}% del gasto y no produjo contactos: revisar concordancia/negativas (no se elimina automáticamente).`,
        });
      }
    }
  }
  // Gasto que Google no divulga por privacidad (términos no listados): total − suma de términos conocidos.
  let noDivulgado: number | null = null;
  if (gastoTotal != null && gastoTotal > 0) noDivulgado = Math.max(0, Math.round(((gastoTotal - gastoConocido) / gastoTotal) * 100));
  return { findings, gastoNoDivulgadoPct: noDivulgado };
}

// ── Conciencia de muestra ────────────────────────────────────────────────────────
export interface AnalisisMuestra { readonly confidence: SampleConfidence; readonly suficienteParaConcluirNoConvierte: boolean; readonly porque: string }
export function evaluarMuestra(clicks: number | null, contacts: number | null): AnalisisMuestra {
  if (clicks == null) return { confidence: 'LOW', suficienteParaConcluirNoConvierte: false, porque: 'Sin datos de clics: muestra no evaluable.' };
  const confidence: SampleConfidence = clicks >= CLICS_MUESTRA_MEDIA ? 'HIGH' : clicks >= CLICS_MIN_PARA_CONCLUIR ? 'MEDIUM' : 'LOW';
  // Sólo con muestra suficiente Y 0 contactos se podría empezar a hablar de baja conversión (y aún así con matices).
  const suficiente = clicks >= CLICS_MIN_PARA_CONCLUIR;
  const porque = suficiente
    ? `${clicks} clics: muestra suficiente para leer señales de conversión.`
    : `${clicks} clics + ${contacts ?? 0} contactos: muestra insuficiente para concluir que el producto no convierte.`;
  return { confidence, suficienteParaConcluirNoConvierte: suficiente, porque };
}

// ── Control de puja (antes/después) ──────────────────────────────────────────────
export function controlPujaFunciono(cpcInicial: number | null, cpcPosterior: number | null): boolean | null {
  if (cpcInicial == null || cpcPosterior == null || cpcInicial <= 0) return null;
  return cpcPosterior <= cpcInicial * FACTOR_MEJORA_CPC;
}

// ── Diagnóstico causal ────────────────────────────────────────────────────────────
export interface FactorCausal { readonly factor: CausalFactor; readonly evidencia: string; readonly confianza: SampleConfidence }
export function diagnosticoCausal(ev: EvidenciaExperimento, calidad: CalidadTrafico, muestra: AnalisisMuestra): FactorCausal[] {
  const f: FactorCausal[] = [];
  if (!ev.trackingValid) f.push({ factor: 'TRACKING', evidencia: 'La medición no está validada: los contactos podrían no registrarse.', confianza: 'HIGH' });
  if (!ev.landingValid) f.push({ factor: 'LANDING', evidencia: 'La página de destino no está disponible/válida.', confianza: 'HIGH' });
  if (calidad.quality === 'POOR' || calidad.quality === 'MIXED') {
    const ej = calidad.ejemplosNoComerciales.length ? ` (p.ej. ${calidad.ejemplosNoComerciales.slice(0, 3).join(', ')})` : '';
    f.push({ factor: 'TRAFFIC_QUALITY', evidencia: `Parte del tráfico es de baja intención comercial${ej}.`, confianza: calidad.quality === 'POOR' ? 'HIGH' : 'MEDIUM' });
    f.push({ factor: 'KEYWORD_MATCHING', evidencia: 'La concordancia amplia deja entrar consultas ambiguas/navegacionales.', confianza: 'MEDIUM' });
  }
  if ((ev.contacts ?? 0) === 0 && !muestra.suficienteParaConcluirNoConvierte) {
    f.push({ factor: 'INSUFFICIENT_SAMPLE', evidencia: muestra.porque, confianza: 'HIGH' });
  }
  // HIGH_CPC sólo si el control de puja aún NO redujo el CPC (si funcionó, no es la causa vigente).
  if (controlPujaFunciono(ev.cpcInicialClp, ev.cpcPosteriorClp) === false) {
    f.push({ factor: 'HIGH_CPC', evidencia: 'El CPC sigue alto tras el cambio de estrategia: consume presupuesto sin volumen.', confianza: 'MEDIUM' });
  }
  if (f.length === 0) f.push({ factor: 'OTHER', evidencia: 'Sin una causa dominante identificable con la evidencia disponible.', confianza: 'LOW' });
  return f;
}

// ── Post-mortem ────────────────────────────────────────────────────────────────
export interface PostMortem {
  readonly campaignId: string;
  readonly metrics: { spend: number | null; budget: number | null; impressions: number | null; clicks: number | null; ctr: number | null; avgCpcClp: number | null; contacts: number | null; conversions: number | null; cpaClp: number | null };
  readonly biddingBefore: number | null; readonly biddingAfter: number | null; readonly biddingControlWorked: boolean | null;
  readonly trafficQuality: TrafficQuality; readonly gastoComercialPct: number | null;
  readonly concentration: AnalisisConcentracion; readonly sample: AnalisisMuestra;
  readonly diagnosis: readonly FactorCausal[];
  readonly stopReason: string | null;
  readonly restartRecommended: boolean;      // ¿reanudar la campaña TAL CUAL?
}

export function construirPostMortem(ev: EvidenciaExperimento): PostMortem {
  const calidad = analizarCalidadTrafico(ev.terminos, ev.lexico);
  const concentration = analizarConcentracion(ev.terminos, ev.spend, ev.contacts);
  const sample = evaluarMuestra(ev.clicks, ev.contacts);
  const diagnosis = diagnosticoCausal(ev, calidad, sample);
  const cpa = (ev.contacts ?? 0) > 0 && ev.spend != null ? Math.round(ev.spend / (ev.contacts as number)) : null;
  // Reanudar TAL CUAL sólo si no hay problema de calidad/tracking/landing y la muestra fue suficiente sin problemas.
  const problemaTargeting = calidad.quality === 'POOR' || calidad.quality === 'MIXED' || concentration.findings.length > 0;
  const restartRecommended = !problemaTargeting && ev.trackingValid && ev.landingValid && (ev.contacts ?? 0) > 0;
  return {
    campaignId: ev.campaignId,
    metrics: { spend: ev.spend, budget: ev.experimentBudgetClp, impressions: ev.impressions, clicks: ev.clicks, ctr: ev.ctr, avgCpcClp: ev.avgCpcClp, contacts: ev.contacts, conversions: ev.conversions, cpaClp: cpa },
    biddingBefore: ev.cpcInicialClp, biddingAfter: ev.cpcPosteriorClp, biddingControlWorked: controlPujaFunciono(ev.cpcInicialClp, ev.cpcPosteriorClp),
    trafficQuality: calidad.quality, gastoComercialPct: calidad.gastoComercialPct,
    concentration, sample, diagnosis,
    stopReason: ev.stopTriggered ? ev.stopRule : null,
    restartRecommended,
  };
}

// ── Recomendación ────────────────────────────────────────────────────────────────
export interface Recomendacion {
  readonly action: RecommendedAction;
  readonly why: string;
  readonly evidence: readonly string[];
  readonly confidence: SampleConfidence;
  readonly expectedEffect: string;
  readonly risk: string;
  readonly estimatedCostClp: number | null;
  readonly humanApprovalRequired: boolean;
  readonly usedLearnings: readonly string[];   // aprendizajes previos que informaron esta recomendación
}

/** Acciones REDUCTORAS DE RIESGO ⇒ autónomas (no requieren aprobación). El resto SIEMPRE requiere humano. */
export function esAccionReductoraDeRiesgo(a: RecommendedAction): boolean {
  return a === 'PAUSE' || a === 'DO_NOT_RESTART' || a === 'COLLECT_MORE_DATA' || a === 'STOP_MARKETING_CHANNEL';
}

export interface AprendizajePrevio { readonly enunciado: string; readonly evitarAccion?: RecommendedAction }

export function construirRecomendacion(pm: PostMortem, aprendizajes: readonly AprendizajePrevio[] = []): Recomendacion {
  const evidence: string[] = [];
  const used: string[] = [];
  const { metrics } = pm;
  const cero = (metrics.contacts ?? 0) === 0;

  // Evidencia base.
  if (metrics.spend != null) evidence.push(`Gasto ${Math.round(metrics.spend)} CLP · ${metrics.clicks ?? 0} clics · ${metrics.contacts ?? 0} contactos.`);
  if (pm.biddingControlWorked === true) evidence.push(`El control de CPC funcionó: ${Math.round(pm.biddingBefore ?? 0)} → ~${Math.round(pm.biddingAfter ?? 0)} CLP.`);
  for (const c of pm.concentration.findings) evidence.push(`"${c.termino}" ${c.sharePct}% del gasto, 0 contactos.`);
  if (pm.concentration.gastoNoDivulgadoPct != null && pm.concentration.gastoNoDivulgadoPct > 0) evidence.push(`${pm.concentration.gastoNoDivulgadoPct}% del gasto en términos no divulgados por privacidad de Google.`);
  evidence.push(pm.sample.porque);
  for (const d of pm.diagnosis) evidence.push(`${d.factor}: ${d.evidencia}`);

  // Aprendizajes previos que informan (no repetir errores ya observados).
  const evitar = new Set<RecommendedAction>();
  for (const a of aprendizajes) { if (a.evitarAccion) { evitar.add(a.evitarAccion); used.push(a.enunciado); } }

  let action: RecommendedAction; let why: string; let expectedEffect: string; let risk: string; let confidence: SampleConfidence;

  const problemaTargeting = pm.trafficQuality === 'POOR' || pm.trafficQuality === 'MIXED' || pm.concentration.findings.length > 0;

  if (!metrics.spend && !metrics.clicks) {
    action = 'COLLECT_MORE_DATA'; why = 'Aún no hay actividad suficiente para diagnosticar.'; expectedEffect = 'Acumular señal antes de decidir.'; risk = 'Ninguno (observación).'; confidence = 'LOW';
  } else if (cero && !pm.sample.suficienteParaConcluirNoConvierte && problemaTargeting) {
    // Caso central: 0 contactos con muestra chica + targeting ambiguo ⇒ NO concluir que no convierte; preparar Exp. 2.
    action = 'PREPARE_EXPERIMENT_2';
    why = 'No hay evidencia suficiente para decir que el producto no convierte; sí la hay de targeting demasiado ambiguo. Reanudar la campaña tal cual repetiría el mismo tráfico.';
    expectedEffect = 'Tráfico más cualificado (concordancia exacta + negativas) con el mismo o menor presupuesto ⇒ mayor probabilidad de contacto por clic.';
    risk = 'Menor volumen de clics; si el CPC exacto sube, se agota antes el presupuesto (mitigado con CPC cap y stop).';
    confidence = 'MEDIUM';
  } else if (cero && pm.sample.suficienteParaConcluirNoConvierte && !problemaTargeting) {
    // Muestra suficiente + tráfico cualificado + 0 contactos ⇒ el cuello no es el targeting.
    action = 'CHANGE_LANDING';
    why = 'Con tráfico cualificado y muestra suficiente sin contactos, el cuello probable está en oferta/landing/mensaje, no en el targeting.';
    expectedEffect = 'Mejor conversión del tráfico ya cualificado.'; risk = 'Requiere rediseño de landing/oferta.'; confidence = 'MEDIUM';
  } else if (!cero) {
    action = 'KEEP_RUNNING'; why = 'La campaña produce contactos; mantener y optimizar.'; expectedEffect = 'Sostener el flujo de contactos.'; risk = 'Bajo.'; confidence = pm.sample.confidence;
  } else {
    action = 'COLLECT_MORE_DATA'; why = 'Señal ambigua; observar un poco más antes de cambiar la estrategia.'; expectedEffect = 'Reducir incertidumbre.'; risk = 'Gasto adicional acotado por el stop.'; confidence = 'LOW';
  }

  // Un aprendizaje previo puede vetar una acción ya probada como error (p.ej. no repetir Maximize Conversions sin señal).
  if (evitar.has(action) && action === 'PREPARE_EXPERIMENT_2') why += ' (Se incorporan aprendizajes previos para no repetir configuraciones que ya fallaron.)';

  const humanApprovalRequired = !esAccionReductoraDeRiesgo(action);
  // Costo estimado: un nuevo experimento compromete a lo sumo el presupuesto del experimento previo (o su cap).
  const estimatedCostClp = action === 'PREPARE_EXPERIMENT_2' ? (pm.metrics.budget ?? null) : null;
  return { action, why, evidence, confidence, expectedEffect, risk, estimatedCostClp, humanApprovalRequired, usedLearnings: used };
}

// ── Decision Pack (listo para aprobar) ─────────────────────────────────────────
export interface DecisionPack {
  readonly decision: string;
  readonly reason: string;
  readonly proposedChanges: readonly string[];
  readonly maxNewCommitmentClp: number | null;
  readonly expectedSampleClicks: string;
  readonly risk: string;
  readonly buttons: readonly ['APROBAR', 'RECHAZAR', 'AJUSTAR'];
  readonly humanApprovalRequired: true;
}

export function construirDecisionPack(pm: PostMortem, rec: Recomendacion): DecisionPack | null {
  if (!rec.humanApprovalRequired) return null;
  if (rec.action === 'PREPARE_EXPERIMENT_2') {
    return {
      decision: 'Preparar Experimento 2 (targeting más cualificado)',
      reason: rec.why,
      proposedChanges: [
        'Concordancia EXACTA (no amplia) en las consultas comerciales.',
        'Negativas: navegacionales/login y marcas de competidor sin intención compradora.',
        'Límite de CPC (CPC cap) para proteger el presupuesto.',
        'Geo acotado al mercado objetivo.',
        'Presupuesto y stop de seguridad iguales o menores al experimento anterior.',
      ],
      maxNewCommitmentClp: rec.estimatedCostClp,
      expectedSampleClicks: 'Menor volumen pero más cualificado; se define al aprobar el presupuesto/CPC.',
      risk: rec.risk,
      buttons: ['APROBAR', 'RECHAZAR', 'AJUSTAR'],
      humanApprovalRequired: true,
    };
  }
  return {
    decision: `Acción propuesta: ${rec.action}`,
    reason: rec.why,
    proposedChanges: [rec.expectedEffect],
    maxNewCommitmentClp: rec.estimatedCostClp,
    expectedSampleClicks: '—',
    risk: rec.risk,
    buttons: ['APROBAR', 'RECHAZAR', 'AJUSTAR'],
    humanApprovalRequired: true,
  };
}

// ── Eventos del director ─────────────────────────────────────────────────────────
export interface EventoDetectado { readonly evento: DirectorEvent; readonly outcome: EventOutcome; readonly detalle: string }
export function detectarEventos(ev: EvidenciaExperimento, pm: PostMortem): EventoDetectado[] {
  const out: EventoDetectado[] = [];
  if (ev.stopTriggered) out.push({ evento: 'STOP_TRIGGERED', outcome: 'AUTO_PAUSE', detalle: `Stop ${ev.stopRule ?? ''} disparado.` });
  if (ev.status === 'PAUSED') out.push({ evento: 'CAMPAIGN_PAUSED', outcome: 'RECOMMENDATION', detalle: 'Campaña en pausa.' });
  if (ev.periodoTerminado) out.push({ evento: 'CAMPAIGN_ENDED', outcome: 'RECOMMENDATION', detalle: 'El período del experimento terminó.' });
  if ((ev.contacts ?? 0) === 0 && ev.spend != null && ev.spend >= ev.zeroContactStopClp) out.push({ evento: 'ZERO_CONTACT_SPEND_THRESHOLD', outcome: 'AUTO_PAUSE', detalle: `Gasto ${Math.round(ev.spend)} sin contactos.` });
  if ((ev.contacts ?? 0) > 0) out.push({ evento: 'FIRST_CONTACT', outcome: 'RECOMMENDATION', detalle: 'Hay al menos un contacto real.' });
  if ((ev.conversions ?? 0) > 0) out.push({ evento: 'CONVERSION_RECEIVED', outcome: 'RECOMMENDATION', detalle: 'Conversión registrada.' });
  for (const c of pm.concentration.findings) out.push({ evento: 'KEYWORD_SPEND_CONCENTRATION', outcome: 'HUMAN_DECISION_REQUIRED', detalle: `${c.termino} ${c.sharePct}%.` });
  const irrelevantes = pm.trafficQuality === 'POOR';
  if (irrelevantes) out.push({ evento: 'SEARCH_TERM_IRRELEVANCE', outcome: 'HUMAN_DECISION_REQUIRED', detalle: 'Tráfico dominado por consultas no comerciales.' });
  if (!ev.trackingValid) out.push({ evento: 'TRACKING_INVALID', outcome: 'AUTO_PAUSE', detalle: 'Medición inválida.' });
  if (!ev.landingValid) out.push({ evento: 'LANDING_INVALID', outcome: 'AUTO_PAUSE', detalle: 'Landing inválida.' });
  if (out.length === 0) out.push({ evento: 'FIRST_IMPRESSION', outcome: (ev.impressions ?? 0) > 0 ? 'OBSERVE_MORE' : 'NO_ACTION', detalle: 'Observando.' });
  return out;
}

// ── Ensamble completo ────────────────────────────────────────────────────────────
export interface AnalisisDirector {
  readonly postMortem: PostMortem;
  readonly recomendacion: Recomendacion;
  readonly decisionPack: DecisionPack | null;
  readonly eventos: readonly EventoDetectado[];
}
export function analizarExperimento(ev: EvidenciaExperimento, aprendizajes: readonly AprendizajePrevio[] = []): AnalisisDirector {
  const postMortem = construirPostMortem(ev);
  const recomendacion = construirRecomendacion(postMortem, aprendizajes);
  const decisionPack = construirDecisionPack(postMortem, recomendacion);
  const eventos = detectarEventos(ev, postMortem);
  return { postMortem, recomendacion, decisionPack, eventos };
}
