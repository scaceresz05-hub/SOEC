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

/** Capacidad REAL del producto (para componer copy sin fabricar claims). Estructurada + evidencia. */
export interface ValueProp {
  readonly id?: string;
  readonly capability: string;
  readonly evidence?: string;
}

/** Destino publicable ya VALIDADO (existente, público, disponible). La readiness confirma sitelinks canónicos. */
export interface ValidatedDestination {
  readonly url: string;
  readonly anchor?: string;
  /** Intención a la que sirve el destino (p.ej. 'plans', 'features', 'contact'). */
  readonly intent: string;
  readonly validated: boolean;
  readonly public: boolean;
  readonly available: boolean;
  readonly evidence?: string;
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
  /** Destinos publicables ya validados (para el draft; sin ellos el destino queda PENDING). */
  readonly validatedDestinations?: readonly ValidatedDestination[];
  /** CAPACIDADES REALES confirmadas del producto (para componer copy sin fabricar claims). */
  readonly valueProps?: readonly ValueProp[];
  readonly brandName?: string;
}

export type NormalizacionReadiness = { readonly ok: true; readonly readiness: MarketingReadiness } | { readonly ok: false; readonly error: string };

const esCheck = (v: unknown): v is Check => !!v && typeof (v as Check).status === 'string';

/**
 * Normaliza y VALIDA el cuerpo del POST de readiness. Alinea writer↔reader: valueProps y validatedDestinations
 * se aceptan en primer nivel y se PRESERVAN (nunca se descartan en silencio). Campo soportado inválido ⇒ error
 * explícito (para 400). Acepta valueProps como strings legacy y las coacciona a {capability}.
 */
export function normalizarReadinessInput(body: unknown, ahora: string): NormalizacionReadiness {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!esCheck(b.landing) || !esCheck(b.firstPartyTracking) || !b.googleAdsAttribution || !esCheck(b.sitelinks) || !esCheck(b.mobile))
    return { ok: false, error: 'readiness incompleta (landing/firstPartyTracking/googleAdsAttribution/sitelinks/mobile requeridos)' };

  let valueProps: ValueProp[] | undefined;
  if (b.valueProps !== undefined) {
    if (!Array.isArray(b.valueProps)) return { ok: false, error: 'valueProps debe ser un arreglo' };
    valueProps = [];
    for (const v of b.valueProps) {
      if (typeof v === 'string') { if (v.trim()) valueProps.push({ capability: v }); else return { ok: false, error: 'valueProps: capacidad vacía' }; continue; }
      if (!v || typeof (v as ValueProp).capability !== 'string' || !(v as ValueProp).capability.trim()) return { ok: false, error: 'valueProps: cada item requiere capability (string no vacío)' };
      const vp = v as ValueProp;
      valueProps.push({ capability: vp.capability, ...(vp.id ? { id: vp.id } : {}), ...(vp.evidence ? { evidence: vp.evidence } : {}) });
    }
  }

  let validatedDestinations: ValidatedDestination[] | undefined;
  if (b.validatedDestinations !== undefined) {
    if (!Array.isArray(b.validatedDestinations)) return { ok: false, error: 'validatedDestinations debe ser un arreglo' };
    validatedDestinations = [];
    for (const d of b.validatedDestinations) {
      const dd = d as ValidatedDestination;
      if (!dd || typeof dd.url !== 'string' || !dd.url.trim() || typeof dd.intent !== 'string')
        return { ok: false, error: 'validatedDestinations: cada item requiere url e intent' };
      if (typeof dd.validated !== 'boolean' || typeof dd.public !== 'boolean' || typeof dd.available !== 'boolean')
        return { ok: false, error: 'validatedDestinations: validated/public/available deben ser booleanos' };
      validatedDestinations.push({ url: dd.url, intent: dd.intent, validated: dd.validated, public: dd.public, available: dd.available, ...(dd.anchor ? { anchor: dd.anchor } : {}), ...(dd.evidence ? { evidence: dd.evidence } : {}) });
    }
  }

  const readiness: MarketingReadiness = {
    landing: b.landing as Check, firstPartyTracking: b.firstPartyTracking as Check,
    googleAdsAttribution: b.googleAdsAttribution as MarketingReadiness['googleAdsAttribution'],
    sitelinks: b.sitelinks as Check, mobile: b.mobile as Check,
    diagnosisCompletedAt: (b.diagnosisCompletedAt as string | null | undefined) ?? ahora,
    evidenceSource: (b.evidenceSource as string | undefined) ?? 'external-diagnosis',
    findings: Array.isArray(b.findings) ? (b.findings as string[]) : [],
    ...(valueProps ? { valueProps } : {}),
    ...(validatedDestinations ? { validatedDestinations } : {}),
    ...(typeof b.brandName === 'string' ? { brandName: b.brandName } : {}),
  };
  return { ok: true, readiness };
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
