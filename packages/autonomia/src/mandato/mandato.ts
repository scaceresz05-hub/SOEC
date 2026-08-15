/**
 * @soec/autonomia · mandato · MODELO DE MANDATO DE AUTONOMÍA (por organización).
 *
 * La autonomía NO es global de SOEC: pertenece a `organizationId + businessKey + externalAccountId`.
 * El mandato es el contrato explícito que un humano otorga: qué nivel, qué acciones, con qué límites
 * financieros, de velocidad, de evidencia y de reversión, y hasta cuándo. Todo lo ausente NO se
 * infiere: si un límite requerido falta, la acción se DENIEGA (fail-closed).
 */
import type { TipoAccion } from './acciones';

export type NivelAutonomia =
  /** Observa, aprende, informa. Nunca propone ejecución. */
  | 'LEVEL_0_OBSERVE'
  /** Observa, analiza, recomienda. El usuario ejecuta por su cuenta. */
  | 'LEVEL_1_RECOMMEND'
  /** Decide, prepara, simula y espera aprobación humana por cambio. */
  | 'LEVEL_2_APPROVAL_REQUIRED'
  /** Puede ejecutar sin aprobación individual, PERO sólo dentro del mandato. */
  | 'LEVEL_3_AUTONOMOUS';

export const NIVELES: readonly NivelAutonomia[] = [
  'LEVEL_0_OBSERVE',
  'LEVEL_1_RECOMMEND',
  'LEVEL_2_APPROVAL_REQUIRED',
  'LEVEL_3_AUTONOMOUS',
];

/** Sólo LEVEL_3 puede ejecutar sin aprobación individual. */
export function nivelPermiteEjecucionAutonoma(n: NivelAutonomia): boolean {
  return n === 'LEVEL_3_AUTONOMOUS';
}

/** Límites financieros DUROS. Ausencia ≠ infinito: la ausencia de un límite requerido deniega. */
export interface LimitesFinancieros {
  readonly maxDailySpend?: number;
  readonly maxMonthlySpend?: number;
  readonly maxDailySpendIncreasePercent?: number;
  readonly maxMonthlySpendIncreasePercent?: number;
  readonly maxSingleChangeAmount?: number;
  readonly maxReallocationPercent?: number;
}

/** Límites de velocidad de cambio: SOEC no puede tocar una campaña sin parar. */
export interface LimitesCambio {
  readonly maxChangesPerHour?: number;
  readonly maxChangesPerDay?: number;
  readonly maxChangesPerCampaignPerDay?: number;
  readonly cooldownAfterChangeMinutes?: number;
  readonly cooldownAfterRollbackMinutes?: number;
  readonly minObservationWindowHours?: number;
}

/** Evidencia mínima para actuar. Una sola observación (0 clics, 1 venta) nunca basta. */
export interface PoliticaEvidencia {
  readonly muestraMinima: number;
  readonly ventanaMinimaHoras: number;
  readonly confianzaMinima?: number; // 0..1
  readonly exigeRelevanciaConocida?: boolean;
}

export interface PoliticaRollback {
  /** Si toda mutación exige un plan de reversión previo. */
  readonly exigirParaMutaciones: boolean;
  readonly ventanaMedicionHoras: number;
}

export interface PoliticaMedicion {
  readonly ventanaHoras: number;
  readonly metricaObjetivo: string;
}

/** Interruptores de emergencia. `true` = habilitado; `false` = corta toda ejecución real. */
export interface InterruptoresSeguridad {
  readonly global: boolean;
  readonly organizacion: boolean;
  readonly cuentaExterna: boolean;
}

/** Interruptores todos habilitados (permiten). El default operativo hoy: todos OFF por seguridad. */
export const INTERRUPTORES_TODOS_ON: InterruptoresSeguridad = { global: true, organizacion: true, cuentaExterna: true };
export const INTERRUPTORES_TODOS_OFF: InterruptoresSeguridad = { global: false, organizacion: false, cuentaExterna: false };

export type EstadoMandato = 'ACTIVE' | 'PAUSED' | 'REVOKED' | 'EXPIRED';

export interface MandatoAutonomia {
  readonly organizationId: string;
  readonly businessKey: string;
  readonly externalAccountId: string;
  /**
   * Canal al que aplica este mandato (clave opaca, p. ej. 'META_INSTAGRAM', 'GOOGLE_SEARCH').
   * Opcional por compatibilidad: los mandatos existentes (Google Ads) lo omiten. Permite políticas
   * independientes por canal sin crear un mandato paralelo. La resolución por canal es fail-closed.
   */
  readonly canal?: string;
  readonly nivel: NivelAutonomia;
  readonly accionesPermitidas: readonly TipoAccion[];
  readonly accionesRequierenAprobacion: readonly TipoAccion[];
  readonly accionesProhibidas: readonly TipoAccion[];
  readonly limitesFinancieros: LimitesFinancieros;
  readonly limitesCambio: LimitesCambio;
  readonly politicaEvidencia: PoliticaEvidencia;
  readonly politicaRollback: PoliticaRollback;
  readonly politicaMedicion: PoliticaMedicion;
  readonly validFrom: string; // ISO-8601 UTC
  readonly validUntil: string; // ISO-8601 UTC
  readonly createdBy: string;
  readonly approvedBy: string | null;
  readonly approvedAt: string | null;
  readonly status: EstadoMandato;
  readonly version: number;
}

/** Clasificación de una acción según el mandato. */
export type ClaseAccionMandato = 'AUTONOMOUS' | 'APPROVAL_REQUIRED' | 'FORBIDDEN' | 'NOT_IN_MANDATE';

export function clasificarAccion(mandato: MandatoAutonomia, tipo: TipoAccion): ClaseAccionMandato {
  if (mandato.accionesProhibidas.includes(tipo)) return 'FORBIDDEN';
  if (mandato.accionesRequierenAprobacion.includes(tipo)) return 'APPROVAL_REQUIRED';
  if (mandato.accionesPermitidas.includes(tipo)) return 'AUTONOMOUS';
  return 'NOT_IN_MANDATE';
}
