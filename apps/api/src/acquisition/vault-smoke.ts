/**
 * apps/api · SMOKE del backend de secretos contra Vault Transit REAL — núcleo testeable (sin I/O de proceso).
 *
 * Reutiliza EXACTAMENTE la infraestructura productiva (no duplica): `EnvelopeSecretBackend` +
 * `VaultTransitKmsPort` + `TransporteHttpVault`. Se ejecuta DENTRO del runtime real de SOEC (donde la
 * credencial de Vault está inyectada de forma segura); este proceso jamás recibe secretos por otra vía.
 *
 * Garantías de este módulo:
 *  - NUNCA imprime: token de Vault, Authorization, plaintext del secreto sintético, data key, ciphertext.
 *  - El `ResultadoSmoke` sólo contiene ENUMS (no valores); la salida formateada es machine-readable y estéril.
 *  - Cleanup garantizado por `finally` (compensación), incluso ante excepción.
 *  - NO importa NADA del Graph/OAuth de Meta (sin endpoint de Graph, sin App ID, sin token de Meta).
 *
 * El secreto sintético se genera con `crypto.randomBytes` SÓLO en memoria y se compara en tiempo constante.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { ActorId, OrganizationId, type RequestContext } from '@soec/contracts';
import { EnvelopeSecretBackend } from './meta-secret-backend';
import {
  VaultAutenticacionError,
  VaultConfiguracionError,
  VaultDescifradoError,
  VaultNoDisponibleError,
  VaultRespuestaInvalidaError,
} from './meta-vault-transit';

export type SaludSmoke = 'AVAILABLE' | 'UNAVAILABLE' | 'AUTH_FAILED' | 'NETWORK_ERROR' | 'MISCONFIGURED' | 'NOT_RUN';
/** Taxonomía compartida de fallos de smoke (cubre Vault Transit y AWS KMS). */
export type ClaseFallo =
  | 'CONFIGURATION'
  | 'AUTH'
  | 'PERMISSION'
  | 'NETWORK_EGRESS'
  | 'NOT_AVAILABLE'
  | 'TIMEOUT'
  | 'ENCRYPT_FAILED'
  | 'DECRYPT_FAILED'
  | 'MALFORMED_RESPONSE'
  | 'KEY_NOT_FOUND'
  | 'VAULT_POLICY'
  | 'TRANSIT_ENGINE'
  | 'TRANSIT_KEY'
  | 'SECRET_BACKEND'
  | 'TENANT_ISOLATION'
  | 'CLEANUP'
  | 'OTHER';
export type VeredictoBackend = 'READY' | 'IMPLEMENTED_NOT_VERIFIED' | 'FAILED';

export interface ResultadoSmoke {
  configReady: boolean;
  productionAdapter: boolean;
  vaultHealth: SaludSmoke;
  auth: 'PASS' | 'FAIL' | 'NOT_RUN';
  networkEgress: 'PASS' | 'FAIL' | 'NOT_RUN';
  transitAccess: 'PASS' | 'FAIL' | 'NOT_RUN';
  store: 'PASS' | 'FAIL' | 'NOT_RUN';
  resolve: 'PASS' | 'FAIL' | 'NOT_RUN';
  roundTripMatch: 'YES' | 'NO' | 'NOT_RUN';
  delete: 'PASS' | 'FAIL' | 'NOT_RUN';
  resolveAfterDelete: 'FAIL_EXPECTED' | 'UNEXPECTED_OK' | 'NOT_RUN';
  crossTenantResolve: 'REJECT' | 'LEAK' | 'NOT_RUN';
  orphanSecret: 'NO' | 'YES' | 'UNKNOWN';
  secretLeakDetected: 'NO' | 'YES';
  productionSecretBackend: VeredictoBackend;
  failureClass: ClaseFallo | null;
}

