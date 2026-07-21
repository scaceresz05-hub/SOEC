import { SoecError } from '@soec/contracts';

/** La solicitud de operación carece de un dato obligatorio (propósito, etc.). */
export class SolicitudInvalidaError extends SoecError {}
/** No hay mecanismo autorizado que soporte la operación pedida. */
export class MecanismoNoDisponibleError extends SoecError {}
/** El producto devuelto por un mecanismo viola la soberanía (sería vinculante). */
export class SoberaniaVioladaError extends SoecError {}
/** El producto es una conclusión opaca: viola la anti-atrofia. */
export class ProductoOpacoError extends SoecError {}
/** La ejecución solicitada no existe. */
export class EjecucionNoEncontradaError extends SoecError {}
