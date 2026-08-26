/**
 * apps/api · campana · CAMPAIGN BUILDER / STRATEGY PLANNER (PURO, sin I/O).
 *
 * Transición DIAGNÓSTICO → PLAN OPERABLE → CAMPAÑA PUBLICABLE. Separa TRES estados:
 *   STRATEGY_STATUS       (¿hay hipótesis + asignación con el diagnóstico resuelto?)
 *   CAMPAIGN_DRAFT_STATUS (¿la campaña está COMPLETA: copy final, destino validado, keywords bien tipadas?)
 *   EXECUTION_STATUS      (¿el proveedor puede publicar? — gate externo, distinto de todo lo anterior)
 *
 * REGLAS DURAS:
 *  - Contener "software"/"dental" NO implica intención de GESTIÓN: el software clínico/técnico NO se activa
 *    en la campaña de gestión; UNKNOWN NO recibe gasto (OBSERVE_NO_SPEND); competidor = estrategia separada.
 *  - CAMPAIGN_DRAFT_STATUS=READY_FOR_APPROVAL sólo sin PENDING_COPY/PENDING_DESTINATION y con cada keyword
 *    activa y cada negativa completamente tipadas.
 *  - No inventa TARGET_CPA sin evidencia. Nunca excede el tope humano. No hardcodea ninguna organización.
 */
import { evaluarEstrategiaDirector, type EntradaEstrategia } from '../autonomia-ads/estrategia-director';
import { evaluarReadiness, type MarketingReadiness, type ValidatedDestination, type ValueProp } from './diagnosis-evidence';
import type { ChannelAvailability } from './channel-availability';
import { clasificarTerminos, agregarSenales, type ClassifiedTerm, type IntentCategory, type IntentSignal, type Confidence } from './intent-classifier';

export type CanalId = 'google' | 'meta';
export type MatchType = 'EXACT' | 'PHRASE' | 'BROAD';
export type KeywordAction = 'TARGET' | 'SEGMENT' | 'OBSERVE_NO_SPEND' | 'EXCLUDE';
export type StrategyStatus = 'DIAGNOSIS_REQUIRED' | 'READY';
export type CampaignDraftStatus = 'INCOMPLETE' | 'READY_FOR_APPROVAL';
export type ExecutionStatus = 'READY' | 'EXTERNAL_GATE_BLOCKED' | 'AUTONOMY_OFF';
type Nivel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface StopRule {
  readonly id: string;
  readonly tipo: 'BUDGET' | 'ZERO_CONVERSION' | 'CPA' | 'TRACKING' | 'LANDING' | 'PERIOD';
  readonly descripcion: string;
  readonly enabled: boolean;
  readonly threshold?: number | null;
  readonly date?: string | null;
  readonly condition?: string;
  readonly reason?: string;
}

export interface Hypothesis {
  readonly id: string; readonly category: string; readonly statement: string;
  readonly evidenceStrength: Nivel; readonly potentialImpact: Nivel; readonly testCost: Nivel;
  readonly reversibility: Nivel; readonly measurability: Nivel; readonly score: number;
}

export interface ActiveKeyword {
  readonly text: string;
  readonly intentClassification: IntentCategory;
  readonly confidence: Confidence;
  readonly action: Extract<KeywordAction, 'TARGET' | 'SEGMENT'>;
  readonly matchType: MatchType;
  readonly rationale: string;
}
export interface ObserveKeyword { readonly text: string; readonly intentClassification: IntentCategory; readonly confidence: Confidence; readonly reason: string }
export interface NegativeKeyword { readonly text: string; readonly matchType: MatchType; readonly rationale: string }
export interface AdDraft { readonly headlines: readonly string[]; readonly descriptions: readonly string[] }
export interface AdGroupDraft { readonly name: string; readonly intent: IntentCategory; readonly action: KeywordAction; readonly keywords: readonly ActiveKeyword[]; readonly ads: readonly AdDraft[]; readonly finalDestination: string; readonly destinationRationale: string }

export interface KeywordDecision { readonly categoria: IntentCategory; readonly action: KeywordAction; readonly matchType: MatchType | null; readonly reason: string; readonly examples: readonly string[] }

export interface SuccessCriteria { readonly minimumRealContacts: number; readonly maxSpend: number; readonly measurementWindowDays: number; readonly attributionRequirement: string }
export type TargetCpa = { readonly kind: 'VALUE'; readonly value: number; readonly rationale: string } | { readonly kind: 'UNDEFINED_INSUFFICIENT_EVIDENCE'; readonly rationale: string };