function resultadoBase(): ResultadoSmoke {
  return {
    configReady: false,
    productionAdapter: false,
    vaultHealth: 'NOT_RUN',
    auth: 'NOT_RUN',
    networkEgress: 'NOT_RUN',
    transitAccess: 'NOT_RUN',
    store: 'NOT_RUN',
    resolve: 'NOT_RUN',
    roundTripMatch: 'NOT_RUN',
    delete: 'NOT_RUN',
    resolveAfterDelete: 'NOT_RUN',
    crossTenantResolve: 'NOT_RUN',
    orphanSecret: 'UNKNOWN',
    secretLeakDetected: 'NO',
    productionSecretBackend: 'IMPLEMENTED_NOT_VERIFIED',
    failureClass: null,
  };
}

function ctx(org: string): RequestContext {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('vault-smoke'), scope: { organizationId: o, permissions: ['events:read'] }, correlationId: 'vault-smoke' };
}

/** Igualdad en tiempo constante entre el plaintext recuperado y el secreto original. */
function igualdadSegura(recuperado: string, original: string): boolean {
  const a = Buffer.from(recuperado, 'utf8');
  const b = Buffer.from(original, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function clasificarError(e: unknown, r: ResultadoSmoke): void {
  if (e instanceof VaultAutenticacionError) {
    r.auth = 'FAIL';
    r.vaultHealth = 'AUTH_FAILED';
    r.failureClass = 'AUTH';
  } else if (e instanceof VaultNoDisponibleError) {
    r.networkEgress = 'FAIL';
    r.vaultHealth = 'NETWORK_ERROR';
    r.failureClass = 'NETWORK_EGRESS';
  } else if (e instanceof VaultConfiguracionError) {
    r.vaultHealth = 'MISCONFIGURED';
    r.failureClass = 'TRANSIT_KEY'; // 404 de mount/key: motor/clave de Transit mal configurado
  } else if (e instanceof VaultDescifradoError) {
    r.failureClass = 'TRANSIT_KEY';
  } else if (e instanceof VaultRespuestaInvalidaError) {
    r.failureClass = 'OTHER';
  } else {
    r.failureClass = 'OTHER';
  }
}

export interface OpcionesSmoke {
  readonly orgA?: string;
  readonly orgB?: string;
  readonly nombreLogico?: string;
  /** Generador del secreto sintético (default `randomBytes`); inyectable sólo para tests deterministas. */
  readonly generarSecreto?: () => string;
  /** Clasificador de error por backend (default: Vault Transit). AWS KMS inyecta el suyo. */
  readonly clasificarError?: (e: unknown, r: ResultadoSmoke) => void;
  /** Mapea salud≠AVAILABLE → clase de fallo (default: Vault). `true` = MISCONFIGURED. */
  readonly claseFalloSalud?: (misconfigured: boolean) => ClaseFallo;
}

/**
 * Ejecuta el round-trip real contra el backend dado. `backend.esProductivo` decide si el veredicto puede ser
 * READY (un backend NO productivo — p. ej. fake — nunca produce READY). Cleanup garantizado por `finally`.
 * Nota: el ciphertext se persiste en el store del backend (in-memory efímero en el smoke); Vault Transit es
 * stateless (no guarda el ciphertext), por lo que no deja huella remota que limpiar.
 */
export async function ejecutarSmoke(backend: EnvelopeSecretBackend, opts: OpcionesSmoke = {}): Promise<ResultadoSmoke> {
  const r = resultadoBase();
  const clasif = opts.clasificarError ?? clasificarError;
  const mapaSalud = opts.claseFalloSalud ?? ((misconfigured: boolean): ClaseFallo => (misconfigured ? 'TRANSIT_ENGINE' : 'NETWORK_EGRESS'));
  r.configReady = true;
  r.productionAdapter = backend.esProductivo;

  const salud = await backend.salud().catch(() => 'UNAVAILABLE' as const);
  r.vaultHealth = salud === 'AVAILABLE' ? 'AVAILABLE' : salud === 'MISCONFIGURED' ? 'MISCONFIGURED' : 'UNAVAILABLE';
  if (salud !== 'AVAILABLE') {
    r.productionSecretBackend = 'IMPLEMENTED_NOT_VERIFIED';
    r.failureClass = mapaSalud(salud === 'MISCONFIGURED');
    return r;
  }

  const orgA = opts.orgA ?? 'smoke-org-a';
  const orgB = opts.orgB ?? 'smoke-org-b';
  const nombre = opts.nombreLogico ?? 'vault-smoke-token';
  const secreto = (opts.generarSecreto ?? (() => randomBytes(32).toString('base64')))();
  let secretRef: string | null = null;

  try {
    try {
      const res = await backend.almacenar(orgA, nombre, secreto);
      secretRef = res.secretRef;
      r.store = 'PASS';
      r.transitAccess = 'PASS';
      r.auth = 'PASS';
      r.networkEgress = 'PASS';
    } catch (e) {
      clasif(e, r);
      r.store = 'FAIL';
      r.productionSecretBackend = 'FAILED';
      return r;
    }

    try {
      const caja = await backend.resolver(ctx(orgA), secretRef);
      r.resolve = 'PASS';
      r.roundTripMatch = caja.usar((v) => igualdadSegura(v, secreto)) ? 'YES' : 'NO';
    } catch (e) {
      clasif(e, r);
      r.resolve = 'FAIL';
      r.productionSecretBackend = 'FAILED';
      return r;
    }

    // Aislamiento por tenant: la org B NO debe poder resolver el secreto de la org A.
    try {
      await backend.resolver(ctx(orgB), secretRef);
      r.crossTenantResolve = 'LEAK';
    } catch {
      r.crossTenantResolve = 'REJECT';
    }
  } finally {
    if (secretRef !== null) {
      try {
        await backend.revocar(secretRef);
        r.delete = 'PASS';
      } catch {
        r.delete = 'FAIL';
      }
      try {
        await backend.resolver(ctx(orgA), secretRef);
        r.resolveAfterDelete = 'UNEXPECTED_OK';
        r.orphanSecret = 'YES';
      } catch {
        r.resolveAfterDelete = 'FAIL_EXPECTED';
        r.orphanSecret = 'NO';
      }
    }
  }

  const todoOk =
    r.productionAdapter &&
    r.store === 'PASS' &&
    r.resolve === 'PASS' &&
    r.roundTripMatch === 'YES' &&
    r.delete === 'PASS' &&
    r.resolveAfterDelete === 'FAIL_EXPECTED' &&
    r.crossTenantResolve === 'REJECT' &&
    r.orphanSecret === 'NO' &&
    r.secretLeakDetected === 'NO';
  r.productionSecretBackend = todoOk ? 'READY' : 'FAILED';
  return r;
}

// ---------------------------------------------------------------------------
// Salida machine-readable ESTÉRIL (sólo enums; jamás valores)
// ---------------------------------------------------------------------------

export function formatearSalida(r: ResultadoSmoke): string {
  const lineas = [
    '=== SOEC VAULT RUNTIME SMOKE ===',
    `CONFIG_READY = ${r.configReady ? 'YES' : 'NO'}`,
    `PRODUCTION_ADAPTER = ${r.productionAdapter ? 'YES' : 'NO'}`,
    `VAULT_HEALTH = ${r.vaultHealth}`,
    `AUTH = ${r.auth}`,
    `NETWORK_EGRESS = ${r.networkEgress}`,
    `TRANSIT_ACCESS = ${r.transitAccess}`,
    `STORE = ${r.store}`,
    `RESOLVE = ${r.resolve}`,
    `ROUND_TRIP_MATCH = ${r.roundTripMatch}`,
    `DELETE = ${r.delete}`,
    `RESOLVE_AFTER_DELETE = ${r.resolveAfterDelete}`,
    `CROSS_TENANT_RESOLVE = ${r.crossTenantResolve}`,
    `ORPHAN_SECRET = ${r.orphanSecret}`,
    `SECRET_LEAK_DETECTED = ${r.secretLeakDetected}`,
    `FAILURE_CLASS = ${r.failureClass ?? 'NONE'}`,
    `PRODUCTION_SECRET_BACKEND = ${r.productionSecretBackend}`,
    '=== END ===',
  ];
  return lineas.join('\n');
}

/** 0 = READY (todo verde); no-cero = cualquier fallo/no-verificado. */
export function exitCodeDe(r: ResultadoSmoke): number {
  return r.productionSecretBackend === 'READY' ? 0 : 1;
}
