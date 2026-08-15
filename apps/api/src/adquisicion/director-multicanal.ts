/**
 * Director multicanal en SHADOW — razona OBJETIVO PRIMERO, canal después.
 *
 * Capa aditiva (no reemplaza `lectura-director-real`, que sigue atada a Google Ads): compone el
 * `planificarAdquisicion` de `@soec/adquisicion` para producir un veredicto de negocio (keyed en el
 * objetivo y la evaluabilidad de la medición) y luego el detalle por canal. NO recomienda Meta por
 * defecto; toda recomendación queda `null` (requiere aprobación humana); cero efectos externos.
 */

import {
  planificarAdquisicion,
  naturalezaDeCanal,
  canalTieneLectura,
  type EntradaPlanner,
  type PlanAdquisicion,
  type ObjetivoComercial,
  type CanalAdquisicion,
  type EstadoCanal,
  type NaturalezaCanal,
} from '@soec/adquisicion';

export interface CanalRazonado {
  readonly canal: CanalAdquisicion;
  readonly estado: EstadoCanal;
  readonly naturaleza: NaturalezaCanal;
  readonly tieneLectura: boolean;
}

export interface VeredictoDirectorAdquisicion {
  readonly organizationId: string;
  readonly objetivo: ObjetivoComercial;
  /** Veredicto de NEGOCIO primero (del planner). */
  readonly veredicto: PlanAdquisicion['tipo'];
  readonly razones: readonly string[];
  /** Detalle por canal, en segundo lugar. */
  readonly porCanal: readonly CanalRazonado[];
  /** SHADOW: nunca hay una recomendación ejecutable automática. */
  readonly recomendacion: null;
  readonly naturaleza: 'SHADOW';
}

export function razonarAdquisicionShadow(e: EntradaPlanner): VeredictoDirectorAdquisicion {
  const plan = planificarAdquisicion(e);
  return {
    organizationId: e.organizationId,
    objetivo: e.objetivo,
    veredicto: plan.tipo,
    razones: plan.razones,
    porCanal: e.canales.map((c) => ({
      canal: c.canal,
      estado: c.estado,
      naturaleza: naturalezaDeCanal(c.canal),
      tieneLectura: canalTieneLectura(c.estado),
    })),
    recomendacion: null,
    naturaleza: 'SHADOW',
  };
}
