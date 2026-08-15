/**
 * Objective→Channel Planner — decide QUÉ tipo de acción de adquisición corresponde, sin ejecutar.
 *
 * Entrada: objetivo, evaluabilidad (fundamentos), canales disponibles con su estado, si existe
 * BrandPolicy y StopLossPolicy, y si hay mandato de presupuesto. Salida: una intención tipada
 * (NO_ACTION / FOUNDATION_REQUIRED / ORGANIC_EXPERIMENT / PAID_EXPERIMENT / MULTICHANNEL_EXPERIMENT /
 * APPROVAL_REQUIRED) con razones. NO ejecuta nada. No fuerza a proponer un canal; si falta la
 * fundación de medición, dice FOUNDATION_REQUIRED con honestidad.
 */

import type { ObjetivoComercial } from './objetivo';
import type { CanalAdquisicion, EstadoCanal } from './canal';
import { canalTieneLectura, esCanalPagado } from './canal';

export type TipoPlan =
  | 'NO_ACTION'
  | 'FOUNDATION_REQUIRED'
  | 'ORGANIC_EXPERIMENT'
  | 'PAID_EXPERIMENT'
  | 'MULTICHANNEL_EXPERIMENT'
  | 'APPROVAL_REQUIRED';

export interface CanalDisponible {
  readonly canal: CanalAdquisicion;
  readonly estado: EstadoCanal;
}

export interface EntradaPlanner {
  readonly organizationId: string;
  readonly objetivo: ObjetivoComercial;
  /** Veredicto de fundamentos de medición para el objetivo (¿se puede evaluar el resultado?). */
  readonly medicionEvaluable: boolean;
  readonly canales: readonly CanalDisponible[];
  readonly tieneBrandPolicy: boolean;
  readonly tieneStopLoss: boolean;
  readonly tieneMandatoPresupuesto: boolean;
}

export interface PlanAdquisicion {
  readonly tipo: TipoPlan;
  readonly razones: readonly string[];
  readonly canalesOrganicosListos: readonly CanalAdquisicion[];
  readonly canalesPagadosListos: readonly CanalAdquisicion[];
}

/**
 * Planifica de forma conservadora y fail-closed:
 *   · sin medición evaluable ⇒ FOUNDATION_REQUIRED (aunque haya canales) — no se optimiza a ciegas;
 *   · PAID exige medición + StopLossPolicy + mandato de presupuesto; si falta algo ⇒ no hay PAID
 *     autónomo (APPROVAL_REQUIRED o sólo orgánico);
 *   · orgánico exige BrandPolicy para autopublicar; sin ella, el contenido queda en borrador y el
 *     plan pide aprobación;
 *   · sin canales con lectura ni orgánicos listos ⇒ NO_ACTION.
 */
export function planificarAdquisicion(e: EntradaPlanner): PlanAdquisicion {
  const razones: string[] = [];

  const organicosListos = e.canales
    .filter((c) => !esCanalPagado(c.canal) && canalTieneLectura(c.estado))
    .map((c) => c.canal);
  const pagadosListos = e.canales
    .filter((c) => esCanalPagado(c.canal) && canalTieneLectura(c.estado))
    .map((c) => c.canal);

  if (!e.medicionEvaluable) {
    razones.push('La medición del resultado comercial no es evaluable: primero hay que instrumentar.');
    return { tipo: 'FOUNDATION_REQUIRED', razones, canalesOrganicosListos: organicosListos, canalesPagadosListos: pagadosListos };
  }

  const paidPosible = pagadosListos.length > 0 && e.tieneStopLoss && e.tieneMandatoPresupuesto;
  if (pagadosListos.length > 0 && !e.tieneStopLoss) {
    razones.push('Hay canal pagado disponible pero falta StopLossPolicy: no hay PAID autónomo.');
  }
  if (pagadosListos.length > 0 && !e.tieneMandatoPresupuesto) {
    razones.push('Hay canal pagado disponible pero falta mandato de presupuesto.');
  }

  const organicoPosible = organicosListos.length > 0;
  if (organicoPosible && !e.tieneBrandPolicy) {
    razones.push('Hay canal orgánico disponible pero falta BrandPolicy: el contenido queda en borrador.');
  }

  if (paidPosible && organicoPosible) {
    razones.push('Medición lista y canales orgánicos + pagados disponibles.');
    return { tipo: 'MULTICHANNEL_EXPERIMENT', razones, canalesOrganicosListos: organicosListos, canalesPagadosListos: pagadosListos };
  }
  if (paidPosible) {
    razones.push('Medición lista, canal pagado disponible con StopLoss y mandato.');
    return { tipo: 'PAID_EXPERIMENT', razones, canalesOrganicosListos: organicosListos, canalesPagadosListos: pagadosListos };
  }
  if (organicoPosible && e.tieneBrandPolicy) {
    razones.push('Medición lista y canal orgánico disponible con BrandPolicy.');
    return { tipo: 'ORGANIC_EXPERIMENT', razones, canalesOrganicosListos: organicosListos, canalesPagadosListos: pagadosListos };
  }
  if (organicoPosible || pagadosListos.length > 0) {
    razones.push('Hay canales disponibles pero faltan políticas/mandato para actuar autónomamente.');
    return { tipo: 'APPROVAL_REQUIRED', razones, canalesOrganicosListos: organicosListos, canalesPagadosListos: pagadosListos };
  }

  razones.push('No hay canales con lectura ni orgánicos listos.');
  return { tipo: 'NO_ACTION', razones, canalesOrganicosListos: organicosListos, canalesPagadosListos: pagadosListos };
}
