/**
 * apps/api · campana · AUTHORIZED EXECUTION ENVELOPE (PURO, sin I/O).
 *
 * El humano autoriza UNA VEZ un SOBRE de ejecución: objetivo, presupuesto TOTAL, período, canales y tipos de
 * acción permitidos, con sus criterios de éxito/detención. DENTRO del sobre SOEC puede operar de forma
 * supervisada (SUPERVISED_REAL); FUERA del sobre, toda acción se DENIEGA. `SOEC_AUTONOMOUS_REAL` sigue false:
 * este primer entregable produce SÓLO un DRAFT (sin aprobar) y valida en DRY-RUN — no habilita escritura real.
 *
 * SOBERANÍA DE PRESUPUESTO: SOEC NUNCA sube `totalBudget`. Al agotarse ⇒ STOP y NEW_HUMAN_AUTHORIZATION_REQUIRED.
 */
import type { CanalId, MarketingPlan, StopRule } from './marketing-plan';

export type AccionTipo =
  | 'CREATE_CAMPAIGN'
  | 'CREATE_AD_GROUP'
  | 'CREATE_AD'
  | 'CREATE_KEYWORD'
  | 'CREATE_NEGATIVE'
  | 'PAUSE'
  | 'RESUME'
  | 'ADJUST_ALLOCATION';

export type EnvelopeStatus = 'DRAFT' | 'APPROVED' | 'ACTIVE' | 'STOPPED' | 'COMPLETED';

export interface AuthorizedExecutionEnvelope {
  readonly organization: string;
  readonly planId: string;
  readonly objective: string;
  readonly totalBudget: number;
  readonly currency: string;
  readonly startAt: string | null;
  readonly endAt: string | null;
  readonly allowedChannels: readonly CanalId[];
  readonly allowedCampaignIds: readonly string[];
  readonly allowedActionTypes: readonly AccionTipo[];
  readonly successCriteria: readonly string[];
  readonly stopCriteria: readonly StopRule[];
  readonly approvedBy: string | null;
  readonly approvedAt: string | null;
  readonly status: EnvelopeStatus;
}

/** Acciones permitidas por defecto DENTRO de un sobre aprobado (todas siguen requiriendo el sobre + presupuesto). */
const ACCIONES_PERMITIDAS_DEFECTO: readonly AccionTipo[] = [
  'CREATE_CAMPAIGN', 'CREATE_AD_GROUP', 'CREATE_AD', 'CREATE_KEYWORD', 'CREATE_NEGATIVE', 'PAUSE', 'RESUME', 'ADJUST_ALLOCATION',
];

/**
 * Construye el DRAFT del sobre a partir del plan. status=DRAFT, sin aprobar (approvedBy=null). Un plan en
 * DIAGNOSIS_REQUIRED no habilita canales de gasto: allowedChannels queda vacío (nada real por autorizar aún).
 */
export function construirEnvelopeDraft(plan: MarketingPlan, org: string, planId: string): AuthorizedExecutionEnvelope {
  const canalesConGasto = plan.recommendedChannelMix.filter((m) => m.presupuesto > 0).map((m) => m.canal);
  return {
    organization: org,
    planId,
    objective: plan.objective,
    totalBudget: plan.totalAuthorizedBudget,
    currency: plan.currency,
    startAt: plan.period.startAt,
    endAt: plan.period.endAt,
    allowedChannels: canalesConGasto, // en DIAGNOSIS_REQUIRED ⇒ [] (no hay gasto que autorizar)
    allowedCampaignIds: [], // se poblará al crear campañas dentro del sobre aprobado
    allowedActionTypes: canalesConGasto.length > 0 ? ACCIONES_PERMITIDAS_DEFECTO : [],
    successCriteria: plan.successCriteria,
    stopCriteria: plan.stopCriteria,
    approvedBy: null,
    approvedAt: null,
    status: 'DRAFT',
  };
}

