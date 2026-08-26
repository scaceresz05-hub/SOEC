/**
 * apps/api · campana · ENFORCEMENT de STOP RULES (Fase 2B, PURO). Decide de forma DETERMINISTA qué reglas de
 * detención se disparan con las métricas vivas del experimento, para que un canary futuro pueda PAUSAR/DETENER.
 * NO ejecuta la pausa (eso lo hace el ejecutor real vía STOP_CAMPAIGN ⇒ status PAUSED). NO agrega guardrails
 * nuevos: sólo evalúa los preautorizados en el envelope (STOP_BUDGET, STOP_ZERO_CONVERSION, STOP_TRACKING,
 * STOP_LANDING, STOP_PERIOD). CPA sigue deshabilitada por diseño (sin evidencia histórica).
 */
import type { AuthorizedExecutionEnvelope } from './authorized-execution-envelope';

export interface MetricasVivas {
  readonly spend: number;
  readonly contacts: number;
  readonly trackingValid: boolean;
  readonly landingAvailable: boolean;
  readonly now: string;
}

export interface DecisionStop {
  readonly stop: boolean;
  readonly firedRuleIds: readonly string[];
  /** Acción resultante si dispara: STOP_CAMPAIGN ⇒ status PAUSED (fin del experimento). Nunca REMOVE/DELETE/RESUME. */
  readonly action: 'STOP_CAMPAIGN' | null;
}

const umbral = (env: AuthorizedExecutionEnvelope, id: string, fallback: number): number => {
  const r = env.stopRules.find((s) => s.id === id);
  return typeof r?.threshold === 'number' ? r.threshold : fallback;
};
const habilitada = (env: AuthorizedExecutionEnvelope, id: string): boolean => env.stopRules.find((s) => s.id === id)?.enabled !== false;

/**
 * Evalúa las reglas de detención vigentes. `env.expiresAt` = fin de la ventana de ejecución (fijado al ACTIVAR;
 * null antes de activar ⇒ STOP_PERIOD no puede dispararse todavía). Fail-safe: cualquier regla satisfecha ⇒ STOP.
 */
export function evaluarStopVigente(env: AuthorizedExecutionEnvelope, m: MetricasVivas): DecisionStop {
  const fired: string[] = [];
  // STOP_BUDGET: tope ABSOLUTO del envelope (30000). Histórico no cuenta; `spend` es el gasto del experimento.
  if (habilitada(env, 'STOP_BUDGET') && m.spend >= umbral(env, 'STOP_BUDGET', env.totalCap)) fired.push('STOP_BUDGET');
  // STOP_ZERO_CONVERSION: gasto sin contacto real atribuible (7500).
  if (habilitada(env, 'STOP_ZERO_CONVERSION') && m.contacts === 0 && m.spend >= umbral(env, 'STOP_ZERO_CONVERSION', env.maxSpendWithoutContact)) fired.push('STOP_ZERO_CONVERSION');
  // STOP_TRACKING / STOP_LANDING: medición o landing inválidas.
  if (habilitada(env, 'STOP_TRACKING') && m.trackingValid === false) fired.push('STOP_TRACKING');
  if (habilitada(env, 'STOP_LANDING') && m.landingAvailable === false) fired.push('STOP_LANDING');
  // STOP_PERIOD: fin de la ventana de ejecución real (sólo si la ventana ya fue fijada al activar).
  if (habilitada(env, 'STOP_PERIOD') && env.expiresAt && m.now >= env.expiresAt) fired.push('STOP_PERIOD');
  return { stop: fired.length > 0, firedRuleIds: fired, action: fired.length > 0 ? 'STOP_CAMPAIGN' : null };
}
