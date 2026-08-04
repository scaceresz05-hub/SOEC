/**
 * @soec/motor-operacion · dominio · CLAVES DE IDEMPOTENCIA (deterministas).
 *
 * Se separa el EFECTO LÓGICO del INTENTO TÉCNICO:
 *  - `claveEfecto` (lógica): identidad ESTABLE del efecto — org + orden + pieza/versión + variante/versión +
 *    capacidad. NO incluye el intento: por eso un reintento técnico, dos workers, un timeout+respuesta tardía
 *    o un replay convergen en UN SOLO efecto lógico. Distinto contenido para la misma clave ⇒ CONFLICTO.
 *  - `trabajoId` / `intentoId` (técnicos): identidad por intento; se registran aparte, no duplican el efecto.
 */
import type { RefVersionada } from './orden';

export function claveEfecto(
  organizacionId: string,
  ordenId: string,
  pieza: RefVersionada,
  variante: RefVersionada | null,
  capacidad: string,
): string {
  const v = variante ? `${variante.id}@${variante.version}` : 'sin-variante';
  return `efecto:${organizacionId}:${ordenId}:${pieza.id}@${pieza.version}:${v}:${capacidad}`;
}

/** Huella determinista del CONTENIDO del efecto (para detectar reuso de clave con contenido distinto). */
export function huellaEfecto(pieza: RefVersionada, variante: RefVersionada | null, capacidad: string): string {
  const v = variante ? `${variante.id}@${variante.version}` : '-';
  let h = 0;
  const base = `${pieza.id}@${pieza.version}|${v}|${capacidad}`;
  for (let i = 0; i < base.length; i += 1) h = (h * 131 + base.charCodeAt(i)) % 1_000_000_007;
  return `h${h.toString(16)}`;
}

/** Identidad determinista de un trabajo de cola por orden + intento TÉCNICO. */
export function trabajoId(organizacionId: string, ordenId: string, intentoTecnico: number): string {
  return `trabajo:${organizacionId}:${ordenId}:i${intentoTecnico}`;
}
