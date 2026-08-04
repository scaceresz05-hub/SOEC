/**
 * @soec/motor-medicion · dominio · ERRORES explícitos (nada falla en silencio).
 */
import { SoecError } from '@soec/contracts';

export class ComandoMedicionInvalidoError extends SoecError {}
export class ObservacionNoEncontradaError extends SoecError {}
export class EntradaOperacionalInvalidaError extends SoecError {}
export class AprendizajeNoAdmisibleError extends SoecError {}
