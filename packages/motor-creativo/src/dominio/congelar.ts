/**
 * @soec/motor-creativo · dominio · CONGELAMIENTO PROFUNDO (inmutabilidad en runtime).
 *
 * `readonly` de TypeScript no protege en runtime. Los snapshots que expone `LecturaCreativa` a M7 se
 * congelan en profundidad: cualquier intento de mutar el objeto, sus arrays u objetos anidados falla
 * (o no tiene efecto), de modo que M7 no puede alterar la evidencia, las versiones ni la trazabilidad.
 */
export function congelarProfundo<T>(valor: T): T {
  if (valor === null || typeof valor !== 'object') return valor;
  for (const v of Object.values(valor as Record<string, unknown>)) {
    if (v !== null && typeof v === 'object' && !Object.isFrozen(v)) congelarProfundo(v);
  }
  return Object.freeze(valor);
}
