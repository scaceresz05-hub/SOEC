/**
 * apps/api · ÚNICO boundary hacia el SDK oficial de AWS (`@aws-sdk/client-kms`). El dominio (`aws-kms.ts`)
 * no importa el SDK directamente. Aplica timeout (AbortSignal) + reintentos acotados (maxAttempts) y traduce
 * los errores del SDK a los errores tipados de `aws-kms.ts` SIN filtrar request/response crudos ni credenciales.
 *
 * Credenciales: NO se pasan por argumento — el `KMSClient` usa la cadena oficial de resolución del SDK
 * (env AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY, roles, etc.). Cripto oficial de AWS: sin SigV4 manual.
 */

import { DecryptCommand, DescribeKeyCommand, EncryptCommand, KMSClient, ReEncryptCommand } from '@aws-sdk/client-kms';
import {
  AwsKmsAutenticacionError,
  AwsKmsCifradoError,
  AwsKmsDescifradoError,
  AwsKmsError,
  AwsKmsKeyNoEncontradaError,
  AwsKmsNoDisponibleError,
  AwsKmsPermisoError,
  AwsKmsRespuestaInvalidaError,
  AwsKmsTimeoutError,
  type ClienteKms,
  type ClienteKmsReEncrypt,
  type ConfigAwsKms,
  type EntradaDecrypt,
  type EntradaEncrypt,
  type SalidaDecrypt,
  type SalidaEncrypt,
  type SaludKey,
} from './aws-kms';

type Op = 'encrypt' | 'decrypt' | 'describeKey' | 'reEncrypt';

function nombreError(e: unknown): string {
  if (e && typeof e === 'object' && 'name' in e && typeof (e as { name?: unknown }).name === 'string') return (e as { name: string }).name;
  return '';
}
function httpStatus(e: unknown): number | undefined {
  const meta = (e as { $metadata?: { httpStatusCode?: number } })?.$metadata;
  return meta?.httpStatusCode;
}

/** Nombres de error del SDK que indican credencial/firma inválida (auth), no permiso IAM. */
const ERRORES_AUTH = new Set<string>([
  'UnrecognizedClientException',
  'InvalidSignatureException',
  'IncompleteSignatureException', // firma incompleta: típicamente credencial mal formada (p. ej. espacio/newline)
  'SignatureDoesNotMatch',
  'MissingAuthenticationTokenException',
  'AuthorizationHeaderMalformed',
  'ExpiredTokenException',
  'CredentialsProviderError',
  'InvalidClientTokenId',
]);

/** Traduce el error del SDK a un error tipado, sin exponer detalles crudos. Exportado para tests. */
export function traducirErrorSdk(e: unknown, op: Op): AwsKmsError {
  const n = nombreError(e);
  const status = httpStatus(e);
  if (n === 'AbortError' || n === 'TimeoutError') return new AwsKmsTimeoutError(`AWS KMS timeout en ${op}`);
  if (n === 'AccessDeniedException') return new AwsKmsPermisoError(`AWS KMS acceso denegado en ${op} (falta permiso IAM)`);
  if (n === 'NotFoundException') return new AwsKmsKeyNoEncontradaError(`AWS KMS key no encontrada en ${op}`);
  if (ERRORES_AUTH.has(n)) return new AwsKmsAutenticacionError(`AWS KMS autenticación fallida en ${op}`);
  if (n === 'InvalidCiphertextException' || n === 'IncorrectKeyException') return new AwsKmsDescifradoError(`AWS KMS descifrado rechazado en ${op}`);
  if (n === 'ThrottlingException' || n === 'KMSInternalException' || n === 'KeyUnavailableException' || n === 'DependencyTimeoutException' || n === 'KMSInvalidStateException' || n === 'DisabledException')
    return new AwsKmsNoDisponibleError(`AWS KMS no disponible en ${op} (${n})`);
  if (status !== undefined && status >= 500) return new AwsKmsNoDisponibleError(`AWS KMS 5xx en ${op}`);
  if (op === 'encrypt') return new AwsKmsCifradoError(`AWS KMS Encrypt falló en ${op}`);
  if (op === 'decrypt') return new AwsKmsDescifradoError(`AWS KMS Decrypt falló en ${op}`);
  return new AwsKmsRespuestaInvalidaError(`AWS KMS respuesta inesperada en ${op}`);
}

