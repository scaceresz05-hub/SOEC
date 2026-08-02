/** Errores de dominio de @soec/secretos. */
import { SoecError } from '@soec/contracts';

/** Referencia de secreto inválida o comando inválido sobre el registro de secretos. */
export class SecretoInvalidoError extends SoecError {}

/** La referencia/registro de secreto no existe (en la organización / en el adaptador). */
export class SecretoNoEncontradoError extends SoecError {}
