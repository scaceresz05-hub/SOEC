/**
 * Smoke harness de Vault Transit — matriz adversarial. Sin red real; secretos SINTÉTICOS. Verifica el
 * fail-closed de config, la prohibición del fake para el veredicto READY, la ESTERILIDAD de la salida
 * (ningún secreto en stdout), la sanitización de errores de auth, el cleanup ante fallo, el aislamiento por
 * tenant, la política de exit code y la AUSENCIA de cualquier acoplamiento a Meta.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EnvelopeSecretBackend, InMemoryCiphertextStore } from '../src/acquisition/meta-secret-backend';
import { FakeTransporteVault, VaultTokenEstaticoAuth, VaultTransitKmsPort, type PeticionHttpVault, type RespuestaHttpVault, type TransporteVault, type VaultTransitConfig } from '../src/acquisition/meta-vault-transit';
import { ejecutarSmoke, exitCodeDe, formatearSalida } from '../src/acquisition/vault-smoke';
import { authDesdeEnv, configDesdeEnv, mainSmoke, presenciaConfig } from '../src/acquisition/vault-smoke.cli';

const CFG: VaultTransitConfig = { addr: 'https://vault.example.test', mount: 'transit', key: 'soec-meta', timeoutMs: 2000 };
const AUTH = () => new VaultTokenEstaticoAuth('SYNTH_VAULT_TOKEN');
const SECRETO_CONOCIDO = 'SYNTH_SMOKE_SECRET_zzz_do_not_use';

/** Transporte que REPORTA productivo pero usa cripto en memoria (para ejercer el camino READY sin red). */
function transporteProductivoSim(): TransporteVault {
  const fake = new FakeTransporteVault();
  return { esProductivo: true, enviar: (req) => fake.enviar(req) };
}
function backendConTransporte(t: TransporteVault): EnvelopeSecretBackend {
  return new EnvelopeSecretBackend(new VaultTransitKmsPort(CFG, t, AUTH()), new InMemoryCiphertextStore());
}

describe('vault-smoke · camino feliz (adapter productivo simulado, sin red)', () => {
  it('READY: store/resolve/roundtrip/cross-tenant/cleanup todos verdes', async () => {
    const r = await ejecutarSmoke(backendConTransporte(transporteProductivoSim()), { generarSecreto: () => SECRETO_CONOCIDO });
    expect(r.store).toBe('PASS');
    expect(r.resolve).toBe('PASS');
    expect(r.roundTripMatch).toBe('YES');
    expect(r.crossTenantResolve).toBe('REJECT');
    expect(r.delete).toBe('PASS');
    expect(r.resolveAfterDelete).toBe('FAIL_EXPECTED');
    expect(r.orphanSecret).toBe('NO');
    expect(r.productionSecretBackend).toBe('READY');
    expect(exitCodeDe(r)).toBe(0);
  });

  it('SALIDA_ESTERIL: ni el resultado ni la salida formateada contienen el secreto sintético', async () => {
    const r = await ejecutarSmoke(backendConTransporte(transporteProductivoSim()), { generarSecreto: () => SECRETO_CONOCIDO });
    const salida = formatearSalida(r);
    expect(salida).not.toContain(SECRETO_CONOCIDO);
    expect(JSON.stringify(r)).not.toContain(SECRETO_CONOCIDO);
    expect(salida).toContain('PRODUCTION_SECRET_BACKEND = READY');
    expect(salida).not.toContain('Bearer');
    expect(salida).not.toContain('access_token');
  });
});

describe('vault-smoke · fake prohibido para el veredicto READY', () => {
  it('FAKE_NO_ES_READY: un backend no productivo nunca alcanza READY aunque los pasos pasen', async () => {
    const r = await ejecutarSmoke(backendConTransporte(new FakeTransporteVault())); // esProductivo=false
    expect(r.productionAdapter).toBe(false);
    expect(r.roundTripMatch).toBe('YES'); // los pasos funcionan…
    expect(r.productionSecretBackend).not.toBe('READY'); // …pero el veredicto exige adapter productivo
    expect(exitCodeDe(r)).toBe(1);
  });
});

