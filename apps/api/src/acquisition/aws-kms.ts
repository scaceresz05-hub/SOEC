/**
 * apps/api · Adaptador PRODUCTIVO `KmsPort` sobre AWS KMS (envelope encryption).
 *
 * Backend productivo ELEGIDO para SOEC. HCP Vault Transit (`meta-vault-transit.ts`) se CONSERVA como adapter
 * alternativo. El diseño envelope NO cambia: `EnvelopeSecretBackend` cifra el token OAuth localmente con
 * AES-256-GCM usando una DATA KEY aleatoria de 32 bytes; SÓLO esa data key viaja a AWS KMS (Encrypt/Decrypt).
 *
 *   token OAuth efímero → AES-256-GCM local con DATA KEY → ciphertext persistido tenant-scoped en SOEC
 *   DATA KEY (32 bytes) → KMS Encrypt → CiphertextBlob → guardado como wrappedDataKey
 *   resolver: wrappedDataKey → KMS Decrypt → DATA KEY → descifrado local → token → uso → descarte
 *
 * INVARIANTE ABSOLUTO: el TOKEN META JAMÁS viaja a AWS KMS — sólo la data key de 32 bytes.
 * EncryptionContext fijo `{app:soec, purpose:envelope-data-key}` (AAD autenticada) en Encrypt y Decrypt.
 * `KeyId` explícito también en Decrypt (no se permite decrypt implícito contra cualquier key).
 * Credenciales: NUNCA se pasan por el dominio; el SDK usa su cadena oficial de resolución. Fail-closed.
 * Cripto oficial de AWS (SDK) — sin SigV4 manual, sin HTTP manual, sin cripto propia sustituyendo a KMS.
 */

import type { KmsPort, SaludBackend } from './meta-secret-backend';
import { redactarSecretos } from './meta-organic';

/** Tamaño exacto de la data key del diseño envelope (`EnvelopeSecretBackend`). */
export const TAMANO_DATA_KEY = 32;

/** EncryptionContext fijo (AAD autenticada). No contiene secretos ni PII. */
export const ENCRYPTION_CONTEXT: Readonly<Record<string, string>> = Object.freeze({ app: 'soec', purpose: 'envelope-data-key' });

// ---------------------------------------------------------------------------
// Errores tipados — sanitizados; jamás llevan credenciales/plaintext/blob/token
// ---------------------------------------------------------------------------

export class AwsKmsError extends Error {
  constructor(mensaje: string) {
    super(redactarSecretos(mensaje));
    this.name = new.target.name;
  }
}
export class AwsKmsConfiguracionError extends AwsKmsError {}
export class AwsKmsAutenticacionError extends AwsKmsError {} // credenciales inválidas/ausentes
export class AwsKmsPermisoError extends AwsKmsError {} // AccessDenied (falta kms:Encrypt/Decrypt/DescribeKey)
export class AwsKmsNoDisponibleError extends AwsKmsError {} // red / 5xx / throttling
export class AwsKmsTimeoutError extends AwsKmsError {}
export class AwsKmsCifradoError extends AwsKmsError {}
export class AwsKmsDescifradoError extends AwsKmsError {}
export class AwsKmsRespuestaInvalidaError extends AwsKmsError {}
export class AwsKmsKeyNoEncontradaError extends AwsKmsError {}

// ---------------------------------------------------------------------------
// Boundary hacia el SDK (puerto) — el dominio NO importa @aws-sdk directamente
// ---------------------------------------------------------------------------

export interface EntradaEncrypt {
  readonly keyId: string;
  readonly plaintext: Buffer; // la DATA KEY (32 bytes) — NUNCA el token
  readonly encryptionContext: Readonly<Record<string, string>>;
}
export interface SalidaEncrypt {
  readonly ciphertextBlob: Buffer;
  readonly keyId: string;
}
export interface EntradaDecrypt {
  readonly keyId: string;
  readonly ciphertextBlob: Buffer;
  readonly encryptionContext: Readonly<Record<string, string>>;
}
export interface SalidaDecrypt {
  readonly plaintext: Buffer;
  readonly keyId: string;
}
export interface SaludKey {
  readonly keyId: string;
  readonly enabled: boolean;
}

