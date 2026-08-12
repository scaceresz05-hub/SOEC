/**
 * @soec/secretos · adaptador de FRONTERA · SecretStore por ENTORNO (productivo mínimo — M4-C).
 *
 * Resuelve referencias `env:NOMBRE` contra un mapa de ENTORNO INYECTADO (la capa de composición pasa
 * `process.env`). El paquete NO lee `process` directamente: así preserva el guardarraíl de neutralidad F-2
 * de @soec/secretos (sin red/entorno/reloj/aleatoriedad en el código del paquete). El valor del secreto sólo
 * se entrega dentro de la caja opaca `SecretoResuelto.usar`; se preserva `secretRef != secretValue`.
 *
 * Hereda el estándar de redacción de `SecretStoreEnMemoria`: toString/toJSON/inspect no revelan nada.
 */
import type { RequestContext } from '@soec/contracts';
import { esReferenciaSecreto } from '@soec/plataforma-capacidades';
import type { SecretStore } from '../port/secret-store';
import { SecretoResuelto } from '../domain/secreto-resuelto';
import { SecretoInvalidoError, SecretoNoEncontradoError } from '../domain/errors';

const PREFIJO_ENV = 'env:';

export class SecretStoreEnv implements SecretStore {
  readonly nombre = 'env';

  // El entorno se INYECTA (la capa de composición pasa `process.env`). El paquete no referencia `process`.
  constructor(private readonly env: Readonly<Record<string, string | undefined>>) {}

  async resolver(_ctx: RequestContext, secretRef: string): Promise<SecretoResuelto> {
    if (!esReferenciaSecreto(secretRef)) throw new SecretoInvalidoError(`secretRef inválida (no es una referencia opaca): ${secretRef}`);
    if (!secretRef.startsWith(PREFIJO_ENV)) throw new SecretoInvalidoError(`SecretStoreEnv sólo resuelve referencias 'env:NOMBRE'`);
    const nombre = secretRef.slice(PREFIJO_ENV.length);
    if (!nombre) throw new SecretoInvalidoError('referencia env sin nombre de variable');
    const valor = this.env[nombre];
    if (valor === undefined || valor === '') throw new SecretoNoEncontradoError(`variable de entorno ausente para ${secretRef}`);
    return new SecretoResuelto(secretRef, valor);
  }

  toString(): string { return 'SecretStoreEnv(env · [REDACTED])'; }
  toJSON(): { readonly nombre: string; readonly fuente: '[REDACTED]' } { return { nombre: this.nombre, fuente: '[REDACTED]' }; }
  [Symbol.for('nodejs.util.inspect.custom')](): string { return this.toString(); }
}