function aBuffer(u: Uint8Array | undefined): Buffer | null {
  return u && u.byteLength > 0 ? Buffer.from(u) : null;
}

/** Cliente productivo de AWS KMS. `esProductivo=true`. */
export class ClienteKmsSdk implements ClienteKms, ClienteKmsReEncrypt {
  readonly esProductivo = true;
  private readonly client: KMSClient;

  constructor(private readonly cfg: ConfigAwsKms) {
    // Sin credenciales por argumento: el SDK las resuelve por su cadena oficial.
    this.client = new KMSClient({ region: cfg.region, maxAttempts: cfg.maxAttempts });
  }

  private signal(): AbortSignal {
    return AbortSignal.timeout(this.cfg.timeoutMs);
  }

  async encrypt(e: EntradaEncrypt): Promise<SalidaEncrypt> {
    try {
      const out = await this.client.send(
        new EncryptCommand({ KeyId: e.keyId, Plaintext: e.plaintext, EncryptionContext: { ...e.encryptionContext } }),
        { abortSignal: this.signal() },
      );
      const blob = aBuffer(out.CiphertextBlob);
      if (blob === null) throw new AwsKmsRespuestaInvalidaError('Encrypt sin CiphertextBlob');
      return { ciphertextBlob: blob, keyId: out.KeyId ?? e.keyId };
    } catch (err) {
      if (err instanceof AwsKmsError) throw err;
      throw traducirErrorSdk(err, 'encrypt');
    }
  }

  async decrypt(e: EntradaDecrypt): Promise<SalidaDecrypt> {
    try {
      const out = await this.client.send(
        // KeyId explícito ⇒ no se permite decrypt implícito contra cualquier key.
        new DecryptCommand({ KeyId: e.keyId, CiphertextBlob: e.ciphertextBlob, EncryptionContext: { ...e.encryptionContext } }),
        { abortSignal: this.signal() },
      );
      const pt = aBuffer(out.Plaintext);
      if (pt === null) throw new AwsKmsRespuestaInvalidaError('Decrypt sin Plaintext');
      return { plaintext: pt, keyId: out.KeyId ?? e.keyId };
    } catch (err) {
      if (err instanceof AwsKmsError) throw err;
      throw traducirErrorSdk(err, 'decrypt');
    }
  }

  async describeKey(keyId: string): Promise<SaludKey> {
    try {
      const out = await this.client.send(new DescribeKeyCommand({ KeyId: keyId }), { abortSignal: this.signal() });
      const md = out.KeyMetadata;
      if (!md || typeof md.KeyId !== 'string') throw new AwsKmsRespuestaInvalidaError('DescribeKey sin KeyMetadata');
      return { keyId: md.KeyId, enabled: md.Enabled === true && md.KeyState === 'Enabled' };
    } catch (err) {
      if (err instanceof AwsKmsError) throw err;
      throw traducirErrorSdk(err, 'describeKey');
    }
  }

  async reEncrypt(e: { origenBlob: Buffer; keyIdDestino: string; encryptionContext: Readonly<Record<string, string>> }): Promise<SalidaEncrypt> {
    try {
      const out = await this.client.send(
        new ReEncryptCommand({
          CiphertextBlob: e.origenBlob,
          DestinationKeyId: e.keyIdDestino,
          SourceEncryptionContext: { ...e.encryptionContext },
          DestinationEncryptionContext: { ...e.encryptionContext },
        }),
        { abortSignal: this.signal() },
      );
      const blob = aBuffer(out.CiphertextBlob);
      if (blob === null) throw new AwsKmsRespuestaInvalidaError('ReEncrypt sin CiphertextBlob');
      return { ciphertextBlob: blob, keyId: out.KeyId ?? e.keyIdDestino };
    } catch (err) {
      if (err instanceof AwsKmsError) throw err;
      throw traducirErrorSdk(err, 'reEncrypt');
    }
  }
}
