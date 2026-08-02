/**
 * @soec/secretos · dominio · SECRETO RESUELTO (M4-B, Art. 4 de la Directiva PCE).
 *
 * Holder OPACO del valor de un secreto. El valor sólo lo produce el adaptador de FRONTERA y sólo se accede
 * dentro de `usar(fn)`; NUNCA se devuelve como string al dominio, ni se serializa, ni se registra. Toda
 * representación (toString/toJSON/inspect) está REDACTADA. El dominio recibe, a lo sumo, esta caja opaca —
 * jamás el valor. Campo privado (`#valor`) para que no sea enumerable ni serializable.
 */
import { FugaDeSecretoError } from './errors';

export class SecretoResuelto {
  readonly #valor: string;
  /** La referencia (segura para registrar/loggear). El VALOR nunca se expone. */
  readonly secretRef: string;

  constructor(secretRef: string, valor: string) {
    this.secretRef = secretRef;
    this.#valor = valor;
  }

  /**
   * ÚNICA vía de acceso al valor: se entrega a la función `fn` (código de frontera) y se devuelve su
   * resultado NO secreto. El valor no escapa de este ámbito. No copiar ni retornar el valor desde `fn`.
   */
  usar<T>(fn: (valor: string) => T): T {
    const resultado = fn(this.#valor);
    // Defensa de frontera (F-5): rechaza el caso identidad — devolver el propio secreto en claro.
    // Sólo cubre la igualdad exacta con un string; NO detecta exfiltración indirecta (objetos,
    // codificaciones, excepciones): eso es responsabilidad del callback de frontera y su revisión.
    if (typeof resultado === 'string' && resultado === this.#valor) {
      throw new FugaDeSecretoError('usar(fn) devolvió el propio valor en claro: el resultado nunca debe ser el secreto');
    }
    return resultado;
  }

  toString(): string {
    return `[SecretoResuelto ${this.secretRef} · valor REDACTADO]`;
  }

  toJSON(): { readonly secretRef: string; readonly valor: '[REDACTADO]' } {
    return { secretRef: this.secretRef, valor: '[REDACTADO]' };
  }

  /** Redacción también en console.log/util.inspect de Node. */
  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return this.toString();
  }
}
