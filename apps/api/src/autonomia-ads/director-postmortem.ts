/**
 * apps/api · autonomia-ads · MOTOR DEL DIRECTOR (PURO, determinista, sin I/O).
 *
 * Convierte la EVIDENCIA REAL de un experimento en un análisis estructurado accionable. SEPARA con rigor:
 *   - KEYWORD (lo que pujamos) ≠ SEARCH TERM (lo que el usuario tecleó) ≠ gasto NO DIVULGADO por privacidad.
 *   Está PROHIBIDO atribuir el gasto oculto a un término visible, o el gasto de una keyword a un search term.
 * Flujo: keyword-concentration + search-term-quality + privacy-accounting + muestra → diagnóstico causal →
 *   post-mortem → recomendación (evidencia OBSERVED/INFERRED/UNKNOWN) → decision pack listo para aprobar.
 *
 * Doctrina: ausencia de datos ⇒ UNKNOWN (nunca inventado); 0 contactos con muestra chica NO concluye "no
 * convierte"; reducir riesgo (PAUSE/STOP) es autónomo, escalar gasto/crear/reanudar SIEMPRE requiere humano.
 */
import { clasificarTermino, LEXICO_DENTAL_POR_DEFECTO, type IntentCategory, type IntentLexicon, type Confidence } from '../campana/intent-classifier';

export type CommercialIntent =
  | 'HIGH_COMMERCIAL_INTENT' | 'MEDIUM_COMMERCIAL_INTENT' | 'LOW_COMMERCIAL_INTENT'
  | 'NAVIGATIONAL' | 'IRRELEVANT' | 'UNKNOWN';
export type TrafficQuality = 'GOOD' | 'MIXED' | 'POOR' | 'UNKNOWN';
export type SampleConfidence = 'LOW' | 'MEDIUM' | 'HIGH';
/** Estatus epistémico de un dato: medido, inferido de lo medido, o desconocido (no divulgado / sin datos). */
export type Epistemic = 'OBSERVED' | 'INFERRED' | 'UNKNOWN';
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

// Umbrales GENERALES (no derivados de ningún experimento objetivo).
export const CLICS_MIN_PARA_CONCLUIR = 30;
export const CLICS_MUESTRA_MEDIA = 100;
export const UMBRAL_CONCENTRACION = 0.6;   // fracción del gasto de campaña en una keyword sin contactos ⇒ revisar
export const FACTOR_MEJORA_CPC = 0.75;

/** Search term = lo que el usuario TECLEÓ (con su gasto real, si Google lo divulga). */
export interface TermSpend { readonly termino: string; readonly impresiones: number; readonly clics: number; readonly gasto: number | null }
/** Keyword = lo que NOSOTROS pujamos (texto + concordancia + gasto por keyword). */
export interface KeywordSpend { readonly keyword: string; readonly matchType: string | null; readonly impresiones: number; readonly clics: number; readonly gasto: number | null; readonly conversions: number | null }
/** Evidencia por dimensión (device/geo/network): fila con métricas reales. */
export interface DimRow { readonly clave: string; readonly impresiones: number; readonly clics: number; readonly gasto: number | null; readonly conversions: number | null }
/** Fase de la campaña (cambio de estrategia de puja). Los números salen de GAQL scopeado a la ventana de la fase. */
export interface PhaseInfo {
  readonly label: string; readonly startAt: string | null; readonly endAt: string | null;
  readonly biddingStrategy: string | null; readonly maxCpc: number | null;
  readonly spend: number | null; readonly impressions: number | null; readonly clicks: number | null; readonly avgCpcClp: number | null;
}
export type PhaseSegmentation = 'SEGMENTED' | 'UNKNOWN';