export interface CampaignCompleteness {
  readonly status: CampaignDraftStatus;
  readonly pendingCopyCount: number;
  readonly pendingDestination: boolean;
  readonly unknownActiveKeywords: number;
  readonly issues: readonly string[];
}

export interface CampaignDraft {
  readonly channel: CanalId;
  readonly campaignName: string;
  readonly objective: string;
  readonly campaignType: string;
  readonly hypothesisId: string;
  readonly adGroups: readonly AdGroupDraft[];
  readonly negativeKeywords: readonly NegativeKeyword[];
  readonly budget: number;
  readonly durationDays: number;
  readonly trackingRequirements: readonly string[];
  readonly successCriteria: SuccessCriteria;
  readonly stopCriteria: readonly StopRule[];
}

export interface AsignacionCanal { readonly canal: CanalId; readonly disponible: boolean; readonly presupuesto: number; readonly motivo: string }

export interface MarketingPlan {
  readonly objective: string;
  readonly totalAuthorizedBudget: number;
  readonly currency: string;
  readonly period: { readonly dias: number; readonly startAt: string | null; readonly endAt: string | null };
  readonly strategyStatus: StrategyStatus;
  readonly campaignDraftStatus: CampaignDraftStatus;
  readonly executionStatus: ExecutionStatus;
  readonly campaignCompleteness: CampaignCompleteness;
  readonly channelPlanningAvailability: readonly { readonly canal: CanalId; readonly canPlan: boolean }[];
  readonly channelExecutionAvailability: readonly { readonly canal: CanalId; readonly canExecute: boolean; readonly executionGate: string }[];
  readonly channelsConsidered: readonly CanalId[];
  readonly recommendedChannelMix: readonly AsignacionCanal[];
  readonly totalSpendRecommended: number;
  readonly spendRecommendation: string;
  readonly auditFunnel: 'REQUIRED' | 'NOT_REQUIRED';
  readonly selectedHypothesis: Hypothesis | null;
  readonly backlogHypotheses: readonly Hypothesis[];
  readonly keywordDecisions: readonly KeywordDecision[];
  readonly activeKeywords: readonly ActiveKeyword[];
  readonly observeNoSpendKeywords: readonly ObserveKeyword[];
  readonly maxSpendWithoutContact: { readonly value: number; readonly rationale: string };
  readonly targetCpa: TargetCpa;
  readonly successCriteria: SuccessCriteria;
  readonly stopCriteria: readonly StopRule[];
  readonly campaigns: readonly CampaignDraft[];
  readonly reasoning: { readonly facts: readonly string[]; readonly hypotheses: readonly string[] };
  readonly requiredTracking: readonly string[];
  readonly landingIssues: readonly string[];
  readonly risks: readonly string[];
  readonly readinessSummary: string;
}

export interface EntradaMarketingPlan {
  readonly objetivo: string;
  readonly presupuestoTotal: number;
  readonly periodoDias: number;
  readonly startAt: string | null;
  readonly endAt: string | null;
  readonly moneda?: string;
  readonly canalesSolicitados: readonly CanalId[];
  readonly disponibilidad: readonly ChannelAvailability[];
  readonly evidencia: EntradaEstrategia;
  readonly readiness?: MarketingReadiness | null;
  readonly historicalCpa?: number | null;
  readonly config?: { readonly experimentFraction?: number; readonly prudentSpendFraction?: number; readonly minExperimentBudget?: number };
}

const N: Record<Nivel, number> = { LOW: 1, MEDIUM: 2, HIGH: 3 };
const fmt = (moneda: string, n: number): string => `${moneda} ${Math.round(n)}`;
const REQUIRED_TRACKING = ['Evento de contacto (lead_created) verificado y disparándose antes de invertir.', 'Atribución del contacto a la campaña/canal de origen (utm/gclid).'];

