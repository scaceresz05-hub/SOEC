/**
 * apps/api · campana · MARKETING PLAN (PURO, sin I/O).
 *
 * Convierte OBJETIVO + PRESUPUESTO TOTAL humano + PERÍODO + evidencia en un PLAN estructurado:
 * mezcla de canales, borradores de campaña, criterios de éxito/detención, tracking, riesgos.
 * REUTILIZA el motor de estrategia del Director (no un segundo cerebro): la evidencia manda.
 *
 * SOBERANÍA: no decide gastar por decidir. Si el funnel no está probado (gasto real con 0 contactos),
 * el plan concluye DIAGNOSIS_REQUIRED / DO_NOT_SPEND_YET (0 CLP) — no reactiva ni asigna presupuesto real.
 * INVARIANTE: sum(recommendedChannelMix.presupuesto) <= totalAuthorizedBudget (jamás excede el tope humano).
 */
import { evaluarEstrategiaDirector, type EntradaEstrategia } from '../autonomia-ads/estrategia-director';

export type CanalId = 'google' | 'meta';

export type StopRuleTipo = 'BUDGET' | 'ZERO_CONVERSION' | 'CPA' | 'TRACKING' | 'LANDING' | 'PERIOD';
export interface StopRule {
  readonly id: string;
  readonly tipo: StopRuleTipo;
  readonly descripcion: string;
  readonly umbral?: number;
}

export type MarketingPlanStatus = 'DIAGNOSIS_REQUIRED' | 'READY_FOR_AUTHORIZATION';

export interface AsignacionCanal {
  readonly canal: CanalId;
  readonly disponible: boolean;
  readonly presupuesto: number;
  readonly motivo: string;
}

/** Borrador de campaña por canal (estructura, no ejecución). Campos según proveedor. */
export interface CampaignDraftGoogle {
  readonly canal: 'google';
  readonly campaignName: string;
  readonly budget: number;
  readonly startAt: string | null;
  readonly endAt: string | null;
  readonly adGroups: readonly { readonly name: string; readonly keywords: readonly string[]; readonly negativeKeywords: readonly string[] }[];
  readonly ads: readonly { readonly headline: string; readonly description: string }[];
  readonly targeting: string;
  readonly landingRecommendation: string;
  readonly tracking: readonly string[];
}
export interface CampaignDraftMeta {
  readonly canal: 'meta';
  readonly campaignName: string;
  readonly objective: string;
  readonly budget: number;
  readonly startAt: string | null;
  readonly endAt: string | null;
  readonly adSets: readonly { readonly name: string; readonly audiences: readonly string[]; readonly placements: readonly string[] }[];
  readonly creativeBriefs: readonly string[];
  readonly copies: readonly string[];
  readonly tracking: readonly string[];
}
export type CampaignDraft = CampaignDraftGoogle | CampaignDraftMeta;

export interface MarketingPlan {
  readonly objective: string;
  readonly totalAuthorizedBudget: number;
  readonly currency: string;
  readonly period: { readonly dias: number; readonly startAt: string | null; readonly endAt: string | null };
  readonly channelsConsidered: readonly CanalId[];
  readonly channelAvailability: Readonly<Record<CanalId, boolean>>;
  readonly recommendedChannelMix: readonly AsignacionCanal[];
  readonly totalSpendRecommended: number; // <= totalAuthorizedBudget SIEMPRE
  readonly spendRecommendation: string;
  readonly status: MarketingPlanStatus;
  readonly auditFunnel: 'REQUIRED' | 'NOT_REQUIRED';
  readonly campaigns: readonly CampaignDraft[];
  readonly reasoning: { readonly facts: readonly string[]; readonly hypotheses: readonly string[] };
  readonly successCriteria: readonly string[];
  readonly stopCriteria: readonly StopRule[];
  readonly requiredTracking: readonly string[];
  readonly landingIssues: readonly string[];
  readonly risks: readonly string[];
}

export interface EntradaMarketingPlan {
  readonly objetivo: string;
  readonly presupuestoTotal: number;
  readonly periodoDias: number;
  readonly startAt: string | null;
  readonly endAt: string | null;
  readonly moneda?: string;
  readonly canalesSolicitados: readonly CanalId[];
  readonly disponibilidad: Readonly<Record<CanalId, boolean>>;
  readonly evidencia: EntradaEstrategia;
}

/** Reglas de detención PREAUTORIZADAS (forman parte del envelope; no requieren nueva aprobación al dispararse). */
function stopRulesDe(presupuestoTotal: number, moneda: string): StopRule[] {
  return [
    { id: 'STOP_BUDGET', tipo: 'BUDGET', descripcion: `Detener al alcanzar el presupuesto total autorizado (${moneda} ${Math.round(presupuestoTotal)}).`, umbral: presupuestoTotal },
    { id: 'STOP_ZERO_CONVERSION', tipo: 'ZERO_CONVERSION', descripcion: 'Detener si se consume una fracción significativa del presupuesto sin ningún contacto real.' },
    { id: 'STOP_CPA', tipo: 'CPA', descripcion: 'Detener si el costo por contacto supera el umbral autorizado.' },
    { id: 'STOP_TRACKING', tipo: 'TRACKING', descripcion: 'Detener si la medición (tracking de contactos) deja de ser válida.' },
    { id: 'STOP_LANDING', tipo: 'LANDING', descripcion: 'Detener si la landing queda inaccesible o rota.' },
    { id: 'STOP_PERIOD', tipo: 'PERIOD', descripcion: 'Detener al terminar el período autorizado.' },
  ];
}