export interface EvidenciaExperimento {
  readonly campaignId: string;
  readonly status: string | null;               // ENABLED | PAUSED | null
  readonly periodoTerminado: boolean;
  readonly spend: number | null;                 // gasto de la FASE analizada (post-cambio si segmentado; total si UNKNOWN)
  readonly campaignTotalSpendClp: number | null; // gasto TOTAL de la campaña (todas las fases) — NO confundir con `spend`
  readonly experimentBudgetClp: number | null;
  readonly impressions: number | null;
  readonly clicks: number | null;
  readonly contacts: number | null;              // contactos first-party
  readonly conversions: number | null;
  readonly avgCpcClp: number | null;
  readonly ctr: number | null;
  readonly keywords: readonly KeywordSpend[];    // NIVEL KEYWORD (lo pujado)
  readonly terminos: readonly TermSpend[];       // NIVEL SEARCH TERM (lo tecleado)
  readonly devices: readonly DimRow[];
  readonly geos: readonly DimRow[];
  readonly networks: readonly DimRow[];
  readonly trackingValid: boolean;
  readonly landingValid: boolean;
  readonly zeroContactStopClp: number;
  readonly stopTriggered: boolean;
  readonly stopRule: string | null;
  readonly cpcInicialClp: number | null;
  readonly cpcPosteriorClp: number | null;
  readonly phases: readonly PhaseInfo[];
  readonly phaseSegmentation: PhaseSegmentation;
  readonly analyzedPhaseLabel: string | null;   // qué fase representa esta evidencia (la relevante/post-cambio)
  readonly lexico?: IntentLexicon;
}

// ── Calidad de tráfico (SOBRE SEARCH TERMS visibles) ──────────────────────────────
export function intentComercial(cat: IntentCategory, conf: Confidence): CommercialIntent {
  switch (cat) {
    case 'CLINIC_MANAGEMENT_INTENT': return conf === 'HIGH' ? 'HIGH_COMMERCIAL_INTENT' : 'MEDIUM_COMMERCIAL_INTENT';
    case 'COMPETITOR_BUYER_INTENT': return 'MEDIUM_COMMERCIAL_INTENT';
    case 'PATIENT_INTENT': return 'LOW_COMMERCIAL_INTENT';
    case 'COMPETITOR_NAVIGATIONAL': return 'NAVIGATIONAL';
    case 'CLINICAL_TECH_SOFTWARE': return 'IRRELEVANT';
    case 'COMPETITOR_EDUCATIONAL_OR_INSTITUTIONAL':
    case 'EDUCATIONAL': return 'IRRELEVANT';
    default: return 'UNKNOWN';
  }
}
const ES_COMERCIAL = (i: CommercialIntent): boolean => i === 'HIGH_COMMERCIAL_INTENT' || i === 'MEDIUM_COMMERCIAL_INTENT';

/** Hallazgo por SEARCH TERM visible: clasificación + gasto real del término + su share del gasto de CAMPAÑA. */
export interface SearchTermFinding { readonly termino: string; readonly intent: CommercialIntent; readonly confidence: Confidence; readonly clics: number; readonly gasto: number | null; readonly shareCampaignPct: number | null; readonly epistemic: Epistemic }
const RANGO_CONF: Record<Confidence, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };
export interface CalidadTrafico { readonly quality: TrafficQuality; readonly findings: readonly SearchTermFinding[]; readonly gastoComercialPctVisible: number | null }

