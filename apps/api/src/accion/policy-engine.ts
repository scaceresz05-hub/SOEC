/**
 * apps/api · SAFE ACTION PLANE (V2-A) · ACTION POLICY ENGINE.
 * Whitelist EXPLÍCITA de operaciones permitidas (orgánicas y pagadas) + clasificación de riesgo. Todo lo
 * que NO esté en el catálogo es RECHAZADO (UNAUTHORIZED_ACTION). Determinista; no depende de LLM.
 */

export type Riesgo = 'BAJO' | 'MEDIO' | 'ALTO';

export interface ClaseAccion {
  readonly permitida: boolean;
  readonly pagada: boolean; // consume presupuesto (pasa por el techo del Budget Guard)
  readonly riesgo: Riesgo;
}

/** Catálogo cerrado de acciones permitidas. Pagada ⇒ el Budget Guard exige techo de presupuesto. */
export const CATALOGO_ACCIONES: Readonly<Record<string, { pagada: boolean; riesgo: Riesgo }>> = {
  // Orgánicas (no consumen presupuesto)
  PUBLISH_POST: { pagada: false, riesgo: 'MEDIO' },
  PUBLISH_STORY: { pagada: false, riesgo: 'MEDIO' },
  SCHEDULE_POST: { pagada: false, riesgo: 'BAJO' },
  UPDATE_CREATIVE_DRAFT: { pagada: false, riesgo: 'BAJO' },
  // Pagadas (consumen presupuesto; pasan por el techo)
  CREATE_CAMPAIGN: { pagada: true, riesgo: 'ALTO' },
  CREATE_ADSET: { pagada: true, riesgo: 'ALTO' },
  CREATE_AD: { pagada: true, riesgo: 'ALTO' },
  REPLACE_CREATIVE: { pagada: true, riesgo: 'MEDIO' },
  START_AB_TEST: { pagada: true, riesgo: 'MEDIO' },
  ADJUST_PACING_WITHIN_MANDATE: { pagada: true, riesgo: 'MEDIO' },
  // De control (no cuestan; siempre seguras)
  PAUSE_AD: { pagada: false, riesgo: 'BAJO' },
  RESUME_AD: { pagada: false, riesgo: 'MEDIO' },
};

export function clasificarAccion(tipo: string): ClaseAccion {
  const c = CATALOGO_ACCIONES[tipo];
  if (!c) return { permitida: false, pagada: false, riesgo: 'ALTO' };
  return { permitida: true, pagada: c.pagada, riesgo: c.riesgo };
}

/** Acciones que MUTAN presupuesto/mandato están PROHIBIDAS por diseño (soberanía financiera humana). */
export const ACCIONES_PROHIBIDAS_FINANCIERAS = [
  'INCREASE_BUDGET',
  'RENEW_BUDGET',
  'EXTEND_PERIOD',
  'CHANGE_CURRENCY',
  'CREATE_MANDATE',
  'AUTHORIZE_MANDATE',
  'RAISE_CAP',
] as const;

export function esAccionFinancieraProhibida(tipo: string): boolean {
  return (ACCIONES_PROHIBIDAS_FINANCIERAS as readonly string[]).includes(tipo);
}
