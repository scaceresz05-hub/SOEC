/**
 * apps/api · DINERO · una sola convención para todo el sistema.
 *
 * SOEC ya tenía una forma canónica de guardar dinero, la del mandato financiero: **un entero en unidades
 * MENORES más su moneda ISO 4217** (`authorizedBudgetMinor` + `currency`). Lo que faltaba era usarla en todas
 * partes: el techo de inversión se guardaba en una columna llamada `monto_clp`, con la moneda fijada a mano.
 * Eso no es multimoneda: es una moneda escrita en el nombre de la columna.
 *
 * Aquí viven las dos únicas reglas que hacen falta para no volver a mezclarlas:
 *
 *   · cuántos decimales tiene cada moneda (el peso chileno y el yen no tienen ninguno);
 *   · cómo se pasa del número que escribe una persona al entero que se guarda, y al revés.
 *
 * NO se inventa una moneda por defecto. Una empresa sin moneda declarada no puede declarar un techo: decir
 * «1000» sin saber de qué es peor que no decir nada.
 */

/** Monedas SIN decimales (ISO 4217 exponente 0). El resto se asume de 2, que es el caso general. */
const SIN_DECIMALES: ReadonlySet<string> = new Set(['CLP', 'JPY', 'KRW', 'VND', 'ISK', 'PYG', 'UGX', 'RWF', 'XAF', 'XOF', 'XPF', 'BIF', 'DJF', 'GNF', 'KMF', 'MGA', 'VUV']);

/** Formato admisible de una moneda: ISO 4217, tres letras. */
export function monedaValida(moneda: string | null | undefined): boolean {
  return typeof moneda === 'string' && /^[A-Z]{3}$/.test(moneda.trim().toUpperCase());
}

/** Normaliza la moneda a ISO 4217 en mayúsculas. `null` si no es una moneda utilizable. */
export function normalizarMoneda(moneda: string | null | undefined): string | null {
  return monedaValida(moneda) ? String(moneda).trim().toUpperCase() : null;
}

export function decimalesDe(moneda: string): number {
  return SIN_DECIMALES.has(moneda.trim().toUpperCase()) ? 0 : 2;
}

/**
 * Del número que escribe una persona (pesos, euros…) al entero en unidades menores. `null` si no hay un
 * importe utilizable: cero y negativo NO son techos, son la ausencia de uno.
 */
export function aUnidadesMenores(monto: number | null | undefined, moneda: string): number | null {
  if (monto === null || monto === undefined || !Number.isFinite(monto) || monto <= 0) return null;
  return Math.round(monto * 10 ** decimalesDe(moneda));
}

/** Del entero en unidades menores al número que se le muestra a una persona. */
export function aUnidadesMayores(minor: number | null | undefined, moneda: string): number | null {
  if (minor === null || minor === undefined || !Number.isFinite(minor)) return null;
  return minor / 10 ** decimalesDe(moneda);
}
