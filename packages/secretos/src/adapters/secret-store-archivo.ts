/**
 * @soec/secretos · adaptador de FRONTERA · DEPÓSITO LOCAL DE SECRETOS POR ORGANIZACIÓN.
 *
 * Resuelve referencias `file:<organizationId>/<nombre-logico>` contra un depósito local que la
 * PERSONA propietaria rellena a mano, fuera del repositorio y fuera del alcance de SOEC.
 *
 * Por qué existe: incorporar credenciales de una organización real (WooCommerce de C Y P) exige un
 * lugar donde depositarlas que no sea el código, ni un commit, ni un log, ni el chat.
 *
 * GARANTÍAS:
 *  1. **Multiempresa por construcción.** La organización viaja EN la referencia y se compara con la
 *     del `RequestContext` y con la del propio depósito. Tres coincidencias o se lanza. Ninguna
 *     organización puede leer la credencial de otra aunque conozca su nombre lógico.
 *  2. **Sin fallback.** Depósito ausente, nombre ausente o valor vacío ⇒ `SecretoNoEncontradoError`.
 *     Jamás se cae en otra organización, ni en variables de entorno, ni en un valor por defecto.
 *  3. **El valor nunca sale.** Se devuelve dentro de `SecretoResuelto`, cuya representación
 *     (`toString`/`toJSON`/`inspect`) está REDACTADA. El paquete no imprime, no registra, no serializa.
 *  4. **Neutral.** No toca `node:fs` ni `process.env`: el lector se INYECTA desde la composición.
 */
import type { RequestContext } from '@soec/contracts';
import { esReferenciaSecreto } from '@soec/plataforma-capacidades';
import type { SecretStore } from '../port/secret-store';
import { SecretoResuelto } from '../domain/secreto-resuelto';
import {
  SecretoDeOtraOrganizacionError,
  SecretoInvalidoError,
  SecretoNoEncontradoError,
} from '../domain/errors';

const PREFIJO = 'file:';

/**
 * Lee el depósito de UNA organización y devuelve sus pares `nombreLógico → valor`.
 * `null` cuando el depósito no existe todavía (la persona aún no lo creó).
 * La implementación real vive en la capa de composición (es la única que toca el sistema de archivos).
 */
export type LectorDeDeposito = (organizationId: string) => Readonly<Record<string, string>> | null;

/** Nombre lógico admisible: minúsculas, dígitos y guiones. Nunca puede parecerse a un secreto. */
const NOMBRE_LOGICO = /^[a-z0-9][a-z0-9-]{1,80}$/;

export interface ReferenciaLocal {
  readonly organizationId: string;
  readonly nombreLogico: string;
}

/** Descompone `file:<org>/<nombre>`. Lanza si la forma no es exactamente esa. */
export function interpretarReferenciaLocal(secretRef: string): ReferenciaLocal {
  if (!esReferenciaSecreto(secretRef)) {
    throw new SecretoInvalidoError('secretRef inválida (no es una referencia opaca)');
  }
  if (!secretRef.startsWith(PREFIJO)) {
    throw new SecretoInvalidoError(
      `el depósito local sólo resuelve referencias '${PREFIJO}<org>/<nombre>'`,
    );
  }
  const resto = secretRef.slice(PREFIJO.length);
  const barra = resto.indexOf('/');
  if (barra <= 0 || barra === resto.length - 1) {
    throw new SecretoInvalidoError(
      `referencia local mal formada: se espera '${PREFIJO}<org>/<nombre-logico>'`,
    );
  }
  const organizationId = resto.slice(0, barra);
  const nombreLogico = resto.slice(barra + 1);
  if (!NOMBRE_LOGICO.test(nombreLogico)) {
    throw new SecretoInvalidoError(
      'el nombre lógico del secreto debe ser minúsculas/dígitos/guiones',
    );
  }
  return { organizationId, nombreLogico };
}

export class SecretStoreArchivo implements SecretStore {
  readonly nombre = 'deposito-local';

  /**
   * @param organizationId organización a la que sirve ESTA instancia. Una instancia = un tenant.
   * @param leerDeposito   lector inyectado (la composición aporta el acceso al sistema de archivos).
   */
  constructor(
    private readonly organizationId: string,
    private readonly leerDeposito: LectorDeDeposito,
  ) {
    if (!organizationId?.trim()) {
      throw new SecretoInvalidoError('el depósito local exige una organización');
    }
  }

  async resolver(ctx: RequestContext, secretRef: string): Promise<SecretoResuelto> {
    const ref = interpretarReferenciaLocal(secretRef);
    const delContexto = String(ctx.organizationId);

    // Triple coincidencia: contexto ≡ instancia ≡ referencia. Cualquier discrepancia es un intento
    // de cruce de tenant y se rechaza ANTES de tocar el depósito.
    if (delContexto !== this.organizationId || ref.organizationId !== this.organizationId) {
      throw new SecretoDeOtraOrganizacionError(
        `la referencia '${ref.organizationId}/${ref.nombreLogico}' no pertenece a la organización ` +
          `'${this.organizationId}' (contexto: '${delContexto}')`,
      );
    }

    const deposito = this.leerDeposito(this.organizationId);
    if (deposito === null) {
      throw new SecretoNoEncontradoError(
        `no existe depósito de secretos para la organización '${this.organizationId}': ` +
          'la credencial debe depositarla una persona; SOEC no la busca ni la deduce',
      );
    }
    const valor = deposito[ref.nombreLogico];
    if (valor === undefined || valor.trim() === '') {
      throw new SecretoNoEncontradoError(
        `el depósito de '${this.organizationId}' no declara '${ref.nombreLogico}'`,
      );
    }
    return new SecretoResuelto(secretRef, valor);
  }

  toString(): string {
    return `SecretStoreArchivo(${this.organizationId} · [REDACTED])`;
  }
  toJSON(): {
    readonly nombre: string;
    readonly organizationId: string;
    readonly deposito: '[REDACTED]';
  } {
    return { nombre: this.nombre, organizationId: this.organizationId, deposito: '[REDACTED]' };
  }
  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return this.toString();
  }
}
