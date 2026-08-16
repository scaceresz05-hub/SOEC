/**
 * apps/api · Backend PRODUCTIVO de escritura/lectura de secretos por ENVELOPE ENCRYPTION + KMS.
 *
 * Patrón sancionado (opción D): el token se cifra con AES-256-GCM usando una DATA KEY aleatoria por
 * secreto; la data key se envuelve (`wrap`) con la MASTER KEY que vive en un KMS real, detrás del puerto
 * `KmsPort` (inyectado). El ciphertext (NO plaintext) y la data key envuelta se guardan en un
 * `CiphertextStore` (una fila de PG en producción); el `secretRef` opaco (`secretstore:<org>/<name>`)
 * NO contiene material secreto. Resolver = fetch blob → verificar tenant → `KmsPort.unwrap` → AES-GCM
 * decrypt → caja opaca `SecretoResuelto`. Read/write apuntan al MISMO backend lógico.
 *
 * PROHIBIDO y NO usado aquí: token plaintext en DB/log/filesystem, AES con clave hardcodeada, master key
 * en la misma DB, cifrado casero, base64 como "cifrado". La master key jamás está en repo/DB: vive en el
 * KMS (puerto). El `KmsFake` es SÓLO test/dev; en producción se exige `esProductivo=true` (ver gate).
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { RequestContext } from '@soec/contracts';
import { SecretoResuelto, type SecretStore } from '@soec/secretos';
import type { ResultadoAlmacenSecreto, SecretWriterPort } from './meta-oauth-flow';

export type SaludBackend = 'AVAILABLE' | 'UNAVAILABLE' | 'MISCONFIGURED';

/** Puerto del KMS — el boundary que exige PROVISIONING real (key, credenciales, permisos cloud). */
export interface KmsPort {
  readonly nombre: string;
  readonly esProductivo: boolean;
  wrapDataKey(dataKey: Buffer): Promise<Buffer>;
  unwrapDataKey(wrapped: Buffer): Promise<Buffer>;
  salud(): Promise<SaludBackend>;
}

/** KMS FAKE — SÓLO test/dev. Master key en memoria (jamás producción). `esProductivo=false`. */
export class KmsFake implements KmsPort {
  readonly nombre = 'kms-fake-in-memory';
  readonly esProductivo = false;
  private readonly masterKey = randomBytes(32);
  async wrapDataKey(dataKey: Buffer): Promise<Buffer> {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.masterKey, iv);
    const ct = Buffer.concat([c.update(dataKey), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), ct]);
  }
  async unwrapDataKey(wrapped: Buffer): Promise<Buffer> {
    const iv = wrapped.subarray(0, 12);
    const tag = wrapped.subarray(12, 28);
    const ct = wrapped.subarray(28);
    const d = createDecipheriv('aes-256-gcm', this.masterKey, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]);
  }
  async salud(): Promise<SaludBackend> {
    return 'AVAILABLE';
  }
}

/** Blob cifrado — se persiste en la fila de PG. NO contiene plaintext. */
export interface CipherBlob {
  readonly organizationId: string;
  readonly iv: string;
  readonly authTag: string;
  readonly ciphertext: string; // token CIFRADO (no plaintext)
  readonly wrappedDataKey: string; // data key envuelta por el KMS
  readonly version: number;
}

export interface CiphertextStore {
  put(clave: string, blob: CipherBlob): Promise<void>;
  get(clave: string): Promise<CipherBlob | null>;
  del(clave: string): Promise<void>;
}

export class InMemoryCiphertextStore implements CiphertextStore {
  private readonly m = new Map<string, CipherBlob>();
  async put(clave: string, blob: CipherBlob): Promise<void> {
    this.m.set(clave, blob);
  }
  async get(clave: string): Promise<CipherBlob | null> {
    return this.m.get(clave) ?? null;
  }
  async del(clave: string): Promise<void> {
    this.m.delete(clave);
  }
}

export class ResolucionSecretoError extends Error {}

/**
 * Backend de secretos por envelope encryption. Implementa TANTO el writer (`SecretWriterPort`) como el
 * resolver (`SecretStore` de `@soec/secretos`) sobre el MISMO KMS + store: simetría write/resolve.
 */
