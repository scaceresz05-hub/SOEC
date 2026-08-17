/**
 * apps/api · Cableado del SecretWriter PRODUCTIVO del flujo OAuth de Meta.
 *
 * `EnvelopeSecretBackend` (envelope AES-256-GCM + `KmsPort`) YA satisface `SecretWriterPort`. Aquí sólo se
 * construye con el `AwsKmsPort` real (o un `KmsPort` inyectado en tests) + un `CiphertextStore`. Flujo:
 *
 *   token OAuth efímero → SecretWriter.almacenar → EnvelopeSecretBackend → AES-GCM local con data key
 *   → data key → AWS KMS Encrypt → CiphertextStore (ciphertext) → secretRef opaco → token descartado
 *
 * El TOKEN META NUNCA viaja a AWS KMS (sólo la data key) ni se persiste en claro; sólo se guarda el secretRef.
 */

import { AwsKmsPort, type ConfigAwsKms } from './aws-kms';
import { ClienteKmsSdk } from './aws-kms-sdk';
import { EnvelopeSecretBackend, type CiphertextStore, type KmsPort } from './meta-secret-backend';
import type { SecretWriterPort } from './meta-oauth-flow';

/** Factory genérica: writer envelope sobre un `KmsPort` inyectado (fake en tests, AWS KMS en prod). */
export function crearSecretWriterEnvelope(kms: KmsPort, store: CiphertextStore): EnvelopeSecretBackend {
  return new EnvelopeSecretBackend(kms, store);
}

/** Factory PRODUCTIVA: writer envelope sobre AWS KMS real. `esProductivo=true` sólo si el KMS lo es. */
export function crearSecretWriterProductivoAwsKms(cfg: ConfigAwsKms, store: CiphertextStore): EnvelopeSecretBackend {
  return new EnvelopeSecretBackend(new AwsKmsPort(cfg, new ClienteKmsSdk(cfg)), store);
}

/** Comprobación de tipo: `EnvelopeSecretBackend` es un `SecretWriterPort` válido para el flujo OAuth. */
export function esSecretWriter(x: EnvelopeSecretBackend): SecretWriterPort {
  return x;
}