export interface AccionReal {
  readonly canal: CanalId;
  readonly tipo: AccionTipo;
  readonly campaignId?: string;
  /** Gasto acumulado que resultaría DESPUÉS de esta acción (para el guardarraíl de presupuesto). */
  readonly spendAfter?: number;
  readonly at?: string;
}

export interface ResultadoValidacion {
  readonly within: boolean;
  readonly deny: string | null;
}

/**
 * ACTION_WITHIN_ENVELOPE. Fail-closed: si el sobre no está aprobado/activo o la acción excede el envelope
 * (canal/tipo/presupuesto/período/campaña), DENY. En DRY-RUN el sobre está en DRAFT ⇒ SIEMPRE deny (no hay
 * escritura real habilitada). Nunca autoriza gasto por encima de `totalBudget`.
 */
export function validateEnvelope(action: AccionReal, env: AuthorizedExecutionEnvelope): ResultadoValidacion {
  if (env.status !== 'APPROVED' && env.status !== 'ACTIVE') return { within: false, deny: 'ENVELOPE_NOT_APPROVED' };
  if (!env.allowedChannels.includes(action.canal)) return { within: false, deny: 'CHANNEL_NOT_ALLOWED' };
  if (!env.allowedActionTypes.includes(action.tipo)) return { within: false, deny: 'ACTION_TYPE_NOT_ALLOWED' };
  if (action.spendAfter != null && action.spendAfter > env.totalBudget) return { within: false, deny: 'BUDGET_EXCEEDED' };
  if (action.at != null && env.endAt != null && action.at > env.endAt) return { within: false, deny: 'PERIOD_ENDED' };
  const esCreacionCampana = action.tipo === 'CREATE_CAMPAIGN';
  if (!esCreacionCampana && action.campaignId != null && env.allowedCampaignIds.length > 0 && !env.allowedCampaignIds.includes(action.campaignId))
    return { within: false, deny: 'CAMPAIGN_NOT_ALLOWED' };
  return { within: true, deny: null };
}

export interface MetricasVivas {
  readonly spend: number;
  readonly contacts: number;
  readonly cpa?: number | null;
  readonly cpaThreshold?: number | null;
  readonly trackingHealthy?: boolean;
  readonly landingAvailable?: boolean;
  readonly now?: string;
  /** Fracción del presupuesto consumido sin contactos que dispara ZERO_CONVERSION (p.ej. 0.5). */
  readonly zeroConversionFraccion?: number;
}

export interface ResultadoStop {
  readonly stop: boolean;
  readonly disparadas: readonly StopRule[];
}

/**
 * OPTIMIZATION LOOP · evaluación de STOP RULES preautorizadas. PURA. No ejecuta la detención (eso vive en el
 * adapter gobernado, fuera de este entregable): sólo decide qué reglas se dispararon con las métricas vivas.
 */
export function evaluarStopRules(env: AuthorizedExecutionEnvelope, m: MetricasVivas): ResultadoStop {
  const disparadas: StopRule[] = [];
  for (const r of env.stopCriteria) {
    switch (r.tipo) {
      case 'BUDGET':
        if (m.spend >= env.totalBudget) disparadas.push(r); // SIEMPRE
        break;
      case 'ZERO_CONVERSION': {
        const frac = m.zeroConversionFraccion ?? 0.5;
        if (m.contacts === 0 && m.spend >= env.totalBudget * frac) disparadas.push(r);
        break;
      }
      case 'CPA':
        if (m.cpa != null && m.cpaThreshold != null && m.cpa > m.cpaThreshold) disparadas.push(r);
        break;
      case 'TRACKING':
        if (m.trackingHealthy === false) disparadas.push(r);
        break;
      case 'LANDING':
        if (m.landingAvailable === false) disparadas.push(r);
        break;
      case 'PERIOD':
        if (m.now != null && env.endAt != null && m.now >= env.endAt) disparadas.push(r);
        break;
    }
  }
  return { stop: disparadas.length > 0, disparadas };
}
