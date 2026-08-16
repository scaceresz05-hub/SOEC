/**
 * Adaptador Vault Transit (`KmsPort`) — matriz adversarial. Secretos SINTÉTICOS; transporte fake fiel al
 * contrato HTTP de Transit; NUNCA se contacta un Vault real. Verifica el diseño envelope, el aislamiento de
 * secretos (el token Meta jamás viaja a Vault), la distinción indisponible/descifrado y el fail-closed.
 */
import { describe, expect, it } from 'vitest';
import { ActorId, OrganizationId, type RequestContext } from '@soec/contracts';
import {
  EnvelopeSecretBackend,
  InMemoryCiphertextStore,
  assertBackendSeguroEnProduccion,
} from '../src/acquisition/meta-secret-backend';
import {
  FakeTransporteVault,
  RE_VAULT_CIPHERTEXT,
  TransporteHttpVault,
  VaultAutenticacionError,
  VaultConfiguracionError,
  VaultDescifradoError,
  VaultNoDisponibleError,
  VaultRespuestaInvalidaError,
  VaultTokenEstaticoAuth,
  VaultTransitConfig,
  VaultTransitKmsPort,
  validarConfigVault,
} from '../src/acquisition/meta-vault-transit';

const TOKEN_META_SINTETICO = 'SYNTH_META_TOKEN_do_not_use_a1b2c3';
const VAULT_TOKEN = 'SYNTH_VAULT_TOKEN_xyz';

function cfg(over: Partial<VaultTransitConfig> = {}): VaultTransitConfig {
  return { addr: 'https://vault.example.test', mount: 'transit', key: 'soec-meta', timeoutMs: 2000, ...over };
}
function auth(): VaultTokenEstaticoAuth {
  return new VaultTokenEstaticoAuth(VAULT_TOKEN);
}
function ctx(org: string): RequestContext {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('t'), scope: { organizationId: o, permissions: ['events:read'] }, correlationId: 'c' };
}

describe('vault-transit · envelope (wrap/unwrap de la data key)', () => {
  it('WRAP_UNWRAP_ROUNDTRIP: unwrap(wrap(k)) === k, y wrap produce formato vault:vN:', async () => {
    const kms = new VaultTransitKmsPort(cfg(), new FakeTransporteVault(), auth());
    const dataKey = Buffer.from('0123456789abcdef0123456789abcdef'); // 32 bytes sintéticos
    const wrapped = await kms.wrapDataKey(dataKey);
    expect(RE_VAULT_CIPHERTEXT.test(wrapped.toString('utf8'))).toBe(true);
    const back = await kms.unwrapDataKey(wrapped);
    expect(back.equals(dataKey)).toBe(true);
  });

  it('END_TO_END con EnvelopeSecretBackend: store→resolve→delete un token Meta sintético', async () => {
    const transporte = new FakeTransporteVault();
    const kms = new VaultTransitKmsPort(cfg(), transporte, auth());
    const backend = new EnvelopeSecretBackend(kms, new InMemoryCiphertextStore());

    const { secretRef } = await backend.almacenar('org-smileflow', 'meta-user-token', TOKEN_META_SINTETICO);
    const resuelto = await backend.resolver(ctx('org-smileflow'), secretRef);
    expect(resuelto.usar((v) => v === TOKEN_META_SINTETICO)).toBe(true);

    await backend.revocar(secretRef);
    await expect(backend.resolver(ctx('org-smileflow'), secretRef)).rejects.toBeDefined();
  });

  it('META_TOKEN_NEVER_SENT_TO_VAULT: el token Meta jamás aparece en ninguna petición a Vault', async () => {
    const transporte = new FakeTransporteVault();
    const backend = new EnvelopeSecretBackend(new VaultTransitKmsPort(cfg(), transporte, auth()), new InMemoryCiphertextStore());
    const { secretRef } = await backend.almacenar('org-a', 'meta-user-token', TOKEN_META_SINTETICO);
    await backend.resolver(ctx('org-a'), secretRef);
    expect(transporte.peticiones.length).toBeGreaterThan(0);
    for (const p of transporte.peticiones) {
      const serial = JSON.stringify({ headers: p.headers, cuerpo: p.cuerpo });
      expect(serial).not.toContain(TOKEN_META_SINTETICO); // sólo la data key viaja a Transit, nunca el token
    }
  });
});

