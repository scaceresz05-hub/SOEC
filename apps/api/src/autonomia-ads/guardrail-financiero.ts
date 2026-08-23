/**
 * apps/api · GUARDRAIL FINANCIERO Google Ads (P0). PURO, READ-ONLY, sin efectos.
 *
 * Separa dos conceptos que NO son intercambiables:
 *   - GOOGLE_DAILY_BUDGET      → el presupuesto DIARIO que la persona fijó en Google Ads (acumula día a día).
 *   - HUMAN_AUTHORIZED_TOTAL_CAP → el tope TOTAL que un humano autorizó a gastar (registrado en SOEC).
 * El presupuesto diario de Google JAMÁS se trata como el tope total autorizado.
 *
 * Reglas de estado (sólo si hay cap total autorizado):
 *   ratio = gastoActual / capAutorizado ·  <80% NORMAL · [80%,100%) WARNING · >=100% CAP_REACHED
 *
 * PRECEDENCIA (Objetivo 5): CAP_REACHED PREVALECE sobre INSUFFICIENT_DATA. Si el cap autorizado se consumió,
 * SOEC no puede ocultar el problema porque haya 0 conversiones: exige DECISIÓN (pausar y diagnosticar).
 *
 * SOBERANÍA (Objetivo 10): SOEC observa/compara/alerta/recomienda/genera decisión. NUNCA ejecuta la pausa ni
 * ninguna mutación. `SOEC_AUTONOMOUS_REAL` permanece false; este módulo no lo altera.
 *
 * VERDAD (Objetivo 3): si no hay cap autorizado REGISTRADO, no se inventa uno (ni retroactivo). Se informa
 * explícitamente "No había un presupuesto total autorizado registrado en SOEC".
 */

export const UMBRAL_WARNING = 0.8;

export type EstadoPresupuesto = 'SIN_CAP_AUTORIZADO' | 'NORMAL' | 'WARNING' | 'CAP_REACHED';
export type RecomendacionGuardrail = 'NINGUNA' | 'PAUSE_AND_DIAGNOSE';
export type TipoDecisionFinanciera = 'BUDGET_CAP_REACHED' | null;

export interface EntradaGuardrail {
  /** Gasto acumulado real observado (misma moneda que el cap). */
  readonly gastoActual: number;
  /** Tope TOTAL autorizado por un humano y registrado en SOEC. `null` = no hay autorización registrada. */
  readonly capAutorizado: number | null;
  /** Contactos/conversiones reales observadas (para el guardarraíl de "cap alcanzado con 0 contactos"). */
  readonly contactosReales: number;
  /** Moneda para el mensaje (informativa). */
  readonly moneda?: string;
}

export interface ResultadoGuardrail {
  readonly estado: EstadoPresupuesto;
  readonly ratio: number | null; // gasto/cap; null si no hay cap
  readonly decisionRequerida: boolean;
  readonly recomendacion: RecomendacionGuardrail;
  readonly tipoDecision: TipoDecisionFinanciera;
  readonly mensaje: string;
}

function fmt(n: number, moneda: string): string {
  try {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: moneda, maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${Math.round(n)} ${moneda}`;
  }
}

/**
 * Evalúa el guardrail financiero. PURO. El presupuesto diario de Google NO es entrada: el cap es SIEMPRE el
 * total autorizado por el humano. Sin cap ⇒ SIN_CAP_AUTORIZADO (no se inventa nada).
 */
export function evaluarGuardrail(e: EntradaGuardrail): ResultadoGuardrail {
  const moneda = e.moneda ?? 'CLP';
  if (e.capAutorizado === null || !(e.capAutorizado > 0)) {
    return {
      estado: 'SIN_CAP_AUTORIZADO',
      ratio: null,
      decisionRequerida: false,
      recomendacion: 'NINGUNA',
      tipoDecision: null,
      mensaje: 'No había un presupuesto total autorizado registrado en SOEC.',
    };
  }
  const ratio = e.gastoActual / e.capAutorizado;
  if (ratio >= 1) {
    return {
      estado: 'CAP_REACHED',
      ratio,
      decisionRequerida: true, // PREVALECE sobre INSUFFICIENT_DATA (aunque contactosReales === 0)
      recomendacion: 'PAUSE_AND_DIAGNOSE',
      tipoDecision: 'BUDGET_CAP_REACHED',
      mensaje:
        `La campaña alcanzó el presupuesto autorizado. Presupuesto autorizado: ${fmt(e.capAutorizado, moneda)} · ` +
        `Gasto actual: ${fmt(e.gastoActual, moneda)} · Contactos reales: ${e.contactosReales}. ` +
        `Recomendación: pausar y diagnosticar la conversión antes de autorizar gasto adicional.`,
    };
  }
  if (ratio >= UMBRAL_WARNING) {
    return {
      estado: 'WARNING',
      ratio,
      decisionRequerida: false,
      recomendacion: 'NINGUNA',
      tipoDecision: null,
      mensaje: `Has utilizado ${fmt(e.gastoActual, moneda)} de los ${fmt(e.capAutorizado, moneda)} autorizados.`,
    };
  }
  return { estado: 'NORMAL', ratio, decisionRequerida: false, recomendacion: 'NINGUNA', tipoDecision: null, mensaje: '' };
}
