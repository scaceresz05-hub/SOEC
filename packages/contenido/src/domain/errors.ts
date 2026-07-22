import { SoecError } from '@soec/contracts';

/** El brief solicitado no existe. */
export class BriefNoEncontradoError extends SoecError {}
/** La marca solicitada no existe o no tiene versión vigente. */
export class MarcaNoEncontradaError extends SoecError {}
/** El paquete solicitado no existe. */
export class PaqueteNoEncontradoError extends SoecError {}
/** La actividad de marketing referida no requiere contenido (no está bloqueada por contenido_faltante). */
export class ActividadNoRequiereContenidoError extends SoecError {}
/** Dato obligatorio ausente en un comando de la fábrica de contenido. */
export class ComandoContenidoInvalidoError extends SoecError {}
/** El paquete no está en un estado que permita entregarlo/ejecutarlo. */
export class PaqueteNoEjecutableError extends SoecError {}