describe('vault-transit · cabeceras y contrato HTTP', () => {
  it('FORWARDS_TOKEN_AND_NAMESPACE: X-Vault-Token y X-Vault-Namespace se envían', async () => {
    const transporte = new FakeTransporteVault({ requiereNamespace: true });
    const kms = new VaultTransitKmsPort(cfg({ namespace: 'admin' }), transporte, auth());
    await kms.wrapDataKey(Buffer.from('k'.repeat(32)));
    const p = transporte.peticiones[0]!;
    expect(p.headers['X-Vault-Token']).toBe(VAULT_TOKEN);
    expect(p.headers['X-Vault-Namespace']).toBe('admin');
    expect(p.url).toContain('/v1/transit/encrypt/soec-meta');
  });

  it('NAMESPACE_REQUERIDO_SIN_NAMESPACE: Vault responde 400 → error de solicitud inválida', async () => {
    const kms = new VaultTransitKmsPort(cfg(), new FakeTransporteVault({ requiereNamespace: true }), auth());
    await expect(kms.wrapDataKey(Buffer.from('k'.repeat(32)))).rejects.toBeInstanceOf(VaultRespuestaInvalidaError);
  });
});

describe('vault-transit · distinción indisponible vs. fallo de descifrado (fail-closed)', () => {
  it('UNAVAILABLE_5xx → VaultNoDisponibleError', async () => {
    const kms = new VaultTransitKmsPort(cfg(), new FakeTransporteVault({ forzarStatus: 503 }), auth());
    await expect(kms.wrapDataKey(Buffer.from('k'.repeat(32)))).rejects.toBeInstanceOf(VaultNoDisponibleError);
  });

  it('TIMEOUT/RED → VaultNoDisponibleError', async () => {
    const kms = new VaultTransitKmsPort(cfg(), new FakeTransporteVault({ forzarTimeout: true }), auth());
    await expect(kms.wrapDataKey(Buffer.from('k'.repeat(32)))).rejects.toBeInstanceOf(VaultNoDisponibleError);
  });

  it('DECRYPT_FOREIGN_CIPHERTEXT → VaultDescifradoError (distinto de indisponible)', async () => {
    // Ciphertext con formato válido pero cifrado por OTRA master key (otro fake) ⇒ Vault 400 ⇒ descifrado.
    const ajeno = new VaultTransitKmsPort(cfg(), new FakeTransporteVault(), auth());
    const wrappedAjeno = await ajeno.wrapDataKey(Buffer.from('k'.repeat(32)));
    const propio = new VaultTransitKmsPort(cfg(), new FakeTransporteVault(), auth());
    await expect(propio.unwrapDataKey(wrappedAjeno)).rejects.toBeInstanceOf(VaultDescifradoError);
  });

  it('AUTH_401 → VaultAutenticacionError · MOUNT_404 → VaultConfiguracionError', async () => {
    const k401 = new VaultTransitKmsPort(cfg(), new FakeTransporteVault({ forzarStatus: 401 }), auth());
    await expect(k401.wrapDataKey(Buffer.from('k'.repeat(32)))).rejects.toBeInstanceOf(VaultAutenticacionError);
    const k404 = new VaultTransitKmsPort(cfg(), new FakeTransporteVault({ forzarStatus: 404 }), auth());
    await expect(k404.wrapDataKey(Buffer.from('k'.repeat(32)))).rejects.toBeInstanceOf(VaultConfiguracionError);
  });
});

