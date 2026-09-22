/**
 * apps/api · OPTIMIZACIÓN AUTÓNOMA · vocabulario.
 *
 * El ciclo completo, y cada flecha es una puerta que se puede cerrar:
 *
 *   OBSERVAR → EVALUAR → DECIDIR → GOBERNAR → EJECUTAR → VERIFICAR → APRENDER
 *
 * Tres separaciones que este archivo sostiene y que el producto solía mezclar:
 *
 *  1. **QUÉ puede hacer** (política de autonomía) ≠ **CUÁNTO puede comprometer** (mandato financiero).
 *     Son dos autorizaciones distintas, de dos naturalezas distintas, y ninguna implica la otra.
 *  2. **Observar** ≠ **proponer** ≠ **ejecutar**. El modo operativo decide hasta dónde llega el ciclo.
 *  3. **Decidido** ≠ **aplicado** ≠ **verificado**. Un HTTP 200 de Google no es una campaña cambiada.
 */

/** Estados del ciclo. `NO_ACTION` es un final legítimo y frecuente: no decidir también es decidir. */
export type EstadoCiclo =
  | 'QUEUED'
  | 'OBSERVING'
  | 'EVALUATING'
  | 'WAITING_FOR_EVIDENCE'
  | 'DECIDED'
  | 'WAITING_FOR_APPROVAL'
  | 'EXECUTING'
  | 'VERIFIED'
  | 'NO_ACTION'
  | 'FAILED';

export const CICLOS_TERMINALES: readonly EstadoCiclo[] = ['VERIFIED', 'NO_ACTION', 'FAILED'];

/**
 * Modo del ciclo. `SHADOW` es una capa TÉCNICA de validación, distinta del modo comercial `OBSERVE`: en shadow
 * el motor observa, decide y registra **qué habría hecho**, sobre campañas reales, sin tocar nada. Sirve para
 * comprobar el criterio del optimizador antes de cederle control.
 */
export type ModoCiclo = 'SHADOW' | 'SUPERVISED' | 'AUTONOMOUS';

/** Acciones que el optimizador sabe proponer. Las tres últimas existen pero NO son autónomas todavía. */
export type AccionOptimizacion =
  | 'PAUSE_CAMPAIGN'
  | 'PAUSE_AD_GROUP'
  | 'PAUSE_KEYWORD'
  | 'ADD_NEGATIVE_KEYWORD'
  | 'ADJUST_DAILY_BUDGET'
  | 'ADJUST_MAX_CPC'
  | 'ENABLE_CAMPAIGN'
  | 'CREATE_KEYWORD'
  | 'CREATE_AD';

export const ACCIONES: readonly AccionOptimizacion[] = [
  'PAUSE_CAMPAIGN', 'PAUSE_AD_GROUP', 'PAUSE_KEYWORD', 'ADD_NEGATIVE_KEYWORD',
  'ADJUST_DAILY_BUDGET', 'ADJUST_MAX_CPC', 'ENABLE_CAMPAIGN', 'CREATE_KEYWORD', 'CREATE_AD',
];

/** Acciones que esta fase sabe EJECUTAR de verdad. El resto se declara y se explica, pero no se aplica. */
export const ACCIONES_EJECUTABLES: readonly AccionOptimizacion[] = [
  'PAUSE_CAMPAIGN', 'PAUSE_AD_GROUP', 'PAUSE_KEYWORD', 'ADD_NEGATIVE_KEYWORD',
  'ADJUST_DAILY_BUDGET', 'ADJUST_MAX_CPC', 'ENABLE_CAMPAIGN',
];

/**
 * Riesgo de una acción. `SAFETY` no es «riesgo bajo»: es una acción que REDUCE exposición (pausar por
 * stop-loss) y por eso puede ocurrir incluso donde otras no pueden. `PROHIBITED` no se propone jamás.
 */
export type NivelRiesgo = 'SAFETY' | 'LOW_RISK' | 'MEDIUM_RISK' | 'HIGH_RISK' | 'PROHIBITED';

/** Clasificación de dominio, auditable y estable: la misma acción siempre pesa lo mismo. */
export const RIESGO_BASE: Readonly<Record<AccionOptimizacion, NivelRiesgo>> = {
  PAUSE_CAMPAIGN: 'SAFETY',       // deja de gastar: reduce exposición
  PAUSE_AD_GROUP: 'LOW_RISK',     // reduce alcance, reversible
  PAUSE_KEYWORD: 'LOW_RISK',
  ADD_NEGATIVE_KEYWORD: 'LOW_RISK',
  ADJUST_DAILY_BUDGET: 'MEDIUM_RISK', // mueve dinero futuro
  ADJUST_MAX_CPC: 'MEDIUM_RISK',
  ENABLE_CAMPAIGN: 'HIGH_RISK',   // empieza a gastar de verdad
  CREATE_KEYWORD: 'MEDIUM_RISK',
  CREATE_AD: 'MEDIUM_RISK',
};

/** Veredicto del portero de evidencia. `CONFLICTING` = las señales se contradicen; decidir sería adivinar. */
export type VeredictoEvidencia = 'SUFFICIENT' | 'INSUFFICIENT' | 'STALE' | 'CONFLICTING';

