import { SoecError } from '@soec/contracts';

/** El ECE solicitado no existe todavía (no se ha construido). */
export class EceNotFoundError extends SoecError {}
/** Se referencia un elemento del ECE inexistente. */
export class ElementoInexistenteError extends SoecError {}
/** Dato de dominio ausente o inválido en un comando del ECE. */
export class ComandoEceInvalidoError extends SoecError {}