/**
 * Único boundary hacia AWS KMS. Debe traducir errores del SDK a los errores tipados de arriba (sin filtrar
 * request/response crudos ni credenciales) y aplicar timeout/reintentos acotados. `esProductivo=false` sólo
 * en el fake de test.
 */
export interface ClienteKms {
  readonly esProductivo: boolean;
  encrypt(e: EntradaEncrypt): Promise<SalidaEncrypt>;
  decrypt(e: EntradaDecrypt): Promise<SalidaDecrypt>;
  describeKey(keyId: string): Promise<SaludKey>;
}

/** Capacidad opcional de rewrap (KMS ReEncrypt) — contrato futuro, NO en hot path ni en policy inicial. */
export interface ClienteKmsReEncrypt {
  reEncrypt(e: { origenBlob: Buffer; keyIdDestino: string; encryptionContext: Readonly<Record<string, string>> }): Promise<SalidaEncrypt>;
}

// ---------------------------------------------------------------------------
// Config tipada — nada hardcodeado; fail-closed si falta
// ---------------------------------------------------------------------------

export interface ConfigAwsKms {
  readonly region: string; // AWS_REGION
  readonly keyId: string; // SOEC_KMS_KEY_ID (alias/soec-production-secrets o key ARN/ID)
  readonly timeoutMs: number; // SOEC_KMS_TIMEOUT_MS
  readonly maxAttempts: number; // SOEC_KMS_MAX_ATTEMPTS
}

export function validarConfigAwsKms(c: ConfigAwsKms): void {
  const falta: string[] = [];
  if (!c.region) falta.push('AWS_REGION');
  if (!c.keyId) falta.push('SOEC_KMS_KEY_ID');
  if (!(c.timeoutMs > 0)) falta.push('SOEC_KMS_TIMEOUT_MS');
  if (!(c.maxAttempts >= 1)) falta.push('SOEC_KMS_MAX_ATTEMPTS');
  if (falta.length > 0) throw new AwsKmsConfiguracionError(`configuración de AWS KMS incompleta: ${falta.join(', ')}`);
}

// ---------------------------------------------------------------------------
// Adaptador KmsPort sobre AWS KMS
// ---------------------------------------------------------------------------

function esReEncryptCapable(c: ClienteKms): c is ClienteKms & ClienteKmsReEncrypt {
  return typeof (c as Partial<ClienteKmsReEncrypt>).reEncrypt === 'function';
}

export class AwsKmsPort implements KmsPort {
  readonly nombre = 'aws-kms';
  /** Productivo sólo si el cliente lo es (el fake ⇒ false ⇒ bloqueado por el gate de producción). */
  readonly esProductivo: boolean;

  constructor(
    private readonly cfg: ConfigAwsKms,
    private readonly cliente: ClienteKms,
  ) {
    validarConfigAwsKms(cfg);
    this.esProductivo = cliente.esProductivo;
  }

  /** wrap = KMS Encrypt de la data key. Valida el tamaño (32 bytes) ANTES de la red (fail-closed). */
  async wrapDataKey(dataKey: Buffer): Promise<Buffer> {
    if (dataKey.length !== TAMANO_DATA_KEY) {
      throw new AwsKmsConfiguracionError(`data key de tamaño inválido (esperado ${TAMANO_DATA_KEY} bytes)`);
    }
    const r = await this.cliente.encrypt({ keyId: this.cfg.keyId, plaintext: dataKey, encryptionContext: ENCRYPTION_CONTEXT });
    if (!Buffer.isBuffer(r.ciphertextBlob) || r.ciphertextBlob.length === 0) {
      throw new AwsKmsRespuestaInvalidaError('KMS Encrypt devolvió un CiphertextBlob vacío/ inválido');
    }
    return r.ciphertextBlob;
  }