export function analizarCalidadTrafico(terminos: readonly TermSpend[], campaignSpend: number | null, lex: IntentLexicon = LEXICO_DENTAL_POR_DEFECTO): CalidadTrafico {
  if (terminos.length === 0) return { quality: 'UNKNOWN', findings: [], gastoComercialPctVisible: null };
  const findings: SearchTermFinding[] = terminos.map((t) => {
    const { category, confidence } = clasificarTermino(t.termino, lex);
    const intent = intentComercial(category, confidence);
    const shareCampaignPct = t.gasto != null && campaignSpend && campaignSpend > 0 ? Math.round((t.gasto / campaignSpend) * 1000) / 10 : null;
    return { termino: t.termino, intent, confidence, clics: t.clics, gasto: t.gasto, shareCampaignPct, epistemic: 'OBSERVED' as Epistemic };
  });
  // ORDEN por RELEVANCIA ECONÓMICA (no por orden de llegada): así el "titular" usa evidencia con impacto real y no un
  // término de 0 gasto/0 clics. 1º los con clics>0 Y gasto>0; luego mayor gasto; luego mayor confianza; luego impresiones.
  const imprDe = (termino: string): number => terminos.find((t) => t.termino === termino)?.impresiones ?? 0;
  const econ = (f: SearchTermFinding): number => (f.clics > 0 && (f.gasto ?? 0) > 0 ? 1 : 0);
  findings.sort((a, b) => econ(b) - econ(a) || (b.gasto ?? 0) - (a.gasto ?? 0) || RANGO_CONF[b.confidence] - RANGO_CONF[a.confidence] || imprDe(b.termino) - imprDe(a.termino));
  // Calidad de lo VISIBLE (no del total: gran parte del gasto puede ser no divulgado). Share por gasto si hay
  // gasto por término; si no, por impresiones (respaldo). Cada finding conoce su propio gasto/impresiones del término.
  const idx = new Map(terminos.map((t) => [t.termino, t]));
  const gastoVisible = findings.reduce((a, t) => a + (t.gasto ?? 0), 0);
  const gastoComercialVisible = findings.filter((t) => ES_COMERCIAL(t.intent)).reduce((a, t) => a + (t.gasto ?? 0), 0);
  const pctGasto = gastoVisible > 0 ? gastoComercialVisible / gastoVisible : null;
  const imprTotal = terminos.reduce((a, t) => a + t.impresiones, 0);
  const imprComercial = findings.filter((t) => ES_COMERCIAL(t.intent)).reduce((a, t) => a + (idx.get(t.termino)?.impresiones ?? 0), 0);
  const shareImpr = imprTotal > 0 ? imprComercial / imprTotal : null;
  const share = pctGasto ?? shareImpr;
  const quality: TrafficQuality = share == null ? 'UNKNOWN' : share >= 0.7 ? 'GOOD' : share >= 0.35 ? 'MIXED' : 'POOR';
  return { quality, findings, gastoComercialPctVisible: pctGasto == null ? null : Math.round(pctGasto * 100) / 100 };
}

// ── Concentración de gasto POR KEYWORD (nunca por search term) ─────────────────────
export interface KeywordFinding { readonly keyword: string; readonly matchType: string | null; readonly sharePct: number; readonly gasto: number; readonly contactos: number; readonly flag: 'KEYWORD_REVIEW_REQUIRED'; readonly epistemic: 'OBSERVED'; readonly porque: string }
export function analizarConcentracionKeywords(keywords: readonly KeywordSpend[], campaignSpend: number | null, contactos: number | null): KeywordFinding[] {
  const base = campaignSpend ?? keywords.reduce((a, k) => a + (k.gasto ?? 0), 0);
  if (!base || base <= 0) return [];
  const out: KeywordFinding[] = [];
  for (const k of keywords) {
    if (k.gasto == null || k.gasto <= 0) continue;
    const share = k.gasto / base;
    if (share >= UMBRAL_CONCENTRACION && (contactos ?? 0) === 0) {
      out.push({ keyword: k.keyword, matchType: k.matchType, sharePct: Math.round(share * 1000) / 10, gasto: Math.round(k.gasto), contactos: 0, flag: 'KEYWORD_REVIEW_REQUIRED', epistemic: 'OBSERVED',
        porque: `La keyword "${k.keyword}"${k.matchType ? ` (${k.matchType})` : ''} concentró ~${Math.round(share * 100)}% del gasto sin contactos: revisar concordancia/negativas (no se elimina automáticamente).` });
    }
  }
  return out;
}

// ── Contabilidad de privacidad de search terms ────────────────────────────────────
export interface SearchTermPrivacy { readonly reportedSpend: number | null; readonly unreportedSpend: number | null; readonly unreportedPct: number | null; readonly epistemic: Epistemic }
export function contabilidadPrivacidad(terminos: readonly TermSpend[], campaignSpend: number | null): SearchTermPrivacy {
  const conGasto = terminos.filter((t) => t.gasto != null) as (TermSpend & { gasto: number })[];
  const reported = conGasto.length ? conGasto.reduce((a, t) => a + t.gasto, 0) : null;
  if (campaignSpend == null || campaignSpend <= 0 || reported == null) return { reportedSpend: reported, unreportedSpend: null, unreportedPct: null, epistemic: 'UNKNOWN' };
  const unreported = Math.max(0, campaignSpend - reported);
  return { reportedSpend: Math.round(reported), unreportedSpend: Math.round(unreported), unreportedPct: Math.round((unreported / campaignSpend) * 1000) / 10, epistemic: 'INFERRED' };
}

