/**
 * apps/api · campana · TAXONOMÍA de ACCIONES autorizables (módulo neutro, sin dependencias) para romper el
 * ciclo entre el hash canónico del plan y el modelo del envelope.
 */
export type AccionAutorizable =
  | 'CREATE_CAMPAIGN' | 'CREATE_AD_GROUP' | 'CREATE_AD' | 'ADD_KEYWORD' | 'ADD_NEGATIVE_KEYWORD'
  | 'PAUSE_CAMPAIGN' | 'RESUME_CAMPAIGN' | 'ADJUST_DAILY_BUDGET' | 'PAUSE_AD_GROUP' | 'PAUSE_KEYWORD' | 'STOP_CAMPAIGN';

/** Taxonomía completa. */
export const ACCIONES_AUTORIZABLES_DEFECTO: readonly AccionAutorizable[] = [
  'CREATE_CAMPAIGN', 'CREATE_AD_GROUP', 'CREATE_AD', 'ADD_KEYWORD', 'ADD_NEGATIVE_KEYWORD',
  'PAUSE_CAMPAIGN', 'RESUME_CAMPAIGN', 'ADJUST_DAILY_BUDGET', 'PAUSE_AD_GROUP', 'PAUSE_KEYWORD', 'STOP_CAMPAIGN',
];

/**
 * Política DELIBERADA de un experimento de búsqueda (NO "todo"): construir + controlar + detener. Excluye
 * `RESUME_CAMPAIGN` a propósito. Es una función determinista del plan (hoy constante) ⇒ entra al hash canónico.
 */
export const ACCIONES_EXPERIMENTO_BUSQUEDA: readonly AccionAutorizable[] = [
  'CREATE_CAMPAIGN', 'CREATE_AD_GROUP', 'CREATE_AD', 'ADD_KEYWORD', 'ADD_NEGATIVE_KEYWORD',
  'ADJUST_DAILY_BUDGET', 'PAUSE_CAMPAIGN', 'PAUSE_AD_GROUP', 'PAUSE_KEYWORD', 'STOP_CAMPAIGN',
];

/** Política de acciones aplicada a un plan (determinista). Cambiar la política cambia el hash canónico. */
export function politicaAccionesDe(): readonly AccionAutorizable[] {
  return ACCIONES_EXPERIMENTO_BUSQUEDA;
}
