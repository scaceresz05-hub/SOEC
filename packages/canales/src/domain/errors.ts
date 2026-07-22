import { SoecError } from '@soec/contracts';

/** La publicación solicitada no existe. */
export class PublicacionNoEncontradaError extends SoecError {}
/** La publicación no está en un estado que permita la operación solicitada. */
export class PublicacionNoOperableError extends SoecError {}
/** Falta un dato obligatorio en un comando del plano de canales. */
export class ComandoCanalInvalidoError extends SoecError {}
/** No hay adaptador para el canal solicitado. */
export class AdaptadorCanalNoDisponibleError extends SoecError {}
/** El modo real está desactivado por guardarraíl: un efecto público real es causal de parada. */
export class ModoRealDesactivadoError extends SoecError {}
/** La firma del webhook no es válida. */
export class WebhookInvalidoError extends SoecError {}
