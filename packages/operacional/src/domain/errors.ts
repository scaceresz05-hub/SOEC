import { SoecError } from '@soec/contracts';

/** No existe una política válida y vigente para la acción propuesta. */
export class SinPoliticaVigenteError extends SoecError {}
/** Falta un dato obligatorio en la solicitud de acción o de política. */
export class SolicitudOperativaInvalidaError extends SoecError {}
/** No hay adaptador de canal que soporte el canal pedido. */
export class AdaptadorNoDisponibleError extends SoecError {}
/** La acción operativa solicitada no existe. */
export class AccionNoEncontradaError extends SoecError {}
/** La política solicitada no existe o no tiene versión resoluble. */
export class PoliticaNoEncontradaError extends SoecError {}
