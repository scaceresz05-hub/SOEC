/**
 * apps/api · campana · MARKETING PLAN / STRATEGY PLANNER (PURO, sin I/O).
 *
 * Transición DIAGNÓSTICO → PLAN OPERABLE. A partir de: objetivo + presupuesto TOTAL humano + período +
 * evidencia (métricas, términos, señales de intención) + READINESS del diagnóstico + disponibilidad por canal
 * (planificación vs ejecución), produce un plan estructurado y operable, SIN ejecutar nada.
 *
 * SOBERANÍA:
 *  - Si el diagnóstico NO está resuelto (gasto real con 0 contactos y sin readiness) ⇒ DIAGNOSIS_REQUIRED.
 *  - Si el diagnóstico está resuelto y sin bloqueador duro ⇒ selecciona UNA hipótesis primaria y genera un
 *    experimento con draft de campaña, keywords/negativas, presupuesto acotado y guardrails NUMÉRICOS.
 *  - PLAN ≠ EJECUCIÓN: se puede tener PLAN listo con EJECUCIÓN bloqueada por un gate externo del proveedor.
 *  - Nunca excede el tope humano. No inventa TARGET_CPA sin evidencia. No hardcodea ninguna organización.
 */
import { evaluarEstrategiaDirector, type EntradaEstrategia } from '../autonomia-ads/estrategia-director';
import { evaluarReadiness, type MarketingReadiness } from './diagnosis-evidence';
import type { ChannelAvailability } from './channel-availability';
import type { IntentSignal, IntentCategory } from './intent-classifier';

export type CanalId = 'google' | 'meta';
export type MatchType = 'EXACT' | 'PHRASE' | 'BROAD';
export type KeywordAction = 'TARGET' | 'SEGMENT' | 'EXCLUDE' | 'OBSERVE';
export type PlanStatus = 'DIAGNOSIS_REQUIRED' | 'READY_FOR_APPROVAL';
export type ExecutionStatus = 'READY' | 'EXTERNAL_GATE_BLOCKED' | 'AUTONOMY_OFF';
type Nivel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface StopRule {
  readonly id: string;
  readonly tipo: 'BUDGET' | 'ZERO_CONVERSION' | 'CPA' | 'TRACKING' | 'LANDING' | 'PERIOD';
  readonly descripcion: string;
  readonly enabled: boolean;
  readonly threshold?: number | null; // CLP (BUDGET/ZERO_CONVERSION/CPA)
  readonly date?: string | null;      // PERIOD
  readonly condition?: string;        // TRACKING/LANDING
  readonly reason?: string;           // p.ej. INSUFFICIENT_EVIDENCE cuando enabled=false
}

export interface Hypothesis {
  readonly id: string;
  readonly category: string;
  readonly statement: string;
  readonly evidenceStrength: Nivel;
  readonly potentialImpact: Nivel;
  readonly testCost: Nivel;
  readonly reversibility: Nivel;
  readonly measurability: Nivel;
  readonly score: number;
}

export interface KeywordEntry { readonly text: string; readonly matchType: MatchType; readonly rationale: string }
export interface NegativeKeyword { readonly text: string; readonly rationale: string }
export interface KeywordDecision { readonly categoria: IntentCategory; readonly action: KeywordAction; readonly reason: string; readonly examples: readonly string[] }
export interface AdDraft { readonly headlines: readonly string[]; readonly descriptions: readonly string[] }
export interface AdGroupDraft { readonly name: string; readonly intent: string; readonly keywords: readonly KeywordEntry[] }

export interface SuccessCriteria {
  readonly minimumRealContacts: number;
  readonly maxSpend: number;
  readonly measurementWindowDays: number;
  readonly attributionRequirement: string;
}

export type TargetCpa =
  | { readonly kind: 'VALUE'; readonly value: number; readonly rationale: string }
  | { readonly kind: 'UNDEFINED_INSUFFICIENT_EVIDENCE'; readonly rationale: string };

