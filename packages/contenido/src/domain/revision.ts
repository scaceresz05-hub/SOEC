/**
 * Revisión automática (F2-CONT-01 §15). SOEC corrige una pieza cuando el problema
 * es corregible, generando una NUEVA versión (nunca sobrescribe la anterior) y
 * revalidando. Hay un límite de iteraciones; si el bloqueo persiste, la pieza queda
 * bloqueada conservando los hallazgos, sin publicar y sin repetir indefinidamente.
 */
import type { Hallazgo } from './validacion';

/** Máximo de rondas de revisión automática antes de declarar bloqueo. */
export const MAX_REVISIONES = 2;

export type AccionRevision = 'corregida' | 'sin_correccion_posible' | 'limite_alcanzado';

export interface Revision {
  readonly ronda: number;
  readonly motivo: string;
  readonly hallazgosPrevios: readonly Hallazgo[];
  readonly accion: AccionRevision;
  /** Subcadenas incorporadas a la lista "evitar" del generador para la nueva versión. */
  readonly evitarAgregado: readonly string[];
  readonly en: string;
}
