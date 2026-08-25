/**
 * apps/api · campana · DISPONIBILIDAD DE CANALES (PURA). Separa PLANIFICACIÓN de EJECUCIÓN.
 *
 * Un canal puede PLANIFICARSE (SOEC diseña la campaña) aunque NO pueda EJECUTARSE (el proveedor no puede
 * publicar todavía: verificación de anunciante pendiente, OAuth faltante, cuenta pausada, sin conectar…).
 * Modelar ambas dimensiones evita el falso `available=true` único.
 */
import type { CanalId } from './marketing-plan';

/** Gates externos REALES (no inventar): estado que impide EJECUTAR aunque se pueda PLANIFICAR. */
export type ExternalGate =
  | 'READY'
  | 'ADVERTISER_VERIFICATION_PENDING'
  | 'OAUTH_REQUIRED'
  | 'ACCOUNT_PAUSED'
  | 'PROVIDER_NOT_CONNECTED'
  | 'PROVIDER_POLICY_BLOCKED'
  | 'UNKNOWN';

export interface ChannelAvailability {
  readonly canal: CanalId;
  readonly canPlan: boolean;
  readonly canExecute: boolean;
  readonly executionGate: ExternalGate;
}

export interface EntradaDisponibilidad {
  readonly canal: CanalId;
  /** ¿SOEC puede DISEÑAR una campaña para este canal? (p.ej. Meta sin conectar ⇒ false / sólo simulación). */
  readonly planeable: boolean;
  /** Gate externo del proveedor. Sólo READY habilita ejecución real (además de la autonomía). */
  readonly gate: ExternalGate;
  /** Interruptor maestro real. Mientras sea false, NINGÚN canal puede ejecutar (dry-run/gobernado). */
  readonly autonomousReal: boolean;
}

/** Deriva planificación vs ejecución. canExecute exige: planeable + gate READY + autonomía real habilitada. */
export function evaluarDisponibilidad(e: EntradaDisponibilidad): ChannelAvailability {
  const canExecute = e.planeable && e.gate === 'READY' && e.autonomousReal;
  return { canal: e.canal, canPlan: e.planeable, canExecute, executionGate: e.gate };
}