export interface CampaignDraft {
  readonly channel: CanalId;
  readonly campaignName: string;
  readonly objective: string;
  readonly campaignType: string;
  readonly hypothesisId: string;
  readonly adGroups: readonly AdGroupDraft[];
  readonly negativeKeywords: readonly NegativeKeyword[];
  readonly ads: readonly AdDraft[];
  readonly finalDestination: string;
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
  readonly planStatus: PlanStatus;
  readonly executionStatus: ExecutionStatus;
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
  readonly intentSignals?: readonly IntentSignal[];
  readonly landingUrl?: string;
  /** CPA histórico defendible; null/undefined ⇒ no inventar TARGET_CPA. */
  readonly historicalCpa?: number | null;
  readonly config?: { readonly experimentFraction?: number; readonly prudentSpendFraction?: number; readonly minExperimentBudget?: number };
}

const N: Record<Nivel, number> = { LOW: 1, MEDIUM: 2, HIGH: 3 };
const fmt = (moneda: string, n: number): string => `${moneda} ${Math.round(n)}`;

const REQUIRED_TRACKING = [
  'Evento de contacto (lead_created) verificado y disparándose antes de invertir.',
  'Atribución del contacto a la campaña/canal de origen (utm/gclid).',
];

function disponibilidadPorCanal(canal: CanalId, disp: readonly ChannelAvailability[]): ChannelAvailability {
  return disp.find((d) => d.canal === canal) ?? { canal, canPlan: false, canExecute: false, executionGate: 'PROVIDER_NOT_CONNECTED' };
}

function stopRules(cap: number, moneda: string, endAt: string | null, maxSinContacto: number, targetCpa: TargetCpa): StopRule[] {
  return [
    { id: 'STOP_BUDGET', tipo: 'BUDGET', enabled: true, threshold: cap, descripcion: `Detener al alcanzar el presupuesto total autorizado (${fmt(moneda, cap)}).` },
    { id: 'STOP_ZERO_CONVERSION', tipo: 'ZERO_CONVERSION', enabled: true, threshold: maxSinContacto, descripcion: `Detener si el gasto alcanza ${fmt(moneda, maxSinContacto)} sin ningún contacto real.` },
    targetCpa.kind === 'VALUE'
      ? { id: 'STOP_CPA', tipo: 'CPA', enabled: true, threshold: targetCpa.value, descripcion: `Detener si el costo por contacto supera ${fmt(moneda, targetCpa.value)}.` }
      : { id: 'STOP_CPA', tipo: 'CPA', enabled: false, reason: 'INSUFFICIENT_EVIDENCE', descripcion: 'Sin CPA histórico defendible ⇒ regla de CPA deshabilitada (se usa el guardrail de gasto sin contacto).' },
    { id: 'STOP_TRACKING', tipo: 'TRACKING', enabled: true, condition: 'FAIL', descripcion: 'Detener si la medición (tracking de contactos) deja de ser válida.' },
    { id: 'STOP_LANDING', tipo: 'LANDING', enabled: true, condition: 'UNAVAILABLE', descripcion: 'Detener si la landing queda inaccesible o rota.' },
    { id: 'STOP_PERIOD', tipo: 'PERIOD', enabled: true, date: endAt, descripcion: 'Detener al terminar el período autorizado.' },
  ];
}

