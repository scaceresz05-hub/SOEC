/**
 * @soec/adaptadores · dominio · ERRORES NORMALIZADOS de la frontera (M4-C, Art. 9/11 de la Directiva PCE).
 *
 * Taxonomía CERRADA de fallos de un adaptador. Los fallos ESPERADOS se devuelven como resultado
 * normalizado (no como excepción); sólo los errores de programación deberían propagarse. El mensaje de un
 * error normalizado JAMÁS transporta un secreto ni un valor sensible: describe la clase del fallo, no su
 * contenido. `normalizarError` traduce cualquier excepción a esta taxonomía sin filtrar detalles peligrosos.
 */
import { SoecError } from '@soec/contracts';

export type ClaseErrorAdaptador =
  | 'TIMEOUT' // se agotó el plazo declarado
  | 'CANCELADO' // cancelación explícita (AbortSignal)
  | 'NO_DISPONIBLE' // el adaptador/servicio no respondió o no está listo
  | 'NO_AUTORIZADO' // la capacidad no es consumible / falta credencial / modo no permitido
  | 'INVALIDO' // petición mal formada o respuesta que no cumple el esquema
  | 'LIMITE' // límite de uso/cuota alcanzado
  | 'DESCONOCIDO'; // cualquier error no clasificado (fail-safe)

export interface ErrorNormalizado {
  readonly clase: ClaseErrorAdaptador;
  readonly mensaje: string;
  readonly reintentable: boolean;
}

const REINTENTABLES: ReadonlySet<ClaseErrorAdaptador> = new Set(['TIMEOUT', 'NO_DISPONIBLE', 'LIMITE']);

/** Error de programación (no de frontera): se propaga; nunca es un resultado normalizado. */
export class AdaptadorInvalidoError extends SoecError {}

export function errorNormalizado(clase: ClaseErrorAdaptador, mensaje: string): ErrorNormalizado {
  return { clase, mensaje, reintentable: REINTENTABLES.has(clase) };
}

/**
 * Traduce una excepción arbitraria a la taxonomía sin filtrar contenido sensible. Reconoce la cancelación
 * (`AbortError` / señal abortada) y, por defecto, clasifica como DESCONOCIDO con un mensaje genérico —
 * NO se copia el mensaje original de la excepción para no arrastrar datos peligrosos a logs/eventos.
 */
export function normalizarError(e: unknown, razonAborto?: unknown): ErrorNormalizado {
  const nombre = e && typeof e === 'object' && 'name' in e ? String((e as { name: unknown }).name) : '';
  if (nombre === 'AbortError' || razonAborto !== undefined) {
    return razonAborto === 'timeout'
      ? errorNormalizado('TIMEOUT', 'se agotó el plazo de ejecución')
      : errorNormalizado('CANCELADO', 'ejecución cancelada');
  }
  return errorNormalizado('DESCONOCIDO', 'error no clasificado en el adaptador');
}
