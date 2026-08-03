/**
 * @soec/adaptadores · dominio · CIRCUIT BREAKER determinista y gobernado (M4-C-B). Estados CERRADO/ABIERTO/
 * SEMIABIERTO. NO usa `Date.now`: todo instante se INYECTA (ISO) y se compara con `Date.parse` (función pura
 * de su argumento). Replay reproduce el mismo estado. No es distribuido (deuda de M4-C-C). Un error funcional
 * no es un error de infraestructura: el llamador decide qué fallos alimentan el breaker.
 */
import { CIRCUIT_BREAKER_CERRADO, type EstadoCircuitBreaker, type PoliticaCircuitBreaker } from './operativo-tipos';

function msEntre(desde: string, hasta: string): number {
  return Date.parse(hasta) - Date.parse(desde);
}

/**
 * Evalúa si se permite un intento AHORA, devolviendo el estado (posiblemente transicionado de ABIERTO a
 * SEMIABIERTO tras el tiempo de reapertura). No muta la entrada.
 */
export function evaluarBreaker(estado: EstadoCircuitBreaker, politica: PoliticaCircuitBreaker, ahora: string): { permitido: boolean; estado: EstadoCircuitBreaker; motivo: string } {
  if (estado.estado === 'CERRADO') return { permitido: true, estado, motivo: '' };
  if (estado.estado === 'SEMIABIERTO') return { permitido: true, estado, motivo: '' };
  // ABIERTO: ¿pasó el tiempo de reapertura?
  if (estado.abiertoDesde !== null && msEntre(estado.abiertoDesde, ahora) >= politica.tiempoReaperturaMs) {
    return { permitido: true, estado: { ...estado, estado: 'SEMIABIERTO' }, motivo: '' };
  }
  return { permitido: false, estado, motivo: 'circuit breaker ABIERTO' };
}

/** Registra el resultado de un intento y devuelve el nuevo estado del breaker. */
export function registrarResultadoBreaker(estado: EstadoCircuitBreaker, politica: PoliticaCircuitBreaker, exito: boolean, ahora: string): EstadoCircuitBreaker {
  if (exito) return CIRCUIT_BREAKER_CERRADO; // éxito reinicia
  const fallos = estado.fallosConsecutivos + 1;
  if (estado.estado === 'SEMIABIERTO') {
    // La prueba gobernada falló → reabrir.
    return { estado: 'ABIERTO', fallosConsecutivos: fallos, abiertoDesde: ahora };
  }
  if (fallos >= politica.maxFallosConsecutivos) {
    return { estado: 'ABIERTO', fallosConsecutivos: fallos, abiertoDesde: ahora };
  }
  return { estado: 'CERRADO', fallosConsecutivos: fallos, abiertoDesde: null };
}