/** Genera y prioriza hipótesis a partir de la readiness (qué se verificó OK) + señales de intención. */
function seleccionarHipotesis(readiness: MarketingReadiness | null, signals: readonly IntentSignal[]): { selected: Hypothesis | null; backlog: Hypothesis[] } {
  const landingOk = readiness?.landing.status === 'PASS';
  const trackingOk = readiness?.firstPartyTracking.status === 'PASS';
  const mobileOk = readiness?.mobile.status === 'PASS';
  // Señal de desalineación de intención: participación de tráfico NO comprador (herramientas/pacientes/desconocido)
  // + presencia de competidores/genéricos. Fuerte cuando el tráfico no-comprador es material.
  const noComprador = signals.filter((s) => s.category === 'DENTAL_TOOL' || s.category === 'LOCAL_SERVICE' || s.category === 'UNKNOWN').reduce((a, s) => a + s.shareImpresiones, 0);
  const hayCompetidorOGenerico = signals.some((s) => s.category === 'COMPETITOR_MANAGEMENT' || s.category === 'GENERIC_SOFTWARE');
  const targetingStrength: Nivel = noComprador >= 0.2 || hayCompetidorOGenerico ? 'HIGH' : signals.length > 0 ? 'MEDIUM' : 'LOW';

  const candidatos: Omit<Hypothesis, 'score'>[] = [
    {
      id: 'HYP_TARGETING_INTENT', category: 'TARGETING_INTENT',
      statement: 'El tráfico incluye intención no-compradora (herramientas técnicas, pacientes, genéricos): acotar targeting/keywords hacia intención de compra de software de gestión.',
      evidenceStrength: targetingStrength, potentialImpact: 'HIGH', testCost: 'LOW', reversibility: 'HIGH', measurability: 'HIGH',
    },
    {
      id: 'HYP_MESSAGE', category: 'MESSAGE',
      statement: 'El mensaje del anuncio no coincide con lo que busca el comprador.',
      evidenceStrength: landingOk ? 'LOW' : 'MEDIUM', potentialImpact: 'MEDIUM', testCost: 'LOW', reversibility: 'HIGH', measurability: 'MEDIUM',
    },
    {
      id: 'HYP_DESTINATION', category: 'DESTINATION',
      statement: 'El destino (landing) es demasiado genérico para la intención de la búsqueda.',
      evidenceStrength: landingOk ? 'LOW' : 'MEDIUM', potentialImpact: 'MEDIUM', testCost: 'MEDIUM', reversibility: 'MEDIUM', measurability: 'MEDIUM',
    },
    {
      id: 'HYP_FRICTION', category: 'FRICTION',
      statement: 'Hay fricción en el formulario/CTA que impide convertir el clic en contacto.',
      evidenceStrength: (landingOk && trackingOk) ? 'LOW' : 'MEDIUM', potentialImpact: 'MEDIUM', testCost: 'LOW', reversibility: 'HIGH', measurability: 'HIGH',
    },
    {
      id: 'HYP_SOCIAL_PROOF', category: 'SOCIAL_PROOF',
      statement: 'Falta prueba social suficiente para generar confianza en la decisión.',
      evidenceStrength: 'LOW', potentialImpact: 'MEDIUM', testCost: 'MEDIUM', reversibility: 'HIGH', measurability: 'MEDIUM',
    },
    {
      id: 'HYP_MOBILE', category: 'MOBILE',
      statement: 'La experiencia móvil impide completar el contacto.',
      evidenceStrength: mobileOk ? 'LOW' : 'MEDIUM', potentialImpact: 'MEDIUM', testCost: 'LOW', reversibility: 'HIGH', measurability: 'HIGH',
    },
  ];

  const conScore: Hypothesis[] = candidatos
    .map((c) => ({ ...c, score: N[c.evidenceStrength] * 3 + N[c.potentialImpact] * 2 + (4 - N[c.testCost]) + N[c.reversibility] + N[c.measurability] }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  return { selected: conScore[0] ?? null, backlog: conScore.slice(1) };
}

/** Política determinista por categoría de intención (opera la evidencia; no asume que todo competidor se targetea). */
function decidirKeywords(signals: readonly IntentSignal[]): KeywordDecision[] {
  const POLITICA: Record<IntentCategory, { action: KeywordAction; reason: string }> = {
    GENERIC_SOFTWARE: { action: 'SEGMENT', reason: 'Intención de software amplia: segmentar en su propio grupo con match acotado y medir antes de escalar.' },
    COMPETITOR_MANAGEMENT: { action: 'OBSERVE', reason: 'Posible comprador comparando software de gestión: observar con match exacto y bajo presupuesto antes de decidir escalar.' },
    DENTAL_TOOL: { action: 'EXCLUDE', reason: 'Herramientas técnicas (CAD/CAM/diagnóstico): no compran gestión clínica. Excluir (deriva histórica confirmada).' },
    LOCAL_SERVICE: { action: 'EXCLUDE', reason: 'Intención de paciente buscando atención: audiencia equivocada para software. Excluir.' },
    IRRELEVANT_DRIFT: { action: 'EXCLUDE', reason: 'Tráfico fuera de intención. Excluir.' },
    UNKNOWN: { action: 'OBSERVE', reason: 'Intención no clasificable con la evidencia actual: observar, sin gastar en escala.' },
  };
  return signals.map((s) => ({ categoria: s.category, action: POLITICA[s.category].action, reason: POLITICA[s.category].reason, examples: s.examples }));
}

function draftGoogle(e: EntradaMarketingPlan, budget: number, hyp: Hypothesis, decisiones: readonly KeywordDecision[], success: SuccessCriteria, stops: readonly StopRule[]): CampaignDraft {
  const matchDe = (a: KeywordAction): MatchType => (a === 'OBSERVE' ? 'EXACT' : a === 'SEGMENT' ? 'PHRASE' : 'PHRASE');
  const adGroups: AdGroupDraft[] = decisiones
    .filter((d) => d.action === 'TARGET' || d.action === 'SEGMENT' || d.action === 'OBSERVE')
    .map((d) => ({
      name: `${d.categoria} · ${d.action}`,
      intent: d.categoria,
      keywords: d.examples.map((text) => ({ text, matchType: matchDe(d.action), rationale: d.reason })),
    }));
  const negativeKeywords: NegativeKeyword[] = decisiones
    .filter((d) => d.action === 'EXCLUDE')
    .flatMap((d) => d.examples.map((text) => ({ text, rationale: d.reason })));

  return {
    channel: 'google',
    campaignName: `Experimento · ${e.objetivo}`,
    objective: 'LEADS',
    campaignType: 'SEARCH',
    hypothesisId: hyp.id,
    adGroups: adGroups.length > 0 ? adGroups : [{ name: 'Intención de compra (a definir)', intent: 'PENDING', keywords: [] }],
    negativeKeywords,
    ads: [{
      headlines: [`Software dental para tu clínica`, `Agenda y recordatorios automáticos`, `PENDING_COPY — probar variante del mensaje`],
      descriptions: [`Prueba orientada a la hipótesis: ${hyp.category}. Copy a validar con el experimento.`, 'PENDING_COPY'],
    }],
    finalDestination: e.landingUrl ?? 'PENDING_DESTINATION',
    budget,
    durationDays: e.periodoDias,
    trackingRequirements: REQUIRED_TRACKING,
    successCriteria: success,
    stopCriteria: stops,
  };
}

export function construirMarketingPlan(e: EntradaMarketingPlan): MarketingPlan {
  const moneda = e.moneda ?? 'CLP';
  const cap = Math.max(0, e.presupuestoTotal);
  const canales = [...e.canalesSolicitados];
  const signals = e.intentSignals ?? [];
  const estrategia = evaluarEstrategiaDirector(e.evidencia);
  const readinessEval = evaluarReadiness(e.readiness ?? null);

  const planningAvail = canales.map((c) => ({ canal: c, canPlan: disponibilidadPorCanal(c, e.disponibilidad).canPlan }));
  const executionAvail = canales.map((c) => { const d = disponibilidadPorCanal(c, e.disponibilidad); return { canal: c, canExecute: d.canExecute, executionGate: d.executionGate }; });
  const algunoEjecuta = executionAvail.some((x) => x.canExecute);
  const algunGate = executionAvail.find((x) => !x.canExecute && x.executionGate !== 'READY');
  const executionStatus: ExecutionStatus = algunoEjecuta ? 'READY' : algunGate ? 'EXTERNAL_GATE_BLOCKED' : 'AUTONOMY_OFF';

  // ¿Sigue requerido el diagnóstico? Sólo si hay señal de cero-conversión sin diagnóstico resuelto, o si el
  // diagnóstico resuelto reveló un bloqueador DURO del funnel (hay que remediar antes de invertir).
  const diagnosisRequired = (estrategia.funnelZeroConversion && !readinessEval.diagnosisCompleted) || readinessEval.hardFunnelBlocker;

  const requiredTracking = [...REQUIRED_TRACKING];

  if (diagnosisRequired) {
    const mix: AsignacionCanal[] = canales.map((c) => ({ canal: c, disponible: disponibilidadPorCanal(c, e.disponibilidad).canPlan, presupuesto: 0, motivo: 'Diagnóstico del funnel requerido antes de autorizar gasto.' }));
    const maxSin = 0;
    return {
      objective: e.objetivo, totalAuthorizedBudget: cap, currency: moneda,
      period: { dias: e.periodoDias, startAt: e.startAt, endAt: e.endAt },
      planStatus: 'DIAGNOSIS_REQUIRED', executionStatus,
      channelPlanningAvailability: planningAvail, channelExecutionAvailability: executionAvail,
      channelsConsidered: canales, recommendedChannelMix: mix,
      totalSpendRecommended: 0, spendRecommendation: `0 ${moneda} UNTIL DIAGNOSIS`, auditFunnel: 'REQUIRED',
      selectedHypothesis: null, backlogHypotheses: [], keywordDecisions: [],
      maxSpendWithoutContact: { value: maxSin, rationale: 'Diagnóstico pendiente: no se autoriza gasto.' },
      targetCpa: { kind: 'UNDEFINED_INSUFFICIENT_EVIDENCE', rationale: 'Sin experimento en curso ni CPA histórico defendible.' },
      successCriteria: { minimumRealContacts: 1, maxSpend: 0, measurementWindowDays: e.periodoDias, attributionRequirement: 'contacto first-party atribuible' },
      stopCriteria: stopRules(cap, moneda, e.endAt, maxSin, { kind: 'UNDEFINED_INSUFFICIENT_EVIDENCE', rationale: 'sin experimento' }),
      campaigns: [],
      reasoning: { facts: estrategia.hechos, hypotheses: estrategia.hipotesis },
      requiredTracking,
      landingIssues: readinessEval.hardFunnelBlocker ? [`Bloqueador duro del funnel: ${readinessEval.bloqueadores.join(', ')}. Remediar antes de invertir.`] : ['Funnel sin evidencia de conversión: registrar el resultado del diagnóstico antes de crear campañas.'],
      risks: ['Invertir sin diagnóstico repetiría el patrón de gasto con 0 contactos.'],
      readinessSummary: readinessEval.resumen,
    };
  }

  // ── EXPERIMENTO ──────────────────────────────────────────────────────────────
  const experimentFraction = e.config?.experimentFraction ?? 0.5;
  const minExp = e.config?.minExperimentBudget ?? 5000;
  const prudentFraction = e.config?.prudentSpendFraction ?? 0.5;
  const experimentBudget = Math.min(cap, Math.max(Math.min(minExp, cap), Math.round(experimentFraction * cap)));

  const plannables = canales.filter((c) => disponibilidadPorCanal(c, e.disponibilidad).canPlan);
  const porCanal = plannables.length > 0 ? Math.floor(experimentBudget / plannables.length) : 0;
  let asignado = 0;
  const mix: AsignacionCanal[] = canales.map((c) => {
    const d = disponibilidadPorCanal(c, e.disponibilidad);
    const monto = d.canPlan ? porCanal : 0;
    asignado += monto;
    return { canal: c, disponible: d.canPlan, presupuesto: monto, motivo: d.canPlan ? `Canal planificable (ejecución: ${d.canExecute ? 'habilitada' : `bloqueada · ${d.executionGate}`}).` : `Canal no disponible para planificar (gate ${d.executionGate}) — sin presupuesto.` };
  });
  const totalSpendRecommended = Math.min(asignado, cap);

  const targetCpa: TargetCpa = e.historicalCpa != null && e.historicalCpa > 0
    ? { kind: 'VALUE', value: Math.round(e.historicalCpa), rationale: 'CPA derivado de evidencia histórica de contactos atribuibles.' }
    : { kind: 'UNDEFINED_INSUFFICIENT_EVIDENCE', rationale: 'No hay contactos históricos suficientes para un CPA defendible; se usa el guardrail de gasto sin contacto.' };

  // MAX_SPEND_WITHOUT_CONTACT numérico: min(fracción prudente del experimento, presupuesto del experimento).
  const maxSinContacto = Math.max(1, Math.min(Math.round(prudentFraction * totalSpendRecommended), totalSpendRecommended));
  const maxSpendWithoutContact = { value: maxSinContacto, rationale: `min(${Math.round(prudentFraction * 100)}% del presupuesto del experimento, presupuesto del experimento) = ${fmt(moneda, maxSinContacto)}; sin CPA histórico, este es el guardrail de corte.` };

  const { selected, backlog } = seleccionarHipotesis(e.readiness ?? null, signals);
  const keywordDecisions = decidirKeywords(signals);

  const successCriteria: SuccessCriteria = {
    minimumRealContacts: 1,
    maxSpend: totalSpendRecommended,
    measurementWindowDays: e.periodoDias,
    attributionRequirement: 'contacto first-party (lead_created) atribuible a la campaña/canal',
  };
  const stops = stopRules(cap, moneda, e.endAt, maxSinContacto, targetCpa);

  // Draft SÓLO para canales planificables con presupuesto (>0). Meta no planificable ⇒ sin draft.
  const campaigns: CampaignDraft[] = mix
    .filter((m) => m.presupuesto > 0 && m.canal === 'google')
    .map((m) => draftGoogle(e, m.presupuesto, selected ?? { id: 'HYP_NONE', category: 'NONE', statement: '', evidenceStrength: 'LOW', potentialImpact: 'LOW', testCost: 'LOW', reversibility: 'LOW', measurability: 'LOW', score: 0 }, keywordDecisions, successCriteria, stops));

  return {
    objective: e.objetivo, totalAuthorizedBudget: cap, currency: moneda,
    period: { dias: e.periodoDias, startAt: e.startAt, endAt: e.endAt },
    planStatus: 'READY_FOR_APPROVAL', executionStatus,
    channelPlanningAvailability: planningAvail, channelExecutionAvailability: executionAvail,
    channelsConsidered: canales, recommendedChannelMix: mix,
    totalSpendRecommended,
    spendRecommendation: `Primer experimento acotado: asignar ${fmt(moneda, totalSpendRecommended)} de ${fmt(moneda, cap)} (reservar el resto para iterar tras aprender). Aprobación humana requerida.`,
    auditFunnel: 'NOT_REQUIRED',
    selectedHypothesis: selected, backlogHypotheses: backlog, keywordDecisions,
    maxSpendWithoutContact, targetCpa, successCriteria, stopCriteria: stops,
    campaigns,
    reasoning: {
      facts: [...estrategia.hechos, ...(e.readiness?.findings ?? [])],
      hypotheses: [selected ? `Hipótesis primaria: ${selected.statement}` : 'Sin hipótesis seleccionada', ...backlog.slice(0, 3).map((h) => `Backlog: ${h.statement}`)],
    },
    requiredTracking,
    landingIssues: [],
    risks: totalSpendRecommended === 0 ? ['Ningún canal planificable con presupuesto: no hay experimento que ejecutar.'] : [],
    readinessSummary: readinessEval.resumen,
  };
}
