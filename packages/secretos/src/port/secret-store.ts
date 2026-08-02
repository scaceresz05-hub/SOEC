/**
 * @soec/secretos · puerto · SECRET STORE (M4-B, Art. 4 de la Directiva PCE).
 *
 * Puerto NEUTRAL de resolución de secretos. `resolver` devuelve una CAJA OPACA (`SecretoResuelto`), nunca
 * el valor en claro. La resolución del valor real ocurre ÚNICAMENTE dentro del adaptador de frontera que
 * implemente este puerto (env/vault/aws-sm/… en el futuro). El DOMINIO no depende de este puerto para
 * decidir nada: sólo el código de frontera lo usa para efectuar una operación con el secreto sin verlo.
 */
import type { RequestContext } from '@soec/contracts';
import type { SecretoResuelto } from '../domain/secreto-resuelto';

export interface SecretStore {
  readonly nombre: string;
  /** Resuelve una REFERENCIA a una caja opaca. Nunca expone el valor fuera de `SecretoResuelto.usar`. */
  resolver(ctx: RequestContext, secretRef: string): Promise<SecretoResuelto>;
}
