/**
 * @soec/adaptadores · M4-D (neutral) · NIVEL DE ACTIVACIÓN progresiva (Eje 7). Máquina de estados
 * provider-agnóstica: `SIMULADO → SANDBOX → PILOTO → REAL`. Cada avance es UN paso adelante y representa un
 * acto humano auditado (el registro del acto vive en el ciclo de vida event-sourced del adaptador). El
 * retroceso a `SIMULADO` (kill-switch/rollback, PCE Art. 8) SIEMPRE está permitido desde cualquier nivel.
 * `AUTONOMOUS_REAL` no es un nivel: permanece bloqueado. El ALCANCE concreto del PILOTO es D-5 (inyectado);
 * aquí sólo vive la máquina. Sin red/SDK/reloj/azar.
 */
export type NivelActivacion = 'SIMULADO' | 'SANDBOX' | 'PILOTO' | 'REAL';

const ORDEN: readonly NivelActivacion[] = ['SIMULADO', 'SANDBOX', 'PILOTO', 'REAL'];

/** Avance permitido: exactamente un paso adelante, o retroceso a SIMULADO (kill-switch) desde cualquier nivel. */
export function transicionActivacionValida(desde: NivelActivacion, hacia: NivelActivacion): boolean {
  if (hacia === 'SIMULADO') return true; // kill-switch / rollback siempre permitido
  const i = ORDEN.indexOf(desde);
  const j = ORDEN.indexOf(hacia);
  return j === i + 1; // sólo un paso adelante; sin saltos
}

/** ¿El nivel habilita ejecución con datos/efectos REALES? Sólo PILOTO y REAL. SANDBOX usa datos sintéticos. */
export function nivelPermiteReal(nivel: NivelActivacion): boolean {
  return nivel === 'PILOTO' || nivel === 'REAL';
}

/**
 * Compuerta de nivel para una intención de modo. Un pedido REAL exige un nivel que lo permita (PILOTO/REAL);
 * SIMULADO se permite en cualquier nivel. No reemplaza a los gates canónicos (registro/descriptor/sandbox):
 * es una condición ADICIONAL de la activación progresiva.
 */
export function nivelPermiteModo(nivel: NivelActivacion, modoSolicitado: 'SIMULADO' | 'REAL'): { ok: boolean; motivo: string } {
  if (modoSolicitado === 'SIMULADO') return { ok: true, motivo: '' };
  if (!nivelPermiteReal(nivel)) return { ok: false, motivo: `nivel de activación ${nivel} no permite ejecución REAL (requiere PILOTO/REAL)` };
  return { ok: true, motivo: '' };
}