// ── Conciencia de muestra + confianza causal ───────────────────────────────────────
export interface AnalisisMuestra { readonly confidence: SampleConfidence; readonly suficienteParaConcluirNoConvierte: boolean; readonly porque: string }
export function evaluarMuestra(clicks: number | null, contacts: number | null): AnalisisMuestra {
  if (clicks == null) return { confidence: 'LOW', suficienteParaConcluirNoConvierte: false, porque: 'Sin datos de clics: muestra no evaluable.' };
  const confidence: SampleConfidence = clicks >= CLICS_MUESTRA_MEDIA ? 'HIGH' : clicks >= CLICS_MIN_PARA_CONCLUIR ? 'MEDIUM' : 'LOW';
  const suficiente = clicks >= CLICS_MIN_PARA_CONCLUIR;
  const porque = suficiente
    ? `${clicks} clics: muestra suficiente para leer señales de conversión.`
    : `${clicks} clics + ${contacts ?? 0} contactos: muestra insuficiente para concluir que el producto no convierte.`;
  return { confidence, suficienteParaConcluirNoConvierte: suficiente, porque };
}
/** Confianza causal: degrada a LOW si la muestra es chica O si la mayoría del gasto no está divulgado. */
export function confianzaCausal(muestra: AnalisisMuestra, privacy: SearchTermPrivacy): SampleConfidence {
  if (muestra.confidence === 'LOW') return 'LOW';
  if (privacy.unreportedPct != null && privacy.unreportedPct >= 50) return 'LOW';
  return muestra.confidence;
}

export function controlPujaFunciono(cpcInicial: number | null, cpcPosterior: number | null): boolean | null {
  if (cpcInicial == null || cpcPosterior == null || cpcInicial <= 0) return null;
  return cpcPosterior <= cpcInicial * FACTOR_MEJORA_CPC;
}

// ── Diagnóstico causal ──────────────────────────────────────────────────────────────
export interface FactorCausal { readonly factor: CausalFactor; readonly evidencia: string; readonly confianza: SampleConfidence; readonly epistemic: Epistemic }
export function diagnosticoCausal(ev: EvidenciaExperimento, calidad: CalidadTrafico, keywordFindings: readonly KeywordFinding[], muestra: AnalisisMuestra, privacy: SearchTermPrivacy): FactorCausal[] {
  const f: FactorCausal[] = [];
  if (!ev.trackingValid) f.push({ factor: 'TRACKING', evidencia: 'La medición no está validada.', confianza: 'HIGH', epistemic: 'OBSERVED' });
  if (!ev.landingValid) f.push({ factor: 'LANDING', evidencia: 'La página de destino no está disponible/válida.', confianza: 'HIGH', epistemic: 'OBSERVED' });
  if (keywordFindings.length > 0) f.push({ factor: 'KEYWORD_MATCHING', evidencia: `Una keyword concentró el gasto en concordancia amplia (${keywordFindings.map((k) => `${k.keyword} ~${Math.round(k.sharePct)}%`).join(', ')}).`, confianza: 'MEDIUM', epistemic: 'OBSERVED' });
  if (calidad.quality === 'POOR' || calidad.quality === 'MIXED') {
    const naveg = calidad.findings.filter((t) => !ES_COMERCIAL(t.intent) && t.intent !== 'UNKNOWN').map((t) => t.termino).slice(0, 3);
    f.push({ factor: 'TRAFFIC_QUALITY', evidencia: `Entre los términos VISIBLES hay consultas de baja intención comercial${naveg.length ? ` (p.ej. ${naveg.join(', ')})` : ''}.`, confianza: calidad.quality === 'POOR' ? 'MEDIUM' : 'LOW', epistemic: 'OBSERVED' });
  }
  if ((ev.contacts ?? 0) === 0 && !muestra.suficienteParaConcluirNoConvierte) f.push({ factor: 'INSUFFICIENT_SAMPLE', evidencia: muestra.porque, confianza: 'HIGH', epistemic: 'OBSERVED' });
  if (privacy.unreportedPct != null && privacy.unreportedPct >= 50) f.push({ factor: 'OTHER', evidencia: `${privacy.unreportedPct}% del gasto está en términos NO divulgados por privacidad de Google: parte del diagnóstico es INFERIDO, no observado.`, confianza: 'LOW', epistemic: 'INFERRED' });
  if (controlPujaFunciono(ev.cpcInicialClp, ev.cpcPosteriorClp) === false) f.push({ factor: 'HIGH_CPC', evidencia: 'El CPC sigue alto tras el cambio de estrategia.', confianza: 'MEDIUM', epistemic: 'OBSERVED' });
  if (f.length === 0) f.push({ factor: 'OTHER', evidencia: 'Sin causa dominante identificable con la evidencia disponible.', confianza: 'LOW', epistemic: 'UNKNOWN' });
  return f;
}

