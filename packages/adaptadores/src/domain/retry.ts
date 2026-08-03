/**
 * @soec/adaptadores · dominio · RETRY GOBERNADO Y BACKOFF (M4-C-B). DESHABILITADO por defecto, `jitter=false`
 * (determinismo). NUNCA reintenta INVALIDO/NO_AUTORIZADO/CANCELADO, ni tras revocación/expiración. La
 * cancelación detiene todo. Función pura que decide si reintentar y cuánto esperar; no ejecuta nada.
 */
import type { ClaseErrorAdaptador } from './errores-normalizados';
import type { PoliticaRetry } from './operativo-tipos';

const NUNCA_REINTENTABLES: ReadonlySet<ClaseErrorAdaptador> = new Set(['INVALIDO', 'NO_AUTORIZADO', 'CANCELADO']);

export const RETRY_DESHABILITADO: PoliticaRetry = {
  habilitado: false,
  maxIntentos: 1,
  erroresReintentables: [],
  backoff: 'FIJO',
  baseMs: 0,
  jitter: false,
  version: '1',
};

export interface DecisionRetry {
  readonly reintentar: boolean;
  readonly esperaMs: number;
  readonly motivo: string;
}

/** `intentoActual` es 1-based (1 = primer intento ya ejecutado). */
export function decidirRetry(politica: PoliticaRetry, intentoActual: number, error: ClaseErrorAdaptador): DecisionRetry {
  if (!politica.habilitado) return { reintentar: false, esperaMs: 0, motivo: 'retry deshabilitado' };
  if (NUNCA_REINTENTABLES.has(error)) return { reintentar: false, esperaMs: 0, motivo: `${error} no es reintentable` };
  if (!politica.erroresReintentables.includes(error)) return { reintentar: false, esperaMs: 0, motivo: `${error} no está en la política` };
  if (intentoActual >= politica.maxIntentos) return { reintentar: false, esperaMs: 0, motivo: 'máximo de intentos alcanzado' };
  const esperaMs = politica.backoff === 'EXPONENCIAL' ? politica.baseMs * 2 ** (intentoActual - 1) : politica.baseMs;
  return { reintentar: true, esperaMs, motivo: '' };
}
