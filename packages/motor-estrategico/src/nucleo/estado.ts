/**
 * @soec/motor-estrategico · núcleo · ESTADO DE EVALUABILIDAD CANÓNICO.
 *
 * Codifica, por PRIMERA vez en el producto, la máquina de estados de evaluabilidad que hasta ahora
 * solo existía como doctrina (Constitución §8, ADR-002 Principio de Evaluabilidad): los CUATRO estados
 * en los que puede terminar cualquier afirmación estratégica de SOEC. Antes de M5 el string 'GRIS' no
 * aparecía en el repositorio; cada dominio inventaba su propia señal (NO_EVALUABLE binario, NO_CONCLUYENTE,
 * INCONCLUSA…). Este enum es la SSOT de esa semántica; el resto del producto deriva de aquí.
 *
 * Regla fundacional (inviolable): la AUSENCIA de información NUNCA es una conclusión. Sin evidencia
 * pertinente, el estado es NO_EVALUABLE — jamás FALSO. FALSO es un veredicto POSITIVO (hay evidencia
 * pertinente y suficiente que refuta), no el hueco que deja la ignorancia.
 */

/**
 * Los cuatro —y solo cuatro— estados canónicos de una afirmación evaluable:
 *
 * - `VERDADERO`     — evidencia pertinente, suficiente y dominante que SOSTIENE la afirmación.
 * - `FALSO`         — evidencia pertinente, suficiente y dominante que la REFUTA (veredicto positivo, no ausencia).
 * - `GRIS`          — SÍ se evaluó, pero la evidencia pertinente es insuficiente o contradictoria para concluir.
 *                     Es un "miramos y aún no podemos afirmar", distinto de no haber podido mirar.
 * - `NO_EVALUABLE`  — no hay base pertinente para intentar un veredicto. La ausencia de información no concluye.
 */
export type EstadoEvaluabilidad = 'VERDADERO' | 'FALSO' | 'GRIS' | 'NO_EVALUABLE';

export const ESTADOS_EVALUABILIDAD: readonly EstadoEvaluabilidad[] = [
  'VERDADERO',
  'FALSO',
  'GRIS',
  'NO_EVALUABLE',
] as const;

/** ¿El estado es un veredicto concluyente (afirma o niega), por oposición a gris/no-evaluable? */
export function esConcluyente(estado: EstadoEvaluabilidad): boolean {
  return estado === 'VERDADERO' || estado === 'FALSO';
}

/**
 * ¿El estado representa una AUSENCIA de conclusión? `GRIS` y `NO_EVALUABLE` son ambos no-concluyentes,
 * pero por razones epistémicas distintas: GRIS se evaluó (había con qué mirar) y no alcanzó; NO_EVALUABLE
 * no llegó siquiera a evaluarse (no había con qué). Nunca deben colapsarse en uno solo.
 */
export function esAbstencion(estado: EstadoEvaluabilidad): boolean {
  return estado === 'GRIS' || estado === 'NO_EVALUABLE';
}
