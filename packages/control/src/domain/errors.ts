import { SoecError } from '@soec/contracts';

/** La decisión solicitada no existe. */
export class DecisionNoEncontradaError extends SoecError {}
/** La decisión ya fue resuelta de forma terminal. */
export class DecisionYaResueltaError extends SoecError {}
/** Falta un permiso para la operación de control solicitada. */
export class PermisoInsuficienteError extends SoecError {}
/** Falta un dato obligatorio en un comando de control. */
export class ComandoControlInvalidoError extends SoecError {}
/** El departamento está pausado: no se producen nuevos efectos ejecutables. */
export class DepartamentoPausadoError extends SoecError {}
