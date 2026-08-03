/**
 * @soec/motor-creativo · dominio · errores explícitos (nada falla en silencio).
 */
import { SoecError } from '@soec/contracts';

/** Comando inválido contra el motor creativo (dato faltante, tipo desconocido, etc.). */
export class ComandoCreativoInvalidoError extends SoecError {}

/** Se referenció una entidad creativa (contexto/territorio) que no existe en la organización. */
export class EntidadCreativaNoEncontradaError extends SoecError {}
