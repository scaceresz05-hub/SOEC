import { SoecError } from '@soec/contracts';

/** La medición solicitada no existe. */
export class MedicionNoEncontradaError extends SoecError {}
/** La optimización solicitada no existe. */
export class OptimizacionNoEncontradaError extends SoecError {}
/** La optimización no está en un estado que permita la operación. */
export class OptimizacionNoOperableError extends SoecError {}
/** Falta un dato obligatorio en un comando de medición. */
export class ComandoMedicionInvalidoError extends SoecError {}
