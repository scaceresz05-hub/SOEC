/**
 * @soec/motor-optimizacion · dominio · ERRORES explícitos (nada falla en silencio).
 */
import { SoecError } from '@soec/contracts';

export class ComandoOptimizacionInvalidoError extends SoecError {}
export class CicloNoEncontradoError extends SoecError {}
export class PropuestaNoEncontradaError extends SoecError {}
export class AprobacionInvalidaError extends SoecError {}
export class TransicionOptimizacionInvalidaError extends SoecError {}