  /** unwrap = KMS Decrypt con KeyId explícito + EncryptionContext. Valida el tamaño del plaintext devuelto. */
  async unwrapDataKey(wrapped: Buffer): Promise<Buffer> {
    if (!Buffer.isBuffer(wrapped) || wrapped.length === 0) {
      throw new AwsKmsRespuestaInvalidaError('wrappedDataKey vacío/ inválido');
    }
    const r = await this.cliente.decrypt({ keyId: this.cfg.keyId, ciphertextBlob: wrapped, encryptionContext: ENCRYPTION_CONTEXT });
    if (!Buffer.isBuffer(r.plaintext) || r.plaintext.length !== TAMANO_DATA_KEY) {
      throw new AwsKmsRespuestaInvalidaError('KMS Decrypt devolvió un plaintext de tamaño inesperado');
    }
    return r.plaintext;
  }

  /** Readiness vía DescribeKey. Nunca lanza: mapea todo a un estado de salud. */
  async salud(): Promise<SaludBackend> {
    try {
      const k = await this.cliente.describeKey(this.cfg.keyId);
      return k.enabled ? 'AVAILABLE' : 'MISCONFIGURED';
    } catch (e) {
      if (e instanceof AwsKmsAutenticacionError || e instanceof AwsKmsPermisoError || e instanceof AwsKmsKeyNoEncontradaError || e instanceof AwsKmsConfiguracionError) {
        return 'MISCONFIGURED';
      }
      return 'UNAVAILABLE';
    }
  }

  /** Rotación por ReEncrypt — soportada por CONTRATO, NO usada en el hot path ni exigida en policy inicial. */
  async reenvolverDataKey(wrapped: Buffer): Promise<Buffer> {
    if (!esReEncryptCapable(this.cliente)) {
      throw new AwsKmsConfiguracionError('el cliente KMS no soporta ReEncrypt');
    }
    const r = await this.cliente.reEncrypt({ origenBlob: wrapped, keyIdDestino: this.cfg.keyId, encryptionContext: ENCRYPTION_CONTEXT });
    if (!Buffer.isBuffer(r.ciphertextBlob) || r.ciphertextBlob.length === 0) {
      throw new AwsKmsRespuestaInvalidaError('KMS ReEncrypt devolvió un CiphertextBlob inválido');
    }
    return r.ciphertextBlob;
  }
}

/**
 * Clasificación de error para el smoke (inyectable en `ejecutarSmoke`). Traduce los errores tipados de AWS KMS
 * a la taxonomía compartida de `ResultadoSmoke`, sin exponer secretos.
 */
export function clasificarErrorKms(e: unknown, r: { auth: 'PASS' | 'FAIL' | 'NOT_RUN'; networkEgress: 'PASS' | 'FAIL' | 'NOT_RUN'; vaultHealth: string; failureClass: unknown }): void {
  const rr = r as { auth: 'PASS' | 'FAIL' | 'NOT_RUN'; networkEgress: 'PASS' | 'FAIL' | 'NOT_RUN'; vaultHealth: string; failureClass: string };
  if (e instanceof AwsKmsAutenticacionError) {
    rr.auth = 'FAIL';
    rr.vaultHealth = 'AUTH_FAILED';
    rr.failureClass = 'AUTH';
  } else if (e instanceof AwsKmsPermisoError) {
    rr.failureClass = 'PERMISSION';
  } else if (e instanceof AwsKmsNoDisponibleError) {
    rr.networkEgress = 'FAIL';
    rr.vaultHealth = 'NETWORK_ERROR';
    rr.failureClass = 'NOT_AVAILABLE';
  } else if (e instanceof AwsKmsTimeoutError) {
    rr.networkEgress = 'FAIL';
    rr.failureClass = 'TIMEOUT';
  } else if (e instanceof AwsKmsKeyNoEncontradaError) {
    rr.vaultHealth = 'MISCONFIGURED';
    rr.failureClass = 'KEY_NOT_FOUND';
  } else if (e instanceof AwsKmsCifradoError) {
    rr.failureClass = 'ENCRYPT_FAILED';
  } else if (e instanceof AwsKmsDescifradoError) {
    rr.failureClass = 'DECRYPT_FAILED';
  } else if (e instanceof AwsKmsRespuestaInvalidaError) {
    rr.failureClass = 'MALFORMED_RESPONSE';
  } else if (e instanceof AwsKmsConfiguracionError) {
    rr.failureClass = 'CONFIGURATION';
  } else {
    rr.failureClass = 'OTHER';
  }
}
