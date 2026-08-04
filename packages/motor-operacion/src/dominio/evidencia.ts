/**
 * @soec/motor-operacion · dominio · EVIDENCIA OPERACIONAL de primera clase (versionada, inmutable).
 *
 * Toda ejecución debe responder: qué se intentó, para qué organización, con qué pieza/variante, bajo qué
 * aprobación, con qué capacidad, cuándo, cuántos intentos, qué política, qué presupuesto (SIMULADO/
 * ESTIMADO, nunca REAL), qué resultado, qué error, qué compensación, y qué versiones estaban vigentes.
 * NUNCA almacena secretos, cuerpos sensibles, stack ni mensajes crudos de proveedores.
 */
import type { RefVersionada } from './orden';

export const EVIDENCIA_OPERACIONAL_VERSION = 1;

export type ResultadoIntento = 'EJECUTADA_SIMULADA' | 'FALLIDA_TEMPORAL' | 'FALLIDA_PERMANENTE' | 'RECHAZADA' | 'DUPLICADA' | 'COMPENSADA';

export interface EvidenciaOperacional {
  readonly version: number;
  readonly organizacionId: string;
  readonly ordenId: string;
  readonly pieza: RefVersionada;
  readonly variante: RefVersionada | null;
  readonly capacidad: string;
  readonly canalLogico: string;
  readonly intento: number;
  readonly politicaVersion: string;
  /** Presupuesto en unidades lógicas y su naturaleza (jamás REAL en modo simulado). */
  readonly presupuesto: { readonly unidades: number; readonly naturaleza: 'SIMULADO' | 'ESTIMADO' };
  readonly resultado: ResultadoIntento;
  /** Código de error normalizado (sin mensaje crudo del proveedor). */
  readonly codigoError: string | null;
  readonly compensacion: string | null;
  readonly aprobacionRef: string;
  readonly vigencia: string;
  readonly naturaleza: 'SIMULADO';
  readonly observadoEn: string;
}

/** Congela en profundidad la evidencia: inmutable en runtime (readonly no basta). */
export function blindarEvidencia(e: EvidenciaOperacional): EvidenciaOperacional {
  Object.freeze(e.pieza);
  if (e.variante) Object.freeze(e.variante);
  Object.freeze(e.presupuesto);
  return Object.freeze(e);
}
