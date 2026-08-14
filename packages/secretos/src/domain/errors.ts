/** Errores de dominio de @soec/secretos. */
import { SoecError } from '@soec/contracts';

/** Referencia de secreto inválida o comando inválido sobre el registro de secretos. */
export class SecretoInvalidoError extends SoecError {}

/** La referencia/registro de secreto no existe (en la organización / en el adaptador). */
export class SecretoNoEncontradoError extends SoecError {}

/**
 * `usar(fn)` devolvió el propio valor en claro (caso identidad). Defensa de frontera (F-5, M4-BH):
 * el resultado de `usar` NUNCA debe ser el secreto. Sólo detecta la igualdad exacta con un string;
 * NO detecta exfiltración indirecta (objetos, codificaciones, excepciones) — eso queda como
 * responsabilidad del callback de frontera y su revisión/pruebas. El mensaje jamás contiene el valor.
 */
export class FugaDeSecretoError extends SoecError {}

/**
 * Se intentó resolver una referencia que pertenece a OTRA organización. Es la defensa multiempresa
 * del depósito de secretos: ninguna organización puede leer la credencial de otra, aunque conozca
 * su nombre lógico. El mensaje nombra organizaciones y nombres lógicos — jamás valores.
 */
export class SecretoDeOtraOrganizacionError extends SoecError {}
