/**
 * @soec/motor-operacion · dominio · errores explícitos (nada falla en silencio).
 */
import { SoecError } from '@soec/contracts';

export class ComandoOperacionInvalidoError extends SoecError {}
export class OrdenNoEncontradaError extends SoecError {}
export class TransicionInvalidaError extends SoecError {}
export class TrabajoNoReclamableError extends SoecError {}
/** La operación está pausada (gate de PAUSA de @soec/control): no se programa/encola/reclama/ejecuta. */
export class OperacionPausadaError extends SoecError {}
