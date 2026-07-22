/**
 * Modos de publicación (F2-CHAN-01 §2). El modo es VISIBLE y PERSISTIDO; no depende
 * de una variable ambiental informal. Tres modos:
 *  - `simulado`: no llama a ningún proveedor (pruebas locales).
 *  - `sandbox`: llama a un proveedor externo emulado o de prueba, no público.
 *  - `real_desactivado`: contemplado por la arquitectura, pero BLOQUEADO por
 *    configuración, política y guardarraíl hasta autorización externa explícita.
 * No existe modo `real` activable en este bloque: un efecto público real es causal de parada.
 */
export type ModoPublicacion = 'simulado' | 'sandbox' | 'real_desactivado';

/** Modos que pueden proceder a un envío en este bloque (el real permanece bloqueado). */
export function modoHabilitado(modo: ModoPublicacion): boolean {
  return modo === 'simulado' || modo === 'sandbox';
}

/** Un efecto público real nunca se autoriza aquí: el modo real está desactivado por guardarraíl. */
export function esModoBloqueado(modo: ModoPublicacion): boolean {
  return modo === 'real_desactivado';
}
