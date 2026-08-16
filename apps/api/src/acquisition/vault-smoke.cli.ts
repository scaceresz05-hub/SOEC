/**
 * apps/api · CLI one-shot del SMOKE de Vault Transit — se ejecuta DENTRO del runtime real de SOEC.
 *
 *   pnpm -C apps/api vault:smoke      (o `pnpm vault:smoke` desde la raíz)
 *
 * Lee la config EXCLUSIVAMENTE de `process.env` (inyectada de forma segura por el runtime), arma el adapter
 * PRODUCTIVO (`TransporteHttpVault`, nunca el fake), corre el smoke y emite SÓLO un bloque estéril
 * machine-readable. Ningún valor secreto toca stdout/stderr. Exit 0 = READY, no-cero = cualquier fallo.
 *
 * Safety gate (FASE 4): se niega a arrancar si falta config, si el auth provider no está configurado, o si el
 * backend no es productivo (fail-closed).
 */

import { pathToFileURL } from 'node:url';
import { EnvelopeSecretBackend, InMemoryCiphertextStore } from './meta-secret-backend';
import { TransporteHttpVault, VaultTokenEstaticoAuth, VaultTransitKmsPort, type VaultAuthProvider, type VaultTransitConfig } from './meta-vault-transit';
import { ejecutarSmoke, exitCodeDe, formatearSalida, type ResultadoSmoke } from './vault-smoke';

type Env = Record<string, string | undefined>;

export interface PresenciaConfig {
  readonly addr: boolean;
  readonly namespace: boolean; // opcional; se informa presencia sin exigirla
  readonly mount: boolean;
  readonly key: boolean;
  readonly auth: boolean;
}

export function presenciaConfig(env: Env): PresenciaConfig {
  const tiene = (k: string): boolean => typeof env[k] === 'string' && env[k]!.length > 0;
  return {
    addr: tiene('VAULT_ADDR'),
    namespace: tiene('VAULT_NAMESPACE'),
    mount: tiene('VAULT_TRANSIT_MOUNT'),
    key: tiene('VAULT_TRANSIT_KEY'),
    auth: tiene('VAULT_TOKEN'), // AppRole/JWT: punto de extensión futuro (login) — hoy sólo token estático
  };
}

/** Config productiva desde env, o null si falta algo requerido. NUNCA devuelve/expone valores. */
export function configDesdeEnv(env: Env): VaultTransitConfig | null {
  const p = presenciaConfig(env);
  if (!p.addr || !p.mount || !p.key) return null;
  const timeoutMs = Number(env['VAULT_TIMEOUT_MS'] ?? '5000');
  const cfg: VaultTransitConfig = {
    addr: env['VAULT_ADDR']!,
    mount: env['VAULT_TRANSIT_MOUNT']!,
    key: env['VAULT_TRANSIT_KEY']!,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 5000,
    ...(p.namespace ? { namespace: env['VAULT_NAMESPACE']! } : {}),
  };
  return cfg;
}

/** Auth provider desde env (hoy sólo token estático), o null si no está configurado. */
export function authDesdeEnv(env: Env): VaultAuthProvider | null {
  const token = env['VAULT_TOKEN'];
  if (typeof token === 'string' && token.length > 0) return new VaultTokenEstaticoAuth(token);
  return null;
}

function bloquePresencia(p: PresenciaConfig): string {
  return [
    '=== SOEC VAULT CONFIG PRESENCE ===',
    `VAULT_ADDR_PRESENT = ${p.addr ? 'YES' : 'NO'}`,
    `VAULT_NAMESPACE_PRESENT = ${p.namespace ? 'YES' : 'N/A'}`,
    `VAULT_TRANSIT_MOUNT_PRESENT = ${p.mount ? 'YES' : 'NO'}`,
    `VAULT_TRANSIT_KEY_PRESENT = ${p.key ? 'YES' : 'NO'}`,
    `AUTH_PROVIDER_PRESENT = ${p.auth ? 'YES' : 'NO'}`,
    '=== END ===',
  ].join('\n');
}

/** Resultado "config no lista": bloque completo en NOT_RUN + clasificación CONFIGURATION. */
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

export interface SalidaSmoke {
  readonly texto: string;
  readonly exitCode: number;
  readonly resultado: ResultadoSmoke;
}

/**
 * Orquesta el smoke y produce la salida estéril + exit code. `imprimir` es inyectable para tests (captura).
 * Exit codes: 0 = READY · 2 = config/auth ausente · 3 = adapter no productivo · 1 = fallo del smoke.
 */
export async function mainSmoke(env: Env, imprimir: (s: string) => void): Promise<SalidaSmoke> {
  const p = presenciaConfig(env);
  imprimir(bloquePresencia(p));

  const cfg = configDesdeEnv(env);
  const auth = authDesdeEnv(env);
  if (cfg === null || auth === null) {
    const r = resultadoConfigFaltante();
    const texto = formatearSalida(r);
    imprimir(texto);
    return { texto, exitCode: 2, resultado: r };
  }

  const kms = new VaultTransitKmsPort(cfg, new TransporteHttpVault(), auth);
  const backend = new EnvelopeSecretBackend(kms, new InMemoryCiphertextStore());

  // Safety gate: jamás correr el smoke de runtime sobre un backend no productivo (fake).
  if (!backend.esProductivo) {
    const r: ResultadoSmoke = { ...resultadoConfigFaltante(), configReady: true, failureClass: 'OTHER' };
    const texto = formatearSalida(r);
    imprimir(texto);
    return { texto, exitCode: 3, resultado: r };
  }

  const r = await ejecutarSmoke(backend);
  const texto = formatearSalida(r);
  imprimir(texto);
  return { texto, exitCode: exitCodeDe(r), resultado: r };
}

// --- Entry point (sólo cuando se invoca directamente; no al importarse en tests) ---
const invocadoDirecto = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invocadoDirecto) {
  void mainSmoke(process.env, (s) => process.stdout.write(`${s}\n`)).then((res) => {
    process.exit(res.exitCode);
  });
}