// ── Post-mortem ──────────────────────────────────────────────────────────────────────
export interface PostMortem {
  readonly campaignId: string;
  readonly metrics: { spend: number | null; campaignTotalSpend: number | null; stopThreshold: number | null; budget: number | null; impressions: number | null; clicks: number | null; ctr: number | null; avgCpcClp: number | null; contacts: number | null; conversions: number | null; cpaClp: number | null };
  readonly biddingBefore: number | null; readonly biddingAfter: number | null; readonly biddingControlWorked: boolean | null;
  readonly trafficQuality: TrafficQuality;
  readonly keywordConcentration: readonly KeywordFinding[];
  readonly searchTermFindings: readonly SearchTermFinding[];
  readonly searchTermPrivacy: SearchTermPrivacy;
  readonly devices: readonly DimRow[]; readonly geos: readonly DimRow[]; readonly networks: readonly DimRow[];
  readonly sample: AnalisisMuestra; readonly causalConfidence: SampleConfidence;
  readonly diagnosis: readonly FactorCausal[];
  readonly stopReason: string | null; readonly restartRecommended: boolean;
  readonly phases: readonly PhaseInfo[]; readonly phaseSegmentation: PhaseSegmentation; readonly analyzedPhaseLabel: string | null;
}

export function construirPostMortem(ev: EvidenciaExperimento): PostMortem {
  const calidad = analizarCalidadTrafico(ev.terminos, ev.spend, ev.lexico);
  const keywordConcentration = analizarConcentracionKeywords(ev.keywords, ev.spend, ev.contacts);
  const privacy = contabilidadPrivacidad(ev.terminos, ev.spend);
  const sample = evaluarMuestra(ev.clicks, ev.contacts);
  const causalConfidence = confianzaCausal(sample, privacy);
  const diagnosis = diagnosticoCausal(ev, calidad, keywordConcentration, sample, privacy);
  const cpa = (ev.contacts ?? 0) > 0 && ev.spend != null ? Math.round(ev.spend / (ev.contacts as number)) : null;
  const problemaTargeting = calidad.quality === 'POOR' || calidad.quality === 'MIXED' || keywordConcentration.length > 0;
  const restartRecommended = !problemaTargeting && ev.trackingValid && ev.landingValid && (ev.contacts ?? 0) > 0;
  return {
    campaignId: ev.campaignId,
    metrics: { spend: ev.spend, campaignTotalSpend: ev.campaignTotalSpendClp, stopThreshold: ev.zeroContactStopClp, budget: ev.experimentBudgetClp, impressions: ev.impressions, clicks: ev.clicks, ctr: ev.ctr, avgCpcClp: ev.avgCpcClp, contacts: ev.contacts, conversions: ev.conversions, cpaClp: cpa },
    biddingBefore: ev.cpcInicialClp, biddingAfter: ev.cpcPosteriorClp, biddingControlWorked: controlPujaFunciono(ev.cpcInicialClp, ev.cpcPosteriorClp),
    trafficQuality: calidad.quality, keywordConcentration, searchTermFindings: calidad.findings, searchTermPrivacy: privacy,
    devices: ev.devices, geos: ev.geos, networks: ev.networks,
    sample, causalConfidence, diagnosis,
    stopReason: ev.stopTriggered ? ev.stopRule : null, restartRecommended,
    phases: ev.phases, phaseSegmentation: ev.phaseSegmentation, analyzedPhaseLabel: ev.analyzedPhaseLabel,
  };
}

