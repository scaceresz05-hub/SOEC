/**
 * Rate limiting y backoff (F2-CHAN-01 §15). El worker no ataca repetidamente al
 * canal: respeta backoff con jitter DETERMINISTA (controlable en pruebas), conserva
 * los intentos y pausa cuando corresponde. Sin Math.random.
 */

export interface PoliticaRateLimit {
  readonly limitePorVentana: number; // 0 = sin límite local
  readonly ventanaMs: number;
  readonly baseBackoffMs: number;
  readonly maxBackoffMs: number;
}

export const RATE_LIMIT_DEFECTO: PoliticaRateLimit = {
  limitePorVentana: 0,
  ventanaMs: 60_000,
  baseBackoffMs: 1_000,
  maxBackoffMs: 30_000,
};

/**
 * Backoff exponencial con jitter DETERMINISTA derivado de la identidad del intento
 * (no aleatorio → reproducible en pruebas). `retryAfterMs` del proveedor tiene prioridad.
 */
export function backoffMs(politica: PoliticaRateLimit, intento: number, semilla: string, retryAfterMs?: number): number {
  if (retryAfterMs && retryAfterMs > 0) return Math.min(retryAfterMs, politica.maxBackoffMs);
  const exp = Math.min(politica.baseBackoffMs * 2 ** Math.max(0, intento - 1), politica.maxBackoffMs);
  // Jitter determinista: [0, base) a partir de un hash estable de la semilla+intento.
  let h = 0;
  const s = `${semilla}:${intento}`;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) % 100000;
  const jitter = (h % Math.max(1, politica.baseBackoffMs));
  return Math.min(exp + jitter, politica.maxBackoffMs);
}