/** Salud de la medición: si está degradada, ninguna decisión basada en conversiones es defendible. */
export type SaludMedicion = 'HEALTHY' | 'DEGRADED' | 'UNKNOWN';

/** Resultado de aplicar una acción en la plataforma. */
export type ResultadoAccion = 'APPLIED' | 'NOOP_ALREADY_APPLIED' | 'BLOCKED' | 'FAILED' | 'SHADOW_ONLY';

/** Verificación posterior a la escritura. Un HTTP 200 no basta. */
export type VerificacionRemota = 'VERIFIED' | 'DIVERGED' | 'UNKNOWN';

/** Cómo terminó una decisión, medida DESPUÉS. Es la materia prima para que SOEC aprenda de sí mismo. */
export type ResultadoAprendizaje = 'IMPROVED' | 'DEGRADED' | 'INCONCLUSIVE' | 'NOT_ENOUGH_TIME';

/** Estado de una acción pendiente de aprobación humana. */
export type EstadoPendiente = 'PENDING' | 'APPROVED' | 'REJECTED' | 'ADJUSTED' | 'EXPIRED' | 'APPLIED' | 'STALE';

/** Una métrica puede no existir. `null` significa UNKNOWN: nunca se inventa un cero. */
export type MetricaOpcional = number | null;

export interface MetricasObservadas {
  readonly spend: MetricaOpcional;
  readonly impressions: MetricaOpcional;
  readonly clicks: MetricaOpcional;
  readonly ctr: MetricaOpcional;
  readonly cpc: MetricaOpcional;
  readonly conversions: MetricaOpcional;
  readonly conversionValue: MetricaOpcional;
  readonly cpa: MetricaOpcional;
  readonly cvr: MetricaOpcional;
}

export const METRICAS_DESCONOCIDAS: MetricasObservadas = {
  spend: null, impressions: null, clicks: null, ctr: null, cpc: null,
  conversions: null, conversionValue: null, cpa: null, cvr: null,
};

/** Deriva métricas compuestas SÓLO cuando sus componentes existen. Sin datos ⇒ `null`, no cero. */
export function derivar(m: { spend: MetricaOpcional; impressions: MetricaOpcional; clicks: MetricaOpcional; conversions: MetricaOpcional; conversionValue: MetricaOpcional }): MetricasObservadas {
  const div = (a: MetricaOpcional, b: MetricaOpcional): MetricaOpcional =>
    a === null || b === null || b === 0 ? null : a / b;
  return {
    ...m,
    ctr: div(m.clicks, m.impressions),
    cpc: div(m.spend, m.clicks),
    cpa: m.conversions === null || m.conversions === 0 ? null : div(m.spend, m.conversions),
    cvr: div(m.conversions, m.clicks),
  };
}

/** Ventana de observación de un snapshot. Sin ventana no hay contexto: una cifra suelta no dice nada. */
export interface VentanaObservacion {
  readonly desde: string;
  readonly hasta: string;
  readonly dias: number;
}

export class OptimizacionInvalidaError extends Error {}
export class OptimizacionNoEncontradaError extends Error {}

/** Cambios por debajo de esto son ruido: no se toca nada (banda muerta). */
export const DEADBAND_PORCENTUAL = 5;

/** Horas mínimas entre dos cambios de la misma palanca, si la política no dice otra cosa. */
export const COOLDOWN_HORAS_POR_DEFECTO = 24;

/** Días de la ventana de observación por defecto. */
export const VENTANA_DIAS_POR_DEFECTO = 14;

/** Cuántos días hay que esperar antes de juzgar el efecto de una decisión. */
export const DIAS_PARA_JUZGAR_EFECTO = 7;

/** Normaliza un texto para comparar términos (sin acentos, minúsculas, espacios simples). */
export function normalizar(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Etiquetas de acción en lenguaje de negocio (la interfaz no muestra enums). */
export const ETIQUETA_ACCION: Readonly<Record<AccionOptimizacion, string>> = {
  PAUSE_CAMPAIGN: 'pausar la campaña',
  PAUSE_AD_GROUP: 'pausar un grupo de anuncios',
  PAUSE_KEYWORD: 'dejar de pujar por una búsqueda',
  ADD_NEGATIVE_KEYWORD: 'excluir una búsqueda que no corresponde',
  ADJUST_DAILY_BUDGET: 'ajustar el presupuesto diario',
  ADJUST_MAX_CPC: 'ajustar el precio máximo por visita',
  ENABLE_CAMPAIGN: 'encender la campaña',
  CREATE_KEYWORD: 'añadir una búsqueda nueva',
  CREATE_AD: 'añadir un anuncio nuevo',
};

export const ETIQUETA_RIESGO: Readonly<Record<NivelRiesgo, string>> = {
  SAFETY: 'seguridad (reduce gasto)',
  LOW_RISK: 'bajo',
  MEDIUM_RISK: 'medio',
  HIGH_RISK: 'alto',
  PROHIBITED: 'no permitido',
};