/** Construye el plan de marketing. PURO y determinista. */
export function construirMarketingPlan(e: EntradaMarketingPlan): MarketingPlan {
  const moneda = e.moneda ?? 'CLP';
  const cap = Math.max(0, e.presupuestoTotal);
  const estrategia = evaluarEstrategiaDirector(e.evidencia);
  const canales = [...e.canalesSolicitados];

  const stopCriteria = stopRulesDe(cap, moneda);
  const successCriteria = estrategia.siguienteExperimento
    ? [estrategia.siguienteExperimento.criterioExito]
    : ['Conseguir al menos 1 contacto real dentro del presupuesto total autorizado.'];
  const requiredTracking = [
    'Evento de contacto (lead_created) verificado y disparándose antes de invertir.',
    'Atribución del contacto a la campaña/canal de origen.',
  ];

  // SOBERANÍA: gasto real con 0 contactos ⇒ primero diagnóstico, gasto recomendado 0 (no reactivar).
  if (estrategia.funnelZeroConversion) {
    const mix: AsignacionCanal[] = canales.map((c) => ({
      canal: c,
      disponible: e.disponibilidad[c] ?? false,
      presupuesto: 0,
      motivo: 'Diagnóstico del funnel requerido antes de autorizar gasto.',
    }));
    return {
      objective: e.objetivo,
      totalAuthorizedBudget: cap,
      currency: moneda,
      period: { dias: e.periodoDias, startAt: e.startAt, endAt: e.endAt },
      channelsConsidered: canales,
      channelAvailability: e.disponibilidad,
      recommendedChannelMix: mix,
      totalSpendRecommended: 0,
      spendRecommendation: `0 ${moneda} UNTIL DIAGNOSIS`,
      status: 'DIAGNOSIS_REQUIRED',
      auditFunnel: 'REQUIRED',
      campaigns: [], // nada que construir hasta diagnosticar el funnel
      reasoning: { facts: estrategia.hechos, hypotheses: estrategia.hipotesis },
      successCriteria,
      stopCriteria,
      requiredTracking,
      landingIssues: ['Funnel sin evidencia de conversión: auditar landing → CTA → contacto y el tracking antes de crear campañas.'],
      risks: ['Invertir sin diagnóstico repetiría el patrón de gasto con 0 contactos.'],
    };
  }

  // Caso sano/inicial: asignar SÓLO a canales disponibles; los no disponibles (p.ej. Meta gated) = 0 (DORMANT).
  const disponiblesSolicitados = canales.filter((c) => e.disponibilidad[c]);
  const nDisp = disponiblesSolicitados.length;
  const porCanal = nDisp > 0 ? Math.floor(cap / nDisp) : 0;
  let asignado = 0;
  const mix: AsignacionCanal[] = canales.map((c) => {
    const disp = e.disponibilidad[c] ?? false;
    const monto = disp ? porCanal : 0;
    asignado += monto;
    return {
      canal: c,
      disponible: disp,
      presupuesto: monto,
      motivo: disp ? 'Canal disponible para el experimento.' : 'Canal no disponible (gate externo pendiente) — DORMANT, sin presupuesto real.',
    };
  });
  // Invariante dura: nunca exceder el tope humano (el reparto entero ya lo garantiza; se afirma explícitamente).
  const totalSpendRecommended = Math.min(asignado, cap);

  const campaigns: CampaignDraft[] = mix
    .filter((m) => m.presupuesto > 0)
    .map((m) => draftDeCanal(m.canal, m.presupuesto, e, estrategia.terminosEvidencia));

  return {
    objective: e.objetivo,
    totalAuthorizedBudget: cap,
    currency: moneda,
    period: { dias: e.periodoDias, startAt: e.startAt, endAt: e.endAt },
    channelsConsidered: canales,
    channelAvailability: e.disponibilidad,
    recommendedChannelMix: mix,
    totalSpendRecommended,
    spendRecommendation:
      totalSpendRecommended > 0
        ? `Asignar hasta ${moneda} ${Math.round(totalSpendRecommended)} en el experimento, dentro del tope autorizado.`
        : `0 ${moneda} — ningún canal disponible para ejecutar todavía.`,
    status: 'READY_FOR_AUTHORIZATION',
    auditFunnel: 'NOT_REQUIRED',
    campaigns,
    reasoning: { facts: estrategia.hechos, hypotheses: estrategia.hipotesis },
    successCriteria,
    stopCriteria,
    requiredTracking,
    landingIssues: [],
    risks: nDisp === 0 ? ['Ningún canal disponible: el experimento no puede ejecutarse hasta habilitar un canal.'] : [],
  };
}

function draftDeCanal(canal: CanalId, budget: number, e: EntradaMarketingPlan, terminos: readonly string[]): CampaignDraft {
  if (canal === 'google') {
    return {
      canal: 'google',
      campaignName: `Experimento — ${e.objetivo}`,
      budget,
      startAt: e.startAt,
      endAt: e.endAt,
      adGroups: [{ name: 'Grupo principal', keywords: [...terminos], negativeKeywords: [] }],
      ads: [{ headline: 'PENDING_COPY', description: 'PENDING_COPY — a definir con el diagnóstico del mensaje.' }],
      targeting: 'PENDING_TARGETING',
      landingRecommendation: 'Verificar landing y CTA antes de activar.',
      tracking: ['lead_created verificado'],
    };
  }
  return {
    canal: 'meta',
    campaignName: `Experimento — ${e.objetivo}`,
    objective: 'LEADS',
    budget,
    startAt: e.startAt,
    endAt: e.endAt,
    adSets: [{ name: 'Conjunto principal', audiences: ['PENDING_AUDIENCE'], placements: ['PENDING_PLACEMENT'] }],
    creativeBriefs: ['PENDING_CREATIVE_BRIEF'],
    copies: ['PENDING_COPY'],
    tracking: ['lead_created verificado'],
  };
}