// ── Recomendación ──────────────────────────────────────────────────────────────────────
export interface Recomendacion {
  readonly action: RecommendedAction; readonly why: string; readonly evidence: readonly string[]; readonly confidence: SampleConfidence;
  readonly expectedEffect: string; readonly risk: string; readonly estimatedCostClp: number | null;
  readonly humanApprovalRequired: boolean; readonly usedLearnings: readonly string[];
}
export function esAccionReductoraDeRiesgo(a: RecommendedAction): boolean {
  return a === 'PAUSE' || a === 'DO_NOT_RESTART' || a === 'COLLECT_MORE_DATA' || a === 'STOP_MARKETING_CHANNEL';
}
export interface AprendizajePrevio { readonly enunciado: string; readonly evitarAccion?: RecommendedAction }

export function construirRecomendacion(pm: PostMortem, aprendizajes: readonly AprendizajePrevio[] = []): Recomendacion {
  const evidence: string[] = [];
  const used: string[] = [];
  const cero = (pm.metrics.contacts ?? 0) === 0;
  if (pm.metrics.spend != null) evidence.push(`OBSERVED: gasto ${Math.round(pm.metrics.spend)} CLP · ${pm.metrics.clicks ?? 0} clics · ${pm.metrics.contacts ?? 0} contactos.`);
  if (pm.biddingControlWorked === true) evidence.push(`OBSERVED: el control de CPC funcionó (${Math.round(pm.biddingBefore ?? 0)} → ~${Math.round(pm.biddingAfter ?? 0)} CLP).`);
  for (const k of pm.keywordConcentration) evidence.push(`OBSERVED (keyword): "${k.keyword}" concentró ~${Math.round(k.sharePct)}% del gasto, 0 contactos.`);
  for (const t of pm.searchTermFindings.filter((f) => !ES_COMERCIAL(f.intent) && f.intent !== 'UNKNOWN')) evidence.push(`OBSERVED (search term visible): "${t.termino}" = ${t.intent}${t.gasto != null ? ` (${Math.round(t.gasto)} CLP${t.shareCampaignPct != null ? `, ${t.shareCampaignPct}% del gasto` : ''})` : ''}.`);
  if (pm.searchTermPrivacy.unreportedPct != null) evidence.push(`INFERRED: ${pm.searchTermPrivacy.unreportedPct}% del gasto está en términos NO divulgados por privacidad de Google (UNKNOWN a nivel término).`);
  evidence.push(`OBSERVED: ${pm.sample.porque}`);

  const evitar = new Set<RecommendedAction>();
  for (const a of aprendizajes) if (a.evitarAccion) { evitar.add(a.evitarAccion); used.push(a.enunciado); }

  let action: RecommendedAction; let why: string; let expectedEffect: string; let risk: string;
  const problemaTargeting = pm.trafficQuality === 'POOR' || pm.trafficQuality === 'MIXED' || pm.keywordConcentration.length > 0;

  if (!pm.metrics.spend && !pm.metrics.clicks) {
    action = 'COLLECT_MORE_DATA'; why = 'Aún no hay actividad suficiente para diagnosticar.'; expectedEffect = 'Acumular señal antes de decidir.'; risk = 'Ninguno (observación).';
  } else if (cero && !pm.sample.suficienteParaConcluirNoConvierte && problemaTargeting) {
    action = 'PREPARE_EXPERIMENT_2';
    // Combina AMBAS evidencias SIN atribuir el gasto oculto al término visible.
    const partes: string[] = [];
    if (pm.keywordConcentration.length) partes.push(`una keyword concentró ~${Math.round(pm.keywordConcentration[0]!.sharePct)}% del gasto`);
    const nav = pm.searchTermFindings.find((f) => !ES_COMERCIAL(f.intent) && f.intent !== 'UNKNOWN');
    if (nav) partes.push(`al menos una expansión visible fue navegación/irrelevante ("${nav.termino}")`);
    if (pm.searchTermPrivacy.unreportedPct != null && pm.searchTermPrivacy.unreportedPct >= 50) partes.push(`la mayoría del gasto (${pm.searchTermPrivacy.unreportedPct}%) quedó en términos no divulgados`);
    why = `No hay evidencia suficiente para decir que el producto no convierte (muestra chica). Sí hay evidencia de que el matching fue demasiado ambiguo para este presupuesto: ${partes.join('; ')}. Reanudar tal cual repetiría el mismo tráfico.`;
    expectedEffect = 'Tráfico más cualificado (concordancia exacta + negativas) con igual o menor presupuesto ⇒ más probabilidad de contacto por clic.';
    risk = 'Menor volumen de clics; mitigado con CPC cap y stop de seguridad.';
  } else if (cero && pm.sample.suficienteParaConcluirNoConvierte && !problemaTargeting) {
    action = 'CHANGE_LANDING'; why = 'Con tráfico cualificado y muestra suficiente sin contactos, el cuello probable está en oferta/landing/mensaje.'; expectedEffect = 'Mejor conversión del tráfico ya cualificado.'; risk = 'Requiere rediseño de landing/oferta.';
  } else if (!cero) {
    action = 'KEEP_RUNNING'; why = 'La campaña produce contactos; mantener y optimizar.'; expectedEffect = 'Sostener el flujo de contactos.'; risk = 'Bajo.';
  } else {
    action = 'COLLECT_MORE_DATA'; why = 'Señal ambigua; observar un poco más.'; expectedEffect = 'Reducir incertidumbre.'; risk = 'Gasto acotado por el stop.';
  }
  if (evitar.has(action)) why += ' (Se incorporan aprendizajes previos para no repetir configuraciones que ya fallaron.)';

  const humanApprovalRequired = !esAccionReductoraDeRiesgo(action);
  // Costo de EJECUTAR esta acción. PREPARE_EXPERIMENT_2 sólo autoriza PLANIFICAR ⇒ 0 CLP de compromiso nuevo (el
  // presupuesto real se define y autoriza recién en la decisión LAUNCH). NUNCA reutilizar el presupuesto histórico.
  const estimatedCostClp = action === 'PREPARE_EXPERIMENT_2' ? 0 : null;
  return { action, why, evidence, confidence: pm.causalConfidence, expectedEffect, risk, estimatedCostClp, humanApprovalRequired, usedLearnings: used };
}

