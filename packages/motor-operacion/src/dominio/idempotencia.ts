/**
 * @soec/motor-operacion · dominio · CLAVE DE IDEMPOTENCIA de efectos (determinista).
 *
 * Un reintento TÉCNICO no puede duplicar la ejecución LÓGICA. La clave se deriva de forma estable de la
 * identidad completa del efecto: organización + orden + pieza/versión + variante/versión + capacidad +
 * intento lógico. Dos workers, un timeout+respuesta tardía o un replay producen la MISMA clave y por tanto
 * el mismo efecto lógico una sola vez.
 */
import type { RefVersionada } from './orden';

export function claveEfecto(
  organizacionId: string,
  ordenId: string,
  pieza: RefVersionada,
  variante: RefVersionada | null,
  capacidad: string,
  intentoLogico: number,
): string {
  const v = variante ? `${variante.id}@${variante.version}` : 'sin-variante';
  return `efecto:${organizacionId}:${ordenId}:${pieza.id}@${pieza.version}:${v}:${capacidad}:i${intentoLogico}`;
}

/** Identidad determinista de un trabajo de cola por orden + intento lógico (no se duplica en reintentos). */
export function trabajoId(organizacionId: string, ordenId: string, intentoLogico: number): string {
  return `trabajo:${organizacionId}:${ordenId}:i${intentoLogico}`;
}