describe('vault-smoke · sanitización de errores de auth', () => {
  it('AUTH_401 → auth FAIL + failureClass AUTH, sin fuga en la salida', async () => {
    const r = await ejecutarSmoke(backendConTransporte({ esProductivo: true, enviar: async (req: PeticionHttpVault): Promise<RespuestaHttpVault> => {
      if (req.url.endsWith('/sys/health')) return { status: 200, ok: true, json: { initialized: true, sealed: false } };
      return { status: 401, ok: false, json: { errors: ['permission denied'] } };
    } }));
    expect(r.auth).toBe('FAIL');
    expect(r.failureClass).toBe('AUTH');
    expect(r.productionSecretBackend).toBe('FAILED');
    const salida = formatearSalida(r);
    expect(salida).not.toContain('SYNTH_VAULT_TOKEN');
    expect(salida).not.toContain('permission denied'); // el body crudo nunca llega a la salida
  });
});

describe('vault-smoke · cleanup garantizado ante fallo', () => {
  it('DECRYPT_CAIDO: resolve falla pero el finally limpia (delete PASS, sin huérfano)', async () => {
    const fake = new FakeTransporteVault();
    const backend = backendConTransporte({ esProductivo: true, enviar: async (req) => {
      if (req.url.includes('/decrypt/')) return { status: 503, ok: false, json: { errors: ['sealed'] } };
      return fake.enviar(req);
    } });
    const r = await ejecutarSmoke(backend);
    expect(r.store).toBe('PASS');
    expect(r.resolve).toBe('FAIL');
    expect(r.failureClass).toBe('NETWORK_EGRESS');
    expect(r.delete).toBe('PASS'); // compensación en finally
    expect(r.resolveAfterDelete).toBe('FAIL_EXPECTED');
    expect(r.orphanSecret).toBe('NO');
  });
});

describe('vault-smoke · health no disponible corta antes del round-trip', () => {
  it('SEALED_503 → UNAVAILABLE, IMPLEMENTED_NOT_VERIFIED, sin store', async () => {
    const r = await ejecutarSmoke(backendConTransporte(new FakeTransporteVault({ forzarSalud: 503 })));
    expect(r.vaultHealth).toBe('UNAVAILABLE');
    expect(r.store).toBe('NOT_RUN');
    expect(r.productionSecretBackend).toBe('IMPLEMENTED_NOT_VERIFIED');
  });
});

describe('vault-smoke · CLI: fail-closed de config y presencia', () => {
  it('CONFIG_AUSENTE → exit 2, CONFIG_READY NO, FAILURE_CLASS CONFIGURATION, sin arrancar el smoke', async () => {
    const lineas: string[] = [];
    const res = await mainSmoke({}, (s) => lineas.push(s));
    expect(res.exitCode).toBe(2);
    const salida = lineas.join('\n');
    expect(salida).toContain('VAULT_ADDR_PRESENT = NO');
    expect(salida).toContain('CONFIG_READY = NO');
    expect(salida).toContain('FAILURE_CLASS = CONFIGURATION');
    expect(salida).toContain('VAULT_HEALTH = NOT_RUN');
  });

  it('PRESENCIA sin valores: sólo booleanos', () => {
    const p = presenciaConfig({ VAULT_ADDR: 'https://x', VAULT_TRANSIT_MOUNT: 'transit', VAULT_TRANSIT_KEY: 'k', VAULT_TOKEN: 'secreto' });
    expect(p).toEqual({ addr: true, namespace: false, mount: true, key: true, auth: true });
    expect(configDesdeEnv({ VAULT_ADDR: 'https://x', VAULT_TRANSIT_MOUNT: 'transit', VAULT_TRANSIT_KEY: 'k' })).not.toBeNull();
    expect(configDesdeEnv({ VAULT_ADDR: 'https://x' })).toBeNull(); // falta mount/key
    expect(authDesdeEnv({})).toBeNull();
    expect(authDesdeEnv({ VAULT_TOKEN: 't' })).not.toBeNull();
  });
});

describe('vault-smoke · sin acoplamiento a Meta', () => {
  it('NO_META: el harness no referencia Graph/OAuth/App de Meta', () => {
    const fuentes = ['../src/acquisition/vault-smoke.ts', '../src/acquisition/vault-smoke.cli.ts'].map((rel) => readFileSync(new URL(rel, import.meta.url), 'utf8'));
    const prohibidos = ['graph.facebook.com', 'dialog/oauth', 'exchangeAuthorizationCode', 'client_id', 'appsecret_proof', 'MetaOAuth', 'access_token='];
    for (const src of fuentes) {
      for (const token of prohibidos) expect(src.includes(token)).toBe(false);
    }
  });
});