// ── Decision Pack ─────────────────────────────────────────────────────────────────────
export interface DecisionPack {
  readonly decision: string; readonly reason: string; readonly proposedChanges: readonly string[];
  readonly maxNewCommitmentClp: number | null;          // COMPROMISO NUEVO que autoriza ESTA decisión (PREPARE ⇒ 0)
  readonly historicalCampaignBudgetClp: number | null;  // presupuesto del experimento ANTERIOR (contexto, no compromiso)
  readonly historicalSpendClp: number | null;           // gasto TOTAL ya realizado en el experimento anterior
  readonly providerWritesExpected: number;              // escrituras a Google que produce aprobar ESTA decisión (PREPARE ⇒ 0)
  readonly expectedSampleClicks: string; readonly risk: string; readonly buttons: readonly ['APROBAR', 'RECHAZAR', 'AJUSTAR']; readonly humanApprovalRequired: true;
}
export function construirDecisionPack(pm: PostMortem, rec: Recomendacion): DecisionPack | null {
  if (!rec.humanApprovalRequired) return null;
  const historicalCampaignBudgetClp = pm.metrics.budget ?? null;
  const historicalSpendClp = pm.metrics.campaignTotalSpend ?? null;
  if (rec.action === 'PREPARE_EXPERIMENT_2') {
    return {
      decision: 'Preparar Experimento 2 (targeting más cualificado)', reason: rec.why,
      proposedChanges: [
        'Concordancia EXACTA (no amplia) en las consultas comerciales.',
        'Negativas: navegacionales/login y marcas de competidor sin intención compradora.',
        'Límite de CPC (CPC cap) para proteger el presupuesto.',
        'Geo acotado al mercado objetivo.',
        'Presupuesto y stop de seguridad iguales o menores al experimento anterior.',
      ],
      // Aprobar PREPARE sólo autoriza que SOEC ARME el plan del Experimento 2: 0 compromiso nuevo, 0 escrituras a Google.
      maxNewCommitmentClp: 0, historicalCampaignBudgetClp, historicalSpendClp, providerWritesExpected: 0,
      expectedSampleClicks: 'Menor volumen pero más cualificado; se define al aprobar presupuesto/CPC (decisión LAUNCH).',
      risk: rec.risk, buttons: ['APROBAR', 'RECHAZAR', 'AJUSTAR'], humanApprovalRequired: true,
    };
  }
  return { decision: `Acción propuesta: ${rec.action}`, reason: rec.why, proposedChanges: [rec.expectedEffect], maxNewCommitmentClp: rec.estimatedCostClp, historicalCampaignBudgetClp, historicalSpendClp, providerWritesExpected: 0, expectedSampleClicks: '—', risk: rec.risk, buttons: ['APROBAR', 'RECHAZAR', 'AJUSTAR'], humanApprovalRequired: true };
}

