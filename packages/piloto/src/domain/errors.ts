import { SoecError } from '@soec/contracts';

/** La organización piloto no existe. */
export class OrganizacionNoEncontradaError extends SoecError {}
/** El expediente de piloto no existe. */
export class ExpedienteNoEncontradoError extends SoecError {}
/** Falta un dato obligatorio en un comando de preparación de piloto. */
export class ComandoPilotoInvalidoError extends SoecError {}
/** La activación real está prohibida en este bloque (guardarraíl); falta autorización estratégica. */
export class ActivacionRealProhibidaError extends SoecError {}
/** El entorno real no puede habilitarse durante F2-PILOT-01. */
export class EntornoRealBloqueadoError extends SoecError {}
