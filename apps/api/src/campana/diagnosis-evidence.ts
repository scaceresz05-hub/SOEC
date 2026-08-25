/**
 * apps/api · campana · EVIDENCIA DE DIAGNÓSTICO / READINESS DEL FUNNEL (tipos + evaluación PURA).
 *
 * El diagnóstico/remediación del funnel ocurre FUERA de SOEC (auditoría, fixes de landing, tracking, etc.).
 * Esta estructura permite INGERIR su resultado de forma auditable para que el planner sepa QUÉ fue verificado
 * (no un simple booleano). Es EVIDENCIA, no una instrucción estratégica. No hardcodea ninguna organización.
 */

export type CheckStatus = 'PASS' | 'PARTIAL' | 'FAIL' | 'UNKNOWN';
export type AttributionRuntimeStatus = 'ACTIVE' | 'FAIL' | 'UNKNOWN';

export interface Check {
  readonly status: CheckStatus;
  readonly notes?: string;
}

export interface MarketingReadiness {
  readonly landing: Check;
  readonly firstPartyTracking: Check;
  readonly googleAdsAttribution: { readonly status: AttributionRuntimeStatus; readonly notes?: string };
  readonly sitelinks: Check;
  readonly mobile: Check;
  /** ISO. null ⇒ el diagnóstico aún no se dio por terminado. */
  readonly diagnosisCompletedAt: string | null;
  readonly evidenceSource: string;
  /** Observaciones estructuradas (EVIDENCIA, no estrategia): p.ej. "26% de clics fuera de intención". */
  readonly findings: readonly string[];
}

export interface ReadinessEvaluada {
  readonly diagnosisCompleted: boolean;
  readonly hardFunnelBlocker: boolean;
  /** Checks que fallaron duro (bloquean invertir hasta remediar). */
  readonly bloqueadores: readonly string[];
  readonly resumen: string;
}

/**
 * Evalúa si el diagnóstico puede considerarse RESUELTO y si hay un bloqueador DURO del funnel.
 *  - diagnosisCompleted: hay `diagnosisCompletedAt` y los checks núcleo fueron efectivamente evaluados
 *    (no UNKNOWN). Sin evidencia evaluada ⇒ NO se considera resuelto (prevalece diagnóstico).
 *  - hardFunnelBlocker: algún check crítico está en FAIL (landing / tracking / atribución) ⇒ no invertir aún.
 */
export function evaluarReadiness(r: MarketingReadiness | null): ReadinessEvaluada {
  if (!r) return { diagnosisCompleted: false, hardFunnelBlocker: false, bloqueadores: [], resumen: 'Sin evidencia de diagnóstico registrada.' };

  const nucleo: Array<[string, CheckStatus | AttributionRuntimeStatus]> = [
    ['landing', r.landing.status],
    ['firstPartyTracking', r.firstPartyTracking.status],
    ['mobile', r.mobile.status],
  ];
  const evaluado = r.diagnosisCompletedAt != null && nucleo.every(([, s]) => s !== 'UNKNOWN');

  const bloqueadores: string[] = [];
  if (r.landing.status === 'FAIL') bloqueadores.push('landing');
  if (r.firstPartyTracking.status === 'FAIL') bloqueadores.push('firstPartyTracking');
  if (r.googleAdsAttribution.status === 'FAIL') bloqueadores.push('googleAdsAttribution');

  const hardFunnelBlocker = bloqueadores.length > 0;
  const diagnosisCompleted = evaluado && !hardFunnelBlocker;

  return {
    diagnosisCompleted,
    hardFunnelBlocker,
    bloqueadores,
    resumen: !evaluado
      ? 'Diagnóstico incompleto: faltan checks por verificar.'
      : hardFunnelBlocker
        ? `Diagnóstico completo pero con bloqueador duro: ${bloqueadores.join(', ')}.`
        : 'Diagnóstico completo, sin bloqueadores duros del funnel.',
  };
}
