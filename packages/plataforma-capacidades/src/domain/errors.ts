/** Errores de dominio de @soec/plataforma-capacidades. */
import { SoecError } from '@soec/contracts';

/** Comando inválido sobre una capacidad externa (ciclo de vida, activación real, referencias, etc.). */
export class CapacidadExternaInvalidaError extends SoecError {}

/** La capacidad referida no existe en la organización del contexto. */
export class CapacidadNoEncontradaError extends SoecError {}
