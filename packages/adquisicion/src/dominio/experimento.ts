/**
 * AcquisitionExperiment + StopLossPolicy — toda campaña nueva es un experimento medible.
 *
 * Evita cambiar 5 variables a la vez sin trazabilidad: un experimento declara su hipótesis, la
 * variable cambiada, la métrica de éxito y la de guarda, ventana y muestra mínimas, tope de
 * presupuesto y stop-loss. La StopLossPolicy es POR NEGOCIO — no se fijan valores generales. Regla
 * dura: sin StopLossPolicy no hay PAID autónomo.
 */

export interface StopLossPolicy {
  readonly organizationId: string;
  readonly businessKey: string;
  readonly maxGastoSinResultado: number | null;
  readonly maxCPL: number | null;
  readonly maxCAC: number | null;
  readonly maxFrecuencia: number | null;
  readonly senalMinima: number | null;
}

export interface AcquisitionExperiment {
  readonly experimentoId: string;
  readonly organizationId: string;
  readonly hipotesis: string;
  readonly baseline: string;
  readonly variableCambiada: string;
  readonly metricaExito: string;
  readonly metricaGuarda: string;
  readonly ventanaMinimaDias: number;
  readonly muestraMinima: number;
  readonly topePresupuesto: number;
  readonly stopLoss: StopLossPolicy;
  readonly umbralExito: number;
  readonly umbralFracaso: number;
}

/**
 * ¿Puede este negocio ejecutar PAID autónomo? Sólo si existe una StopLossPolicy con al menos un
 * límite efectivo. Sin política ⇒ false (fail-closed).
 */
export function paidAutonomoPermitido(policy: StopLossPolicy | null): boolean {
  if (policy === null) return false;
  return (
    policy.maxGastoSinResultado !== null ||
    policy.maxCPL !== null ||
    policy.maxCAC !== null ||
    policy.maxFrecuencia !== null
  );
}

/** Un experimento sólo es válido si cambia UNA variable y trae hipótesis + criterios explícitos. */
export function experimentoValido(e: AcquisitionExperiment): boolean {
  return (
    e.hipotesis.trim() !== '' &&
    e.variableCambiada.trim() !== '' &&
    e.metricaExito.trim() !== '' &&
    e.metricaGuarda.trim() !== '' &&
    e.muestraMinima > 0 &&
    e.ventanaMinimaDias > 0 &&
    paidAutonomoPermitido(e.stopLoss)
  );
}
