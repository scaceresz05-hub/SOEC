/**
 * @soec/motor-estrategico · dominio · errores explícitos (nada falla en silencio).
 */
import { SoecError } from '@soec/contracts';

/** Comando inválido contra el motor estratégico (dato faltante, clase desconocida, etc.). */
export class ComandoEstrategicoInvalidoError extends SoecError {}

/** Se referenció una afirmación que no existe en la organización. */
export class AfirmacionNoEncontradaError extends SoecError {}

/** Se intentó enlazar hacia una afirmación inexistente o de otra organización (aislamiento). */
export class EnlaceInvalidoError extends SoecError {}
