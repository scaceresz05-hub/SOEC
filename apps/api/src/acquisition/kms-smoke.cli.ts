/**
 * apps/api · CLI one-shot del SMOKE de AWS KMS — se ejecuta DENTRO del runtime real de SOEC.
 *
 *   pnpm -C apps/api kms:smoke
 *
 * Reutiliza el patrón de `vault-smoke`: lee config SÓLO de `process.env`, arma el adapter PRODUCTIVO
 * (`ClienteKmsSdk`, nunca el fake), corre el round-trip con secreto SINTÉTICO y emite un bloque estéril.
 * Ningún valor secreto (credenciales AWS, data key, CiphertextBlob, token) toca stdout/stderr.
 *
 * Exit: 0 READY · 2 config ausente · 3 adapter no productivo · 1 fallo.
 */

import { pathToFileURL } from 'node:url';
import { AwsKmsPort, clasificarErrorKms, type ConfigAwsKms } from './aws-kms';
import { ClienteKmsSdk } from './aws-kms-sdk';
import { EnvelopeSecretBackend, InMemoryCiphertextStore } from './meta-secret-backend';
import { ejecutarSmoke, exitCodeDe, type ClaseFallo, type ResultadoSmoke } from './vault-smoke';

type Env = Record<string, string | undefined>;

export interface PresenciaKms {
  readonly region: boolean;
  readonly keyId: boolean;
  readonly accessKeyId: boolean; // credencial (presencia; el SDK resuelve el valor)
  readonly secretAccessKey: boolean;
}

export function presenciaKms(env: Env): PresenciaKms {
  const tiene = (k: string): boolean => typeof env[k] === 'string' && env[k]!.length > 0;
  return {
    region: tiene('AWS_REGION'),
    keyId: tiene('SOEC_KMS_KEY_ID'),
    accessKeyId: tiene('AWS_ACCESS_KEY_ID'),
    secretAccessKey: tiene('AWS_SECRET_ACCESS_KEY'),
  };
}

export function configKmsDesdeEnv(env: Env): ConfigAwsKms | null {
  const p = presenciaKms(env);
  // Sin credenciales AWS ⇒ NO intentar conexión: se trata como CONFIGURATION (fail-clean).
  if (!p.region || !p.keyId || !p.accessKeyId || !p.secretAccessKey) return null;
  const timeoutMs = Number(env['SOEC_KMS_TIMEOUT_MS'] ?? '5000');
  const maxAttempts = Number(env['SOEC_KMS_MAX_ATTEMPTS'] ?? '3');
  return {
    region: env['AWS_REGION']!,
    keyId: env['SOEC_KMS_KEY_ID']!,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 5000,
    maxAttempts: Number.isFinite(maxAttempts) && maxAttempts >= 1 ? maxAttempts : 3,
  };
}

function bloquePresencia(p: PresenciaKms): string {
  return [
    '=== SOEC AWS KMS CONFIG PRESENCE ===',
    `AWS_REGION_PRESENT = ${p.region ? 'YES' : 'NO'}`,
    `SOEC_KMS_KEY_ID_PRESENT = ${p.keyId ? 'YES' : 'NO'}`,
    `AWS_ACCESS_KEY_ID_PRESENT = ${p.accessKeyId ? 'YES' : 'NO'}`,
    `AWS_SECRET_ACCESS_KEY_PRESENT = ${p.secretAccessKey ? 'YES' : 'NO'}`,
    '=== END ===',
  ].join('\n');
}

function permisos(r: ResultadoSmoke): 'PASS' | 'FAIL' | 'NOT_RUN' {
  if (r.failureClass === 'PERMISSION') return 'FAIL';
  return r.store === 'PASS' ? 'PASS' : 'NOT_RUN';
}

/** Salida machine-readable ESTÉRIL con encabezado AWS KMS (sólo enums). */
export function formatearSalidaKms(r: ResultadoSmoke): string {
  return [
    '=== SOEC AWS KMS RUNTIME SMOKE ===',
    `CONFIG_READY = ${r.configReady ? 'YES' : 'NO'}`,
    `PRODUCTION_ADAPTER = ${r.productionAdapter ? 'YES' : 'NO'}`,
    `KMS_HEALTH = ${r.vaultHealth}`,
    `AUTH = ${r.auth}`,
    `PERMISSIONS = ${permisos(r)}`,
    `NETWORK_EGRESS = ${r.networkEgress}`,
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
  ].join('\n');
}

function resultadoConfigFaltante(): ResultadoSmoke {
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
    failureClass: 'CONFIGURATION',
  };
}

export interface SalidaSmokeKms {
  readonly texto: string;
  readonly exitCode: number;
  readonly resultado: ResultadoSmoke;
}

const CLASE_FALLO_SALUD_KMS = (misconfigured: boolean): ClaseFallo => (misconfigured ? 'CONFIGURATION' : 'NOT_AVAILABLE');

export async function mainSmokeKms(env: Env, imprimir: (s: string) => void): Promise<SalidaSmokeKms> {
  const p = presenciaKms(env);
  imprimir(bloquePresencia(p));

  const cfg = configKmsDesdeEnv(env);
  if (cfg === null) {
    const r = resultadoConfigFaltante();
    const texto = formatearSalidaKms(r);
    imprimir(texto);
    return { texto, exitCode: 2, resultado: r };
  }

  const backend = new EnvelopeSecretBackend(new AwsKmsPort(cfg, new ClienteKmsSdk(cfg)), new InMemoryCiphertextStore());

  // Safety gate: jamás correr el smoke de runtime sobre un backend no productivo.
  if (!backend.esProductivo) {
    const r: ResultadoSmoke = { ...resultadoConfigFaltante(), configReady: true, failureClass: 'OTHER' };
    const texto = formatearSalidaKms(r);
    imprimir(texto);
    return { texto, exitCode: 3, resultado: r };
  }

  const r = await ejecutarSmoke(backend, { clasificarError: clasificarErrorKms, claseFalloSalud: CLASE_FALLO_SALUD_KMS });
  const texto = formatearSalidaKms(r);
  imprimir(texto);
  return { texto, exitCode: exitCodeDe(r), resultado: r };
}

// --- Entry point (sólo invocación directa; no al importarse en tests) ---
const invocadoDirecto = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invocadoDirecto) {
  void mainSmokeKms(process.env, (s) => process.stdout.write(`${s}\n`)).then((res) => {
    process.exit(res.exitCode);
  });
}