export class EnvelopeSecretBackend implements SecretWriterPort, SecretStore {
  readonly nombre = 'envelope-kms';
  /** Productivo sólo si el KMS lo es (el `KmsFake` ⇒ false). */
  readonly esProductivo: boolean;
  constructor(
    private readonly kms: KmsPort,
    private readonly store: CiphertextStore,
  ) {
    this.esProductivo = kms.esProductivo;
  }

  private clave(org: string, nombre: string): string {
    return `${org}/${nombre}`;
  }
  private ref(org: string, nombre: string): string {
    return `secretstore:${org}/${nombre}`; // esquema permitido por esReferenciaSecreto; sin material secreto
  }
  private parseRef(secretRef: string): { org: string; nombre: string } | null {
    const m = /^secretstore:([^/]+)\/(.+)$/.exec(secretRef);
    if (!m) return null;
    const org = m[1];
    const nombre = m[2];
    if (!org || !nombre) return null;
    return { org, nombre };
  }

  async almacenar(organizationId: string, nombreLogico: string, valorSecreto: string): Promise<ResultadoAlmacenSecreto> {
    const dataKey = randomBytes(32);
    try {
      const iv = randomBytes(12);
      const c = createCipheriv('aes-256-gcm', dataKey, iv);
      const ct = Buffer.concat([c.update(valorSecreto, 'utf8'), c.final()]);
      const authTag = c.getAuthTag();
      const wrapped = await this.kms.wrapDataKey(dataKey);
      await this.store.put(this.clave(organizationId, nombreLogico), {
        organizationId,
        iv: iv.toString('base64'),
        authTag: authTag.toString('base64'),
        ciphertext: ct.toString('base64'),
        wrappedDataKey: wrapped.toString('base64'),
        version: 1,
      });
      return { secretRef: this.ref(organizationId, nombreLogico) };
    } finally {
      dataKey.fill(0); // zeroize la data key en claro
    }
  }

  async resolver(ctx: RequestContext, secretRef: string): Promise<SecretoResuelto> {
    const p = this.parseRef(secretRef); // valida el esquema `secretstore:<org>/<name>` (compatible con la allowlist)
    if (p === null) throw new ResolucionSecretoError('secretRef malformada');
    const org = String(ctx.organizationId);
    if (p.org !== org) throw new ResolucionSecretoError('resolución cross-tenant rechazada'); // aislamiento por tenant
    const blob = await this.store.get(this.clave(p.org, p.nombre));
    if (blob === null) throw new ResolucionSecretoError('secreto no encontrado');
    if (blob.organizationId !== org) throw new ResolucionSecretoError('resolución cross-tenant rechazada');
    const dataKey = await this.kms.unwrapDataKey(Buffer.from(blob.wrappedDataKey, 'base64'));
    try {
      const d = createDecipheriv('aes-256-gcm', dataKey, Buffer.from(blob.iv, 'base64'));
      d.setAuthTag(Buffer.from(blob.authTag, 'base64'));
      const valor = Buffer.concat([d.update(Buffer.from(blob.ciphertext, 'base64')), d.final()]).toString('utf8');
      return new SecretoResuelto(secretRef, valor); // caja opaca; el valor sólo sale por `usar`
    } finally {
      dataKey.fill(0);
    }
  }

  async revocar(secretRef: string): Promise<void> {
    const p = this.parseRef(secretRef);
    if (p !== null) await this.store.del(this.clave(p.org, p.nombre));
  }

  async salud(): Promise<SaludBackend> {
    return this.kms.salud();
  }
}

/**
 * Gate de configuración (FASE 17): en `production` está PROHIBIDO un backend de secretos no productivo
 * (fake/in-memory). Debe llamarse en el arranque; fail-closed.
 */
export function assertBackendSeguroEnProduccion(nodeEnv: string | undefined, backend: { esProductivo: boolean }): void {
  if (nodeEnv === 'production' && !backend.esProductivo) {
    throw new Error('PROHIBIDO: backend de secretos fake/in-memory en producción');
  }
}