describe('vault-transit · validación de formato y respuestas malformadas', () => {
  it('REJECT_MALFORMED_CIPHERTEXT_BEFORE_NETWORK: unwrap valida el prefijo antes de la red', async () => {
    const transporte = new FakeTransporteVault();
    const kms = new VaultTransitKmsPort(cfg(), transporte, auth());
    await expect(kms.unwrapDataKey(Buffer.from('esto-no-es-vault-ct', 'utf8'))).rejects.toBeInstanceOf(VaultRespuestaInvalidaError);
    expect(transporte.peticiones.length).toBe(0); // fail-closed: nunca salió a la red
  });

  it('MALFORMED_200_RESPONSE → VaultRespuestaInvalidaError (encrypt y decrypt)', async () => {
    const kEnc = new VaultTransitKmsPort(cfg(), new FakeTransporteVault({ forzarMalformado: true }), auth());
    await expect(kEnc.wrapDataKey(Buffer.from('k'.repeat(32)))).rejects.toBeInstanceOf(VaultRespuestaInvalidaError);
    // decrypt: primero produzco un ciphertext válido y luego fuerzo body malformado en el unwrap
    const real = new FakeTransporteVault();
    const kValido = new VaultTransitKmsPort(cfg(), real, auth());
    const wrapped = await kValido.wrapDataKey(Buffer.from('k'.repeat(32)));
    const kDec = new VaultTransitKmsPort(cfg(), new FakeTransporteVault({ forzarMalformado: true }), auth());
    await expect(kDec.unwrapDataKey(wrapped)).rejects.toBeInstanceOf(VaultRespuestaInvalidaError);
  });
});

describe('vault-transit · rotación (rewrap) contractual', () => {
  it('REWRAP_ROUNDTRIP: rewrap produce vault:v2 y sigue descifrando a la misma data key', async () => {
    const transporte = new FakeTransporteVault();
    const kms = new VaultTransitKmsPort(cfg(), transporte, auth());
    const dataKey = Buffer.from('k'.repeat(32));
    const wrapped = await kms.wrapDataKey(dataKey);
    const rewrapped = await kms.reenvolverDataKey(wrapped);
    expect(rewrapped.toString('utf8')).toMatch(/^vault:v2:/);
    const back = await kms.unwrapDataKey(rewrapped);
    expect(back.equals(dataKey)).toBe(true);
  });
});

describe('vault-transit · salud/readiness', () => {
  it('SALUD mapea health status: 200→AVAILABLE, 503→UNAVAILABLE, 501→MISCONFIGURED', async () => {
    expect(await new VaultTransitKmsPort(cfg(), new FakeTransporteVault({ forzarSalud: 200 }), auth()).salud()).toBe('AVAILABLE');
    expect(await new VaultTransitKmsPort(cfg(), new FakeTransporteVault({ forzarSalud: 503 }), auth()).salud()).toBe('UNAVAILABLE');
    expect(await new VaultTransitKmsPort(cfg(), new FakeTransporteVault({ forzarSalud: 501 }), auth()).salud()).toBe('MISCONFIGURED');
    expect(await new VaultTransitKmsPort(cfg(), new FakeTransporteVault({ forzarTimeout: true }), auth()).salud()).toBe('UNAVAILABLE');
  });
});

describe('vault-transit · configuración y gate de producción', () => {
  it('CONFIG_INCOMPLETA → VaultConfiguracionError', () => {
    expect(() => validarConfigVault(cfg({ addr: '' }))).toThrow(VaultConfiguracionError);
    expect(() => validarConfigVault(cfg({ mount: '' }))).toThrow(VaultConfiguracionError);
    expect(() => validarConfigVault(cfg({ key: '' }))).toThrow(VaultConfiguracionError);
    expect(() => validarConfigVault(cfg({ timeoutMs: 0 }))).toThrow(VaultConfiguracionError);
    expect(() => new VaultTokenEstaticoAuth('')).toThrow(VaultConfiguracionError);
  });

  it('ES_PRODUCTIVO: fake⇒false (bloquea gate), transporte HTTP real⇒true', () => {
    const conFake = new VaultTransitKmsPort(cfg(), new FakeTransporteVault(), auth());
    expect(conFake.esProductivo).toBe(false);
    expect(() => assertBackendSeguroEnProduccion('production', conFake)).toThrow();
    const conReal = new VaultTransitKmsPort(cfg(), new TransporteHttpVault(), auth());
    expect(conReal.esProductivo).toBe(true); // construir NO hace red
  });
});

describe('vault-transit · sanitización de errores', () => {
  it('ERROR_MESSAGE_SANITIZED: un mensaje con token embebido se redacta', () => {
    const e = new VaultNoDisponibleError('fallo con ?access_token=SECRETO_XYZ y Bearer SECRETO_ABC');
    expect(e.message).not.toContain('SECRETO_XYZ');
    expect(e.message).not.toContain('SECRETO_ABC');
    expect(e.message).toContain('[REDACTED]');
  });
});