// ── QUALITY GATE de copy RSA ────────────────────────────────────────────────
// Prohíbe truncar mecánicamente: un headline nunca puede terminar en conjunción/preposición/coma ni quedar
// sintácticamente incompleto. Se PREFIERE una reformulación corta (cláusula líder completa) antes que cortar.
const PALABRAS_COLGANTES = new Set(['y', 'e', 'o', 'u', 'de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'con', 'para', 'por', 'en', 'a', 'al', 'que', 'sin', 'su', 'tu', 'más', 'ademas', 'además', 'como', 'segun', 'según']);

/** ¿Es una frase COMPLETA y publicable? (no vacía, sin placeholder, ≥2 palabras, sin coma/colgante final). */
export function esFraseCompleta(s: string): boolean {
  const t = (s ?? '').trim();
  if (!t || /PENDING/i.test(t)) return false;
  if (/[,;:·\-–]$/.test(t)) return false;
  const words = t.split(/\s+/);
  if (words.length < 2) return false;
  const last = words[words.length - 1]!.toLowerCase().replace(/[.,;:!?]+$/, '');
  return !PALABRAS_COLGANTES.has(last);
}

/** Devuelve la capability o una CLÁUSULA LÍDER completa que quepa en ≤max; null si no se logra sin truncar. */
function fraseCortaCompleta(texto: string, max: number): string | null {
  const t = (texto ?? '').trim();
  if (!t) return null;
  if (t.length <= max && esFraseCompleta(t)) return t;
  const seps = [' y ', ' e ', ', ', ' con ', ' para ', ' que ', ' además ', '; ', ' — ', ' – ', ' de ', ' en '];
  let best: string | null = null;
  const low = t.toLowerCase();
  for (const sep of seps) {
    const idx = low.indexOf(sep);
    if (idx > 0) {
      const head = t.slice(0, idx).trim();
      // Se rechazan fragmentos de lista (coma interna): preferimos una cláusula limpia y completa.
      if (head.length <= max && !head.includes(',') && esFraseCompleta(head) && (!best || head.length > best.length)) best = head;
    }
  }
  return best;
}

/** Valida un anuncio ya compuesto: headlines ≤30 completos, descriptions ≤90 completas, sin placeholder.
 *  El nombre de MARCA (1 palabra, nombre propio) es un headline válido y queda EXENTO de la regla de ≥2 palabras. */
export function validarCopyAnuncio(ad: AdDraft, brand?: string): string[] {
  const issues: string[] = [];
  const marca = brand?.trim().toLowerCase();
  ad.headlines.forEach((h) => { if (marca && h.trim().toLowerCase() === marca) { if (h.length > 30) issues.push(`headline >30: "${h}"`); return; } if (/PENDING/i.test(h)) issues.push(`headline placeholder: "${h}"`); else if (h.length > 30) issues.push(`headline >30: "${h}"`); else if (!esFraseCompleta(h)) issues.push(`headline incompleto: "${h}"`); });
  ad.descriptions.forEach((d) => { if (/PENDING/i.test(d)) issues.push(`description placeholder: "${d}"`); else if (d.length > 90) issues.push(`description >90: "${d}"`); else if (!esFraseCompleta(d)) issues.push(`description incompleta: "${d}"`); });
  if (ad.headlines.filter((h) => !/PENDING/i.test(h)).length < 3) issues.push('menos de 3 headlines válidos');
  if (ad.descriptions.filter((d) => !/PENDING/i.test(d)).length < 2) issues.push('menos de 2 descriptions válidas');
  return issues;
}

function disp(canal: CanalId, ds: readonly ChannelAvailability[]): ChannelAvailability {
  return ds.find((d) => d.canal === canal) ?? { canal, canPlan: false, canExecute: false, executionGate: 'PROVIDER_NOT_CONNECTED' };
}

function stopRules(cap: number, moneda: string, endAt: string | null, maxSin: number, targetCpa: TargetCpa): StopRule[] {
  return [
    { id: 'STOP_BUDGET', tipo: 'BUDGET', enabled: true, threshold: cap, descripcion: `Detener al alcanzar el presupuesto total autorizado (${fmt(moneda, cap)}).` },
    { id: 'STOP_ZERO_CONVERSION', tipo: 'ZERO_CONVERSION', enabled: true, threshold: maxSin, descripcion: `Detener si el gasto alcanza ${fmt(moneda, maxSin)} sin ningún contacto real.` },
    targetCpa.kind === 'VALUE'
      ? { id: 'STOP_CPA', tipo: 'CPA', enabled: true, threshold: targetCpa.value, descripcion: `Detener si el costo por contacto supera ${fmt(moneda, targetCpa.value)}.` }
      : { id: 'STOP_CPA', tipo: 'CPA', enabled: false, reason: 'INSUFFICIENT_EVIDENCE', descripcion: 'Sin CPA histórico defendible ⇒ regla de CPA deshabilitada (rige el guardrail de gasto sin contacto).' },
    { id: 'STOP_TRACKING', tipo: 'TRACKING', enabled: true, condition: 'FAIL', descripcion: 'Detener si la medición (tracking de contactos) deja de ser válida.' },
    { id: 'STOP_LANDING', tipo: 'LANDING', enabled: true, condition: 'UNAVAILABLE', descripcion: 'Detener si la landing queda inaccesible o rota.' },
    { id: 'STOP_PERIOD', tipo: 'PERIOD', enabled: true, date: endAt, descripcion: 'Detener al terminar el período autorizado.' },
  ];
}

function seleccionarHipotesis(readiness: MarketingReadiness | null, signals: readonly IntentSignal[]): { selected: Hypothesis | null; backlog: Hypothesis[] } {
  const landingOk = readiness?.landing.status === 'PASS';
  const trackingOk = readiness?.firstPartyTracking.status === 'PASS';
  const mobileOk = readiness?.mobile.status === 'PASS';
  const noComprador = signals.filter((s) => ['CLINICAL_TECH_SOFTWARE', 'PATIENT_INTENT', 'EDUCATIONAL', 'UNKNOWN', 'COMPETITOR_NAVIGATIONAL', 'COMPETITOR_EDUCATIONAL_OR_INSTITUTIONAL', 'COMPETITOR_UNKNOWN'].includes(s.category)).reduce((a, s) => a + s.shareImpresiones, 0);
  const hayCompetidorOGestion = signals.some((s) => s.category === 'COMPETITOR_BUYER_INTENT' || s.category === 'CLINIC_MANAGEMENT_INTENT');
  const targetingStrength: Nivel = noComprador >= 0.2 || hayCompetidorOGestion ? 'HIGH' : signals.length > 0 ? 'MEDIUM' : 'LOW';

  const cand: Omit<Hypothesis, 'score'>[] = [
    { id: 'HYP_TARGETING_INTENT', category: 'TARGETING_INTENT', statement: 'El tráfico mezcla intención no-compradora (software clínico/técnico, pacientes, genéricos): acotar targeting/keywords a intención de compra de software de GESTIÓN de clínica.', evidenceStrength: targetingStrength, potentialImpact: 'HIGH', testCost: 'LOW', reversibility: 'HIGH', measurability: 'HIGH' },
    { id: 'HYP_MESSAGE', category: 'MESSAGE', statement: 'El mensaje del anuncio no coincide con lo que busca el comprador.', evidenceStrength: landingOk ? 'LOW' : 'MEDIUM', potentialImpact: 'MEDIUM', testCost: 'LOW', reversibility: 'HIGH', measurability: 'MEDIUM' },
    { id: 'HYP_DESTINATION', category: 'DESTINATION', statement: 'El destino (landing) es demasiado genérico para la intención de la búsqueda.', evidenceStrength: landingOk ? 'LOW' : 'MEDIUM', potentialImpact: 'MEDIUM', testCost: 'MEDIUM', reversibility: 'MEDIUM', measurability: 'MEDIUM' },
    { id: 'HYP_FRICTION', category: 'FRICTION', statement: 'Hay fricción en el formulario/CTA que impide convertir el clic en contacto.', evidenceStrength: (landingOk && trackingOk) ? 'LOW' : 'MEDIUM', potentialImpact: 'MEDIUM', testCost: 'LOW', reversibility: 'HIGH', measurability: 'HIGH' },
    { id: 'HYP_SOCIAL_PROOF', category: 'SOCIAL_PROOF', statement: 'Falta prueba social suficiente para generar confianza.', evidenceStrength: 'LOW', potentialImpact: 'MEDIUM', testCost: 'MEDIUM', reversibility: 'HIGH', measurability: 'MEDIUM' },
    { id: 'HYP_MOBILE', category: 'MOBILE', statement: 'La experiencia móvil impide completar el contacto.', evidenceStrength: mobileOk ? 'LOW' : 'MEDIUM', potentialImpact: 'MEDIUM', testCost: 'LOW', reversibility: 'HIGH', measurability: 'HIGH' },
  ];
  const scored: Hypothesis[] = cand.map((c) => ({ ...c, score: N[c.evidenceStrength] * 3 + N[c.potentialImpact] * 2 + (4 - N[c.testCost]) + N[c.reversibility] + N[c.measurability] })).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return { selected: scored[0] ?? null, backlog: scored.slice(1) };
}

/** Política determinista por categoría: acción + matchType. Opera la evidencia (no "pagar por descubrir"). */
const POLITICA: Record<IntentCategory, { action: KeywordAction; matchType: MatchType | null; reason: string }> = {
  CLINIC_MANAGEMENT_INTENT: { action: 'TARGET', matchType: 'PHRASE', reason: 'Intención de compra de software de gestión de clínica: keyword activa (grupo core).' },
  COMPETITOR_BUYER_INTENT: { action: 'SEGMENT', matchType: 'EXACT', reason: 'Comprador comparando software de gestión (precio/planes/demo/alternativa): grupo SEPARADO, EXACT, riesgo acotado.' },
  COMPETITOR_NAVIGATIONAL: { action: 'OBSERVE_NO_SPEND', matchType: null, reason: 'Consulta navegacional del competidor (login/ingreso/acceso): usuario existente, no comprador. Sin gasto.' },
  COMPETITOR_EDUCATIONAL_OR_INSTITUTIONAL: { action: 'OBSERVE_NO_SPEND', matchType: null, reason: 'Consulta institucional/educativa del competidor: no comprador comercial. Sin gasto.' },
  COMPETITOR_UNKNOWN: { action: 'OBSERVE_NO_SPEND', matchType: null, reason: 'Marca de competidor sin señal de intención: NO se paga por descubrir. Observar como evidencia.' },
  CLINICAL_TECH_SOFTWARE: { action: 'EXCLUDE', matchType: 'PHRASE', reason: 'Software clínico/técnico (alineadores/imaging/CAD/ortodoncia): NO compra gestión. Excluir.' },
  PATIENT_INTENT: { action: 'EXCLUDE', matchType: 'PHRASE', reason: 'Intención de paciente: audiencia equivocada para software. Excluir.' },
  EDUCATIONAL: { action: 'OBSERVE_NO_SPEND', matchType: null, reason: 'Intención informativa/educativa: no comprador. Mantener como evidencia, sin gasto.' },
  UNKNOWN: { action: 'OBSERVE_NO_SPEND', matchType: null, reason: 'Intención no clasificable (genérico ambiguo): NO se paga por descubrir. Observar como evidencia.' },
};

/**
 * Compone un RSA SIN truncar: cada headline es una frase completa ≤30 (la capability entera o su cláusula
 * líder), derivada SÓLO de valueProps verificadas + el nombre de marca. Las value props cortas/comerciales
 * compiten por reglas generales (completitud, longitud, diversidad), no por hardcode. El grupo de competidor
 * agrega una variante de EVALUACIÓN de la propia marca (sin afirmar nada del competidor). Si no hay material
 * suficiente para 3 headlines / 2 descriptions completas ⇒ marca PENDING_COPY (⇒ draft INCOMPLETE).
 */
function componerAnuncio(valueProps: readonly ValueProp[], brand: string | undefined, grupo: 'TARGET' | 'SEGMENT'): AdDraft {
  const caps = valueProps.map((v) => v.capability).filter((c) => c && c.trim());
  const headlines: string[] = [];
  const agregar = (s: string | null | undefined, arr: string[], max: number): void => {
    if (!s) return; const n = s.trim();
    if (n.length <= max && esFraseCompleta(n) && !arr.some((x) => x.toLowerCase() === n.toLowerCase())) arr.push(n);
  };
  const marca = brand?.trim();
  // 1) Marca (headline válido de 1 palabra permitido por ser nombre propio).
  if (marca && marca.length <= 30 && !/PENDING/i.test(marca) && !arr1Colgante(marca)) headlines.push(marca);
  // 2) Variante de evaluación SÓLO en el grupo de competidor-comprador (invita a probar la PROPIA marca; sin claims del competidor).
  if (grupo === 'SEGMENT' && marca) { agregar(`Evalúa ${marca}`, headlines, 30); agregar(`Compara y prueba ${marca}`, headlines, 30); }
  // 3) Capabilities como frases completas ≤30 (cláusula líder si hace falta). Diversidad por dedupe.
  for (const c of caps) { if (headlines.length >= 12) break; agregar(fraseCortaCompleta(c, 30), headlines, 30); }

  const descriptions: string[] = [];
  for (const c of caps) { if (descriptions.length >= 4) break; agregar(fraseCortaCompleta(c, 90), descriptions, 90); }

  // Mínimos RSA. Si no se alcanzan con material completo, PENDING_COPY ⇒ INCOMPLETE (no se fabrica ni se trunca).
  if (headlines.length < 3) headlines.push('PENDING_COPY');
  if (descriptions.length < 2) descriptions.push('PENDING_COPY');
  return { headlines, descriptions };
}
/** La marca puede ser 1 palabra (nombre propio); sólo se rechaza si termina en colgante. */
function arr1Colgante(s: string): boolean {
  const last = s.trim().split(/\s+/).slice(-1)[0]!.toLowerCase().replace(/[.,;:!?]+$/, '');
  return PALABRAS_COLGANTES.has(last);
}

function elegirDestino(intentPreferido: string, destinos: readonly ValidatedDestination[]): { finalDestination: string; rationale: string } {
  const validos = destinos.filter((d) => d.validated && d.public && d.available);
  const match = validos.find((d) => d.intent === intentPreferido) ?? validos[0];
  if (!match) return { finalDestination: 'PENDING_DESTINATION', rationale: 'No hay destino validado disponible en la readiness.' };
  return { finalDestination: match.url, rationale: `Destino validado (${match.intent}) alineado a la intención del grupo.` };
}

export function construirMarketingPlan(e: EntradaMarketingPlan): MarketingPlan {
  const moneda = e.moneda ?? 'CLP';
  const cap = Math.max(0, e.presupuestoTotal);
  const canales = [...e.canalesSolicitados];
  const clasificados: ClassifiedTerm[] = clasificarTerminos(e.evidencia.terminos ?? []);
  const signals = agregarSenales(clasificados);
  const estrategia = evaluarEstrategiaDirector(e.evidencia);
  const readinessEval = evaluarReadiness(e.readiness ?? null);

  const planningAvail = canales.map((c) => ({ canal: c, canPlan: disp(c, e.disponibilidad).canPlan }));
  const executionAvail = canales.map((c) => { const d = disp(c, e.disponibilidad); return { canal: c, canExecute: d.canExecute, executionGate: d.executionGate }; });
  const algunoEjecuta = executionAvail.some((x) => x.canExecute);
  const algunGate = executionAvail.find((x) => !x.canExecute && x.executionGate !== 'READY');
  const executionStatus: ExecutionStatus = algunoEjecuta ? 'READY' : algunGate ? 'EXTERNAL_GATE_BLOCKED' : 'AUTONOMY_OFF';

  const diagnosisRequired = (estrategia.funnelZeroConversion && !readinessEval.diagnosisCompleted) || readinessEval.hardFunnelBlocker;

  const vacio = (status: CampaignDraftStatus, issues: string[]): CampaignCompleteness => ({ status, pendingCopyCount: 0, pendingDestination: false, unknownActiveKeywords: 0, issues });

  if (diagnosisRequired) {
    const mix: AsignacionCanal[] = canales.map((c) => ({ canal: c, disponible: disp(c, e.disponibilidad).canPlan, presupuesto: 0, motivo: 'Diagnóstico del funnel requerido antes de autorizar gasto.' }));
    return {
      objective: e.objetivo, totalAuthorizedBudget: cap, currency: moneda, period: { dias: e.periodoDias, startAt: e.startAt, endAt: e.endAt },
      strategyStatus: 'DIAGNOSIS_REQUIRED', campaignDraftStatus: 'INCOMPLETE', executionStatus, campaignCompleteness: vacio('INCOMPLETE', ['Diagnóstico requerido: aún no hay campaña.']),
      channelPlanningAvailability: planningAvail, channelExecutionAvailability: executionAvail, channelsConsidered: canales, recommendedChannelMix: mix,
      totalSpendRecommended: 0, spendRecommendation: `0 ${moneda} UNTIL DIAGNOSIS`, auditFunnel: 'REQUIRED',
      selectedHypothesis: null, backlogHypotheses: [], keywordDecisions: [], activeKeywords: [], observeNoSpendKeywords: [],
      maxSpendWithoutContact: { value: 0, rationale: 'Diagnóstico pendiente: no se autoriza gasto.' },
      targetCpa: { kind: 'UNDEFINED_INSUFFICIENT_EVIDENCE', rationale: 'Sin experimento ni CPA histórico.' },
      successCriteria: { minimumRealContacts: 1, maxSpend: 0, measurementWindowDays: e.periodoDias, attributionRequirement: 'contacto first-party atribuible' },
      stopCriteria: stopRules(cap, moneda, e.endAt, 0, { kind: 'UNDEFINED_INSUFFICIENT_EVIDENCE', rationale: 'sin experimento' }), campaigns: [],
      reasoning: { facts: estrategia.hechos, hypotheses: estrategia.hipotesis }, requiredTracking: [...REQUIRED_TRACKING],
      landingIssues: readinessEval.hardFunnelBlocker ? [`Bloqueador duro del funnel: ${readinessEval.bloqueadores.join(', ')}.`] : ['Registrar el resultado del diagnóstico antes de crear campañas.'],
      risks: ['Invertir sin diagnóstico repetiría el patrón de gasto con 0 contactos.'], readinessSummary: readinessEval.resumen,
    };
  }

  // ── EXPERIMENTO / CAMPAIGN BUILDER ──────────────────────────────────────────
  const experimentFraction = e.config?.experimentFraction ?? 0.5;
  const minExp = e.config?.minExperimentBudget ?? 5000;
  const prudentFraction = e.config?.prudentSpendFraction ?? 0.5;
  const experimentBudget = Math.min(cap, Math.max(Math.min(minExp, cap), Math.round(experimentFraction * cap)));

  const plannables = canales.filter((c) => disp(c, e.disponibilidad).canPlan);
  const porCanal = plannables.length > 0 ? Math.floor(experimentBudget / plannables.length) : 0;
  let asignado = 0;
  const mix: AsignacionCanal[] = canales.map((c) => {
    const d = disp(c, e.disponibilidad); const monto = d.canPlan ? porCanal : 0; asignado += monto;
    return { canal: c, disponible: d.canPlan, presupuesto: monto, motivo: d.canPlan ? `Canal planificable (ejecución: ${d.canExecute ? 'habilitada' : `bloqueada · ${d.executionGate}`}).` : `Canal no disponible para planificar (gate ${d.executionGate}).` };
  });
  const totalSpendRecommended = Math.min(asignado, cap);

  const targetCpa: TargetCpa = e.historicalCpa != null && e.historicalCpa > 0
    ? { kind: 'VALUE', value: Math.round(e.historicalCpa), rationale: 'CPA derivado de evidencia histórica de contactos atribuibles.' }
    : { kind: 'UNDEFINED_INSUFFICIENT_EVIDENCE', rationale: 'No hay contactos históricos suficientes para un CPA defendible; rige el guardrail de gasto sin contacto.' };
  const maxSin = Math.max(1, Math.min(Math.round(prudentFraction * totalSpendRecommended), totalSpendRecommended));
  const maxSpendWithoutContact = { value: maxSin, rationale: `min(${Math.round(prudentFraction * 100)}% del presupuesto del experimento, presupuesto del experimento) = ${fmt(moneda, maxSin)}; sin CPA histórico, es el guardrail de corte.` };

  const { selected, backlog } = seleccionarHipotesis(e.readiness ?? null, signals);
  const hypId = selected?.id ?? 'HYP_NONE';

  // Clasificación operativa por término → keywords activas / observe-no-spend / negativas (matchType explícito).
  const activeKeywords: ActiveKeyword[] = [];
  const observeNoSpend: ObserveKeyword[] = [];
  const negatives: NegativeKeyword[] = [];
  for (const ct of clasificados) {
    const pol = POLITICA[ct.category];
    if (pol.action === 'TARGET' || pol.action === 'SEGMENT') activeKeywords.push({ text: ct.termino, intentClassification: ct.category, confidence: ct.confidence, action: pol.action, matchType: pol.matchType ?? 'PHRASE', rationale: pol.reason });
    else if (pol.action === 'EXCLUDE') negatives.push({ text: ct.termino, matchType: pol.matchType ?? 'PHRASE', rationale: pol.reason });
    else observeNoSpend.push({ text: ct.termino, intentClassification: ct.category, confidence: ct.confidence, reason: pol.reason });
  }
  const keywordDecisions: KeywordDecision[] = signals.map((s) => ({ categoria: s.category, action: POLITICA[s.category].action, matchType: POLITICA[s.category].matchType, reason: POLITICA[s.category].reason, examples: s.examples }));

  const valueProps = e.readiness?.valueProps ?? [];
  const destinos = e.readiness?.validatedDestinations ?? [];
  const brand = e.readiness?.brandName;

  const successCriteria: SuccessCriteria = { minimumRealContacts: 1, maxSpend: totalSpendRecommended, measurementWindowDays: e.periodoDias, attributionRequirement: 'contacto first-party (lead_created) atribuible a la campaña/canal' };
  const stops = stopRules(cap, moneda, e.endAt, maxSin, targetCpa);

  // Grupos ACTIVOS: uno por acción presente (TARGET=gestión core, SEGMENT=competidores acotado). Copy y destino por grupo.
  const grupos: AdGroupDraft[] = [];
  const porAccion: Array<{ action: 'TARGET' | 'SEGMENT'; label: string; intent: IntentCategory; destIntent: string }> = [
    { action: 'TARGET', label: 'Gestión clínica (core)', intent: 'CLINIC_MANAGEMENT_INTENT', destIntent: 'plans' },
    { action: 'SEGMENT', label: 'Competidores · comprador (test acotado)', intent: 'COMPETITOR_BUYER_INTENT', destIntent: 'features' },
  ];
  for (const g of porAccion) {
    const kws = activeKeywords.filter((k) => k.action === g.action);
    if (kws.length === 0) continue;
    const dest = elegirDestino(g.destIntent, destinos);
    grupos.push({ name: g.label, intent: g.intent, action: g.action, keywords: kws, ads: [componerAnuncio(valueProps, brand, g.action)], finalDestination: dest.finalDestination, destinationRationale: dest.rationale });
  }

  const campaigns: CampaignDraft[] = totalSpendRecommended > 0 && grupos.length > 0 ? [{
    channel: 'google', campaignName: `Experimento · ${e.objetivo}`, objective: 'LEADS', campaignType: 'SEARCH', hypothesisId: hypId,
    adGroups: grupos, negativeKeywords: negatives, budget: mix.find((m) => m.canal === 'google')?.presupuesto ?? totalSpendRecommended,
    durationDays: e.periodoDias, trackingRequirements: [...REQUIRED_TRACKING], successCriteria, stopCriteria: stops,
  }] : [];

  // COMPLETITUD del draft (incluye QUALITY GATE de copy: sin placeholder, ≤30/≤90, gramaticalmente completo).
  const allCopy = campaigns.flatMap((c) => c.adGroups.flatMap((g) => g.ads.flatMap((a) => [...a.headlines, ...a.descriptions])));
  const pendingCopyCount = allCopy.filter((h) => /PENDING/i.test(h)).length;
  const copyIssues = campaigns.flatMap((c) => c.adGroups.flatMap((g) => g.ads.flatMap((a) => validarCopyAnuncio(a, brand))));
  const pendingDestination = campaigns.some((c) => c.adGroups.some((g) => g.finalDestination === 'PENDING_DESTINATION'));
  const unknownActive = activeKeywords.filter((k) => k.intentClassification === 'UNKNOWN').length;
  const activasCompletas = activeKeywords.every((k) => k.text && k.intentClassification && k.confidence && k.action && k.matchType && k.rationale);
  const negativasCompletas = negatives.every((n) => n.text && n.matchType && n.rationale);
  const issues: string[] = [];
  if (campaigns.length === 0) issues.push('No se generó ninguna campaña (sin keywords activas defendibles).');
  if (pendingCopyCount > 0) issues.push(`Copy incompleto: ${pendingCopyCount} placeholder(s). Falta cargar capacidades reales (valueProps) en la readiness.`);
  if (copyIssues.length > 0) issues.push(`Copy no publicable: ${copyIssues.slice(0, 3).join(' · ')}${copyIssues.length > 3 ? '…' : ''}`);
  if (pendingDestination) issues.push('Destino sin validar: cargar destinos validados en la readiness.');
  if (!activasCompletas) issues.push('Alguna keyword activa no está completamente tipada.');
  if (!negativasCompletas) issues.push('Alguna negativa no declara matchType/rationale.');
  if (unknownActive > 0) issues.push(`${unknownActive} keyword(s) UNKNOWN activadas (no debería recibir gasto).`);
  const campaignDraftStatus: CampaignDraftStatus = issues.length === 0 && activeKeywords.length > 0 ? 'READY_FOR_APPROVAL' : 'INCOMPLETE';
  const campaignCompleteness: CampaignCompleteness = { status: campaignDraftStatus, pendingCopyCount, pendingDestination, unknownActiveKeywords: unknownActive, issues };

  return {
    objective: e.objetivo, totalAuthorizedBudget: cap, currency: moneda, period: { dias: e.periodoDias, startAt: e.startAt, endAt: e.endAt },
    strategyStatus: 'READY', campaignDraftStatus, executionStatus, campaignCompleteness,
    channelPlanningAvailability: planningAvail, channelExecutionAvailability: executionAvail, channelsConsidered: canales, recommendedChannelMix: mix,
    totalSpendRecommended, spendRecommendation: `Primer experimento acotado: asignar ${fmt(moneda, totalSpendRecommended)} de ${fmt(moneda, cap)} (reservar el resto para iterar). Aprobación humana requerida.`,
    auditFunnel: 'NOT_REQUIRED', selectedHypothesis: selected, backlogHypotheses: backlog, keywordDecisions, activeKeywords, observeNoSpendKeywords: observeNoSpend,
    maxSpendWithoutContact, targetCpa, successCriteria, stopCriteria: stops, campaigns,
    reasoning: { facts: [...estrategia.hechos, ...(e.readiness?.findings ?? [])], hypotheses: [selected ? `Hipótesis primaria: ${selected.statement}` : 'Sin hipótesis', ...backlog.slice(0, 3).map((h) => `Backlog: ${h.category}`)] },
    requiredTracking: [...REQUIRED_TRACKING], landingIssues: [], risks: totalSpendRecommended === 0 ? ['Ningún canal planificable con presupuesto.'] : [], readinessSummary: readinessEval.resumen,
  };
}
