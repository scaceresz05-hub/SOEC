/** Errores de dominio de @soec/estrategia-creativa. */
import { SoecError } from '@soec/contracts';

/** Comando inválido (control experimental, calendario, etc.). */
export class EstrategiaCreativaInvalidaError extends SoecError {}

/** Se intentó gobernar/consultar un artefacto de estrategia creativa que no existe. */
export class ArtefactoCreativoNoEncontradoError extends SoecError {}
