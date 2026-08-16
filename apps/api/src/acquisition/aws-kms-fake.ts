/**
 * apps/api · FakeClienteKms — SÓLO test/dev. Fiel al contrato observable de `ClienteKms` sin tocar AWS real.
 * Modela KMS con AES-256-GCM en memoria (master key efímera) y el `EncryptionContext` como AAD autenticada:
 * si el contexto de Decrypt no coincide con el de Encrypt, la autenticación GCM falla (como en KMS real).
 * `esProductivo=false` ⇒ nunca puede producir un veredicto productivo READY. Permite inyectar fallos.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import {
  AwsKmsAutenticacionError,
  AwsKmsDescifradoError,
  AwsKmsKeyNoEncontradaError,
  AwsKmsNoDisponibleError,
  AwsKmsPermisoError,
  AwsKmsRespuestaInvalidaError,
  AwsKmsTimeoutError,
  type ClienteKms,
  type ClienteKmsReEncrypt,
  type EntradaDecrypt,
  type EntradaEncrypt,
  type SalidaDecrypt,
  type SalidaEncrypt,
  type SaludKey,
} from './aws-kms';

const PREFIJO = Buffer.from('AWSKMSFAKEv1:');

export interface OpcionesFakeKms {
  readonly authFailure?: boolean;
  readonly permissionFailure?: boolean;
  readonly timeout?: boolean;
  readonly keyNotFound?: boolean;
  readonly malformedResponse?: boolean; // Encrypt devuelve blob vacío
  readonly plaintextTamanoInvalido?: boolean; // Decrypt devuelve plaintext de tamaño incorrecto
  readonly keyDisabled?: boolean; // DescribeKey ⇒ enabled=false
}

function aad(context: Readonly<Record<string, string>>): Buffer {
  const ordenado = Object.keys(context)
    .sort()
    .map((k) => `${k}=${context[k]}`)
    .join('&');
  return Buffer.from(ordenado, 'utf8');
}

export class FakeClienteKms implements ClienteKms, ClienteKmsReEncrypt {
  readonly esProductivo = false;
  private readonly masterKey = randomBytes(32);
  /** Peticiones capturadas para aserciones (qué plaintext viajó al "KMS"). */
  readonly plaintextsEnviados: Buffer[] = [];

  constructor(private readonly opts: OpcionesFakeKms = {}) {}

  private gate(): void {
    if (this.opts.timeout) throw new AwsKmsTimeoutError('timeout simulado');
    if (this.opts.authFailure) throw new AwsKmsAutenticacionError('auth simulado fallido');
    if (this.opts.permissionFailure) throw new AwsKmsPermisoError('permiso simulado denegado');
    if (this.opts.keyNotFound) throw new AwsKmsKeyNoEncontradaError('key simulada no encontrada');
  }

  async encrypt(e: EntradaEncrypt): Promise<SalidaEncrypt> {
    this.gate();
    this.plaintextsEnviados.push(Buffer.from(e.plaintext));
    if (this.opts.malformedResponse) throw new AwsKmsRespuestaInvalidaError('respuesta malformada simulada');
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.masterKey, iv);
    c.setAAD(aad(e.encryptionContext));
    const ct = Buffer.concat([c.update(e.plaintext), c.final()]);
    const blob = Buffer.concat([PREFIJO, iv, c.getAuthTag(), ct]);
    return { ciphertextBlob: blob, keyId: e.keyId };
  }

  async decrypt(e: EntradaDecrypt): Promise<SalidaDecrypt> {
    this.gate();
    if (this.opts.plaintextTamanoInvalido) return { plaintext: randomBytes(16), keyId: e.keyId };
    const b = e.ciphertextBlob;
    if (!b.subarray(0, PREFIJO.length).equals(PREFIJO)) throw new AwsKmsDescifradoError('ciphertext no reconocido');
    const cuerpo = b.subarray(PREFIJO.length);
    const iv = cuerpo.subarray(0, 12);
    const tag = cuerpo.subarray(12, 28);
    const ct = cuerpo.subarray(28);
    try {
      const d = createDecipheriv('aes-256-gcm', this.masterKey, iv);
      d.setAAD(aad(e.encryptionContext)); // AAD distinta (EncryptionContext incorrecto) ⇒ falla la autenticación
      d.setAuthTag(tag);
      const pt = Buffer.concat([d.update(ct), d.final()]);
      return { plaintext: pt, keyId: e.keyId };
    } catch {
      throw new AwsKmsDescifradoError('fallo de descifrado / EncryptionContext o key incorrectos');
    }
  }

  async describeKey(keyId: string): Promise<SaludKey> {
    this.gate();
    return { keyId, enabled: !this.opts.keyDisabled };
  }

  async reEncrypt(e: { origenBlob: Buffer; keyIdDestino: string; encryptionContext: Readonly<Record<string, string>> }): Promise<SalidaEncrypt> {
    const { plaintext } = await this.decrypt({ keyId: e.keyIdDestino, ciphertextBlob: e.origenBlob, encryptionContext: e.encryptionContext });
    return this.encrypt({ keyId: e.keyIdDestino, plaintext, encryptionContext: e.encryptionContext });
  }
}

/** Cliente que NO usa AWS pero se declara productivo — SÓLO para ejercer el camino READY en tests. */
export class ClienteKmsProductivoSimulado implements ClienteKms, ClienteKmsReEncrypt {
  readonly esProductivo = true;
  private readonly inner: FakeClienteKms;
  constructor(opts: OpcionesFakeKms = {}) {
    this.inner = new FakeClienteKms(opts);
  }
  get plaintextsEnviados(): Buffer[] {
    return this.inner.plaintextsEnviados;
  }
  encrypt(e: EntradaEncrypt): Promise<SalidaEncrypt> {
    return this.inner.encrypt(e);
  }
  decrypt(e: EntradaDecrypt): Promise<SalidaDecrypt> {
    return this.inner.decrypt(e);
  }
  describeKey(keyId: string): Promise<SaludKey> {
    return this.inner.describeKey(keyId);
  }
  reEncrypt(e: { origenBlob: Buffer; keyIdDestino: string; encryptionContext: Readonly<Record<string, string>> }): Promise<SalidaEncrypt> {
    return this.inner.reEncrypt(e);
  }
}
