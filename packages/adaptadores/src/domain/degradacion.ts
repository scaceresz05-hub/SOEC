/**
 * @soec/adaptadores · dominio · DEGRADACIÓN GOBERNADA (M4-C-A-H, Art. 11 de la Directiva PCE).
 *
 * Cuando la capacidad viva no es plenamente consumible, su `PoliticaDegradacion` (definida en M4-A) NO se
 * ignora: se traduce a una DIRECTIVA explícita. En M4-C-A-H el sandbox NO ejecuta alternativa ni caché
 * (pertenecen a M4-C-B/M4-D), pero SÍ las declara para que el orquestador las resuelva. `SIMULAR` es el
 * único caso que permite continuar, y siempre de forma explícita (cambia el modo ejecutado a SIMULADO).
 */
import type { PoliticaDegradacion } from '@soec/plataforma-capacidades';
import { type ErrorNormalizado, errorNormalizado } from './errores-normalizados';
import type { ModoAdaptador } from './estado-adaptador';

export type DirectivaDegradacion =
  | 'RECHAZADO_ABSTENCION'
  | 'EJECUTAR_SIMULADO'
  | 'DETENIDO'
  | 'REQUIERE_RESOLUCION_DE_ALTERNATIVA'
  | 'REQUIERE_RESOLUCION_DE_CACHE';

export interface ResolucionDegradacion {
  /** Si el sandbox puede continuar la ejecución (sólo SIMULAR). */
  readonly ejecutar: boolean;
  /** Modo con el que se ejecutaría si `ejecutar` (siempre SIMULADO en degradación). */
  readonly modoEjecutado: ModoAdaptador;
  readonly directiva: DirectivaDegradacion;
  /** Error gobernado si no se ejecuta. */
  readonly error: ErrorNormalizado | null;
}

/** Versión del esquema de políticas de degradación aplicado (trazabilidad, Art. 7). */
export const POLITICA_VERSION = 1;

/**
 * Traduce una política de degradación a una directiva explícita. Una política nula o desconocida se trata
 * como DETENER (fail-safe): jamás se continúa por omisión.
 */
export function resolverDegradacion(politica: PoliticaDegradacion | null): ResolucionDegradacion {
  switch (politica) {
    case 'SIMULAR':
      return { ejecutar: true, modoEjecutado: 'SIMULADO', directiva: 'EJECUTAR_SIMULADO', error: null };
    case 'ABSTENER':
      return { ejecutar: false, modoEjecutado: 'SIMULADO', directiva: 'RECHAZADO_ABSTENCION', error: errorNormalizado('NO_AUTORIZADO', 'abstención por degradación') };
    case 'ALTERNATIVA':
      return { ejecutar: false, modoEjecutado: 'SIMULADO', directiva: 'REQUIERE_RESOLUCION_DE_ALTERNATIVA', error: errorNormalizado('NO_AUTORIZADO', 'requiere resolución de alternativa') };
    case 'CACHE':
      return { ejecutar: false, modoEjecutado: 'SIMULADO', directiva: 'REQUIERE_RESOLUCION_DE_CACHE', error: errorNormalizado('NO_AUTORIZADO', 'requiere resolución de caché') };
    case 'DETENER':
    default:
      return { ejecutar: false, modoEjecutado: 'SIMULADO', directiva: 'DETENIDO', error: errorNormalizado('NO_AUTORIZADO', 'flujo detenido por degradación') };
  }
}
