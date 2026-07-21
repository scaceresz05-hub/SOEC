import { SoecError } from '@soec/contracts';

/** La instancia de modelo no existe todavía (no se ha creado). */
export class ModelNotFoundError extends SoecError {}
/** Se intenta crear una instancia que ya existe. */
export class ModelAlreadyExistsError extends SoecError {}
/** Se referencia una afirmación o entidad inexistente. */
export class ReferenteInexistenteError extends SoecError {}
/** Transición de estado de afirmación no permitida. */
export class TransicionInvalidaError extends SoecError {}
/**
 * Violación de la frontera MED ╪ MDM (#11 §4, §8 de la orden):
 * un modelo no puede recibir eventos del otro ni fusionarse con él.
 */
export class ModelSeparationError extends SoecError {}
/** Dato de dominio ausente o inválido en un comando. */
export class ComandoInvalidoError extends SoecError {}
