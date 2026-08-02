/**
 * @soec/secretos · adaptador de FRONTERA · SecretStore EN MEMORIA (SINTÉTICO, sólo dev/test — M4-B).
 *
 * Implementa el puerto `SecretStore` con un mapa `secretRef → valor SINTÉTICO` provisto por el llamador
 * (jamás un secreto real). Es el ÚNICO lugar donde existe un valor, y sólo lo entrega dentro de la caja
 * opaca `SecretoResuelto`. Valida que la `secretRef` sea una referencia legítima (reutiliza el guardarraíl
 * de `@soec/plataforma-capacidades`). No usa red, entorno, reloj ni SDKs. Los adaptadores reales
 * (env/vault/…) llegan en tramos posteriores, en su propia frontera.
 */
import type { RequestContext } from '@soec/contracts';
import { esReferenciaSecreto } from '@soec/plataforma-capacidades';
import type { SecretStore } from '../port/secret-store';
import { SecretoResuelto } from '../domain/secreto-resuelto';
import { SecretoInvalidoError, SecretoNoEncontradoError } from '../domain/errors';

export class SecretStoreEnMemoria implements SecretStore {
  readonly nombre = 'en-memoria-sintetico';
  private readonly valores: Map<string, string>;

  /** `valoresSinteticos`: mapa secretRef → valor de PRUEBA. Nunca un secreto real. */
  constructor(valoresSinteticos: Readonly<Record<string, string>> = {}) {
    this.valores = new Map(Object.entries(valoresSinteticos));
  }

  async resolver(_ctx: RequestContext, secretRef: string): Promise<SecretoResuelto> {
    if (!esReferenciaSecreto(secretRef)) throw new SecretoInvalidoError(`secretRef inválida (no es una referencia opaca): ${secretRef}`);
    const valor = this.valores.get(secretRef);
    if (valor === undefined) throw new SecretoNoEncontradoError(`no hay valor (sintético) para ${secretRef}`);
    return new SecretoResuelto(secretRef, valor);
  }
}