// ── Eventos ────────────────────────────────────────────────────────────────────────────
export interface EventoDetectado { readonly evento: DirectorEvent; readonly outcome: EventOutcome; readonly detalle: string }
export function detectarEventos(ev: EvidenciaExperimento, pm: PostMortem): EventoDetectado[] {
  const out: EventoDetectado[] = [];
  if (ev.stopTriggered) out.push({ evento: 'STOP_TRIGGERED', outcome: 'AUTO_PAUSE', detalle: `Stop ${ev.stopRule ?? ''} disparado.` });
  if (ev.status === 'PAUSED') out.push({ evento: 'CAMPAIGN_PAUSED', outcome: 'RECOMMENDATION', detalle: 'Campaña en pausa.' });
  if (ev.periodoTerminado) out.push({ evento: 'CAMPAIGN_ENDED', outcome: 'RECOMMENDATION', detalle: 'El período del experimento terminó.' });
  // El stop de "cero contactos" se evalúa contra el gasto TOTAL de campaña (no el de la fase) vs. su umbral.
  if ((ev.contacts ?? 0) === 0 && ev.campaignTotalSpendClp != null && ev.campaignTotalSpendClp >= ev.zeroContactStopClp) out.push({ evento: 'ZERO_CONTACT_SPEND_THRESHOLD', outcome: 'AUTO_PAUSE', detalle: `Gasto de campaña ${Math.round(ev.campaignTotalSpendClp)} ≥ stop ${Math.round(ev.zeroContactStopClp)} sin contactos.` });
  if ((ev.contacts ?? 0) > 0) out.push({ evento: 'FIRST_CONTACT', outcome: 'RECOMMENDATION', detalle: 'Hay al menos un contacto real.' });
  if ((ev.conversions ?? 0) > 0) out.push({ evento: 'CONVERSION_RECEIVED', outcome: 'RECOMMENDATION', detalle: 'Conversión registrada.' });
  for (const k of pm.keywordConcentration) out.push({ evento: 'KEYWORD_SPEND_CONCENTRATION', outcome: 'HUMAN_DECISION_REQUIRED', detalle: `${k.keyword} ~${Math.round(k.sharePct)}%.` });
  if (pm.trafficQuality === 'POOR') out.push({ evento: 'SEARCH_TERM_IRRELEVANCE', outcome: 'HUMAN_DECISION_REQUIRED', detalle: 'Términos visibles dominados por consultas no comerciales.' });
  if (!ev.trackingValid) out.push({ evento: 'TRACKING_INVALID', outcome: 'AUTO_PAUSE', detalle: 'Medición inválida.' });
  if (!ev.landingValid) out.push({ evento: 'LANDING_INVALID', outcome: 'AUTO_PAUSE', detalle: 'Landing inválida.' });
  if (out.length === 0) out.push({ evento: 'FIRST_IMPRESSION', outcome: (ev.impressions ?? 0) > 0 ? 'OBSERVE_MORE' : 'NO_ACTION', detalle: 'Observando.' });
  return out;
}

// ── Ensamble ────────────────────────────────────────────────────────────────────────────
export interface AnalisisDirector { readonly postMortem: PostMortem; readonly recomendacion: Recomendacion; readonly decisionPack: DecisionPack | null; readonly eventos: readonly EventoDetectado[] }
export function analizarExperimento(ev: EvidenciaExperimento, aprendizajes: readonly AprendizajePrevio[] = []): AnalisisDirector {
  const postMortem = construirPostMortem(ev);
  const recomendacion = construirRecomendacion(postMortem, aprendizajes);
  const decisionPack = construirDecisionPack(postMortem, recomendacion);
  const eventos = detectarEventos(ev, postMortem);
  return { postMortem, recomendacion, decisionPack, eventos };
}
