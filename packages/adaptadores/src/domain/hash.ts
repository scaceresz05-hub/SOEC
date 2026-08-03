/**
 * @soec/adaptadores · dominio · HASH FNV-1a de 32 bits (determinista, sin azar). Uso: versionado/detección
 * de cambio (huella de descriptor) y seudónimo estable (minimización). NO es una firma criptográfica: una
 * colisión teórica es posible. Función pura, sin red/reloj. Único punto de verdad del algoritmo (DRY).
 */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
