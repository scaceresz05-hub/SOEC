/**
 * Backend AWS KMS — matriz adversarial. Sin AWS real; cripto en memoria (fake). Verifica el diseño envelope,
 * que SÓLO la data key viaja a KMS (nunca el token Meta), EncryptionContext/KeyId, fail-closed, aislamiento
 * por tenant, cleanup, esterilidad de la salida y AUSENCIA de acoplamiento a Meta.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ActorId, OrganizationId, type RequestContext } from '@soec/contracts';
import { EnvelopeSecretBackend, InMemoryCiphertextStore } from '../src/acquisition/meta-secret-backend';
import {
  AwsKmsAutenticacionError,
  AwsKmsConfiguracionError,
  AwsKmsDescifradoError,
  AwsKmsKeyNoEncontradaError,
  AwsKmsPermisoError,
  AwsKmsRespuestaInvalidaError,
  AwsKmsTimeoutError,
  AwsKmsPort,
  ENCRYPTION_CONTEXT,
  clasificarErrorKms,
  validarConfigAwsKms,
  type ClienteKms,
  type ConfigAwsKms,
  type EntradaDecrypt,
  type EntradaEncrypt,
  type SalidaDecrypt,
  type SalidaEncrypt,
  type SaludKey,
} from '../src/acquisition/aws-kms';
import { ClienteKmsProductivoSimulado, FakeClienteKms } from '../src/acquisition/aws-kms-fake';
import { traducirErrorSdk } from '../src/acquisition/aws-kms-sdk';
import { ejecutarSmoke, exitCodeDe } from '../src/acquisition/vault-smoke';
import { formatearSalidaKms, mainSmokeKms } from '../src/acquisition/kms-smoke.cli';

const CFG: ConfigAwsKms = { region: 'us-east-1', keyId: 'alias/soec-production-secrets', timeoutMs: 2000, maxAttempts: 3 };
const TOKEN_META = 'SYNTH_META_TOKEN_do_not_use_e2e_9x';
const SECRETO_CONOCIDO = 'SYNTH_KMS_SECRET_zzz_do_not_use';

function ctx(org: string): RequestContext {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('t'), scope: { organizationId: o, permissions: ['events:read'] }, correlationId: 'c' };
}
function port(cliente: ClienteKms): AwsKmsPort {
  return new AwsKmsPort(CFG, cliente);
}
function backend(cliente: ClienteKms): EnvelopeSecretBackend {
  return new EnvelopeSecretBackend(port(cliente), new InMemoryCiphertextStore());
}

describe('aws-kms · envelope (wrap/unwrap de la data key)', () => {
  it('A/B ROUND_TRIP: unwrap(wrap(dataKey)) === dataKey', async () => {
    const p = port(new FakeClienteKms());
    const dataKey = Buffer.from('0123456789abcdef0123456789abcdef'); // 32 bytes
    const wrapped = await p.wrapDataKey(dataKey);
    expect(wrapped.length).toBeGreaterThan(0);
    expect((await p.unwrapDataKey(wrapped)).equals(dataKey)).toBe(true);
  });

  it('C HEALTH: describeKey enabled ⇒ AVAILABLE; disabled ⇒ MISCONFIGURED', async () => {
    expect(await port(new FakeClienteKms()).salud()).toBe('AVAILABLE');
    expect(await port(new FakeClienteKms({ keyDisabled: true })).salud()).toBe('MISCONFIGURED');
  });

  it('D ENCRYPTION_CONTEXT: un contexto distinto en Decrypt rompe la autenticación (AAD)', async () => {
    const c = new FakeClienteKms();
    const { ciphertextBlob } = await c.encrypt({ keyId: CFG.keyId, plaintext: Buffer.alloc(32, 7), encryptionContext: ENCRYPTION_CONTEXT });
    await expect(c.decrypt({ keyId: CFG.keyId, ciphertextBlob, encryptionContext: { app: 'otro', purpose: 'x' } })).rejects.toBeInstanceOf(AwsKmsDescifradoError);
    expect(ENCRYPTION_CONTEXT).toEqual({ app: 'soec', purpose: 'envelope-data-key' });
  });

  it('E/F KEY_ID explícito en Encrypt y Decrypt', async () => {
    const vistos: { encKey?: string; decKey?: string; ctxEnc?: Record<string, string>; ctxDec?: Record<string, string> } = {};
    const fake = new FakeClienteKms();
    const espia: ClienteKms = {
      esProductivo: true,
      async encrypt(e: EntradaEncrypt): Promise<SalidaEncrypt> {
        vistos.encKey = e.keyId;
        vistos.ctxEnc = { ...e.encryptionContext };
        return fake.encrypt(e);
      },
      async decrypt(e: EntradaDecrypt): Promise<SalidaDecrypt> {
        vistos.decKey = e.keyId;
        vistos.ctxDec = { ...e.encryptionContext };
        return fake.decrypt(e);
      },
      describeKey(k: string): Promise<SaludKey> {
        return fake.describeKey(k);
      },
    };
    const p = port(espia);
    const wrapped = await p.wrapDataKey(Buffer.alloc(32, 1));
    await p.unwrapDataKey(wrapped);
    expect(vistos.encKey).toBe(CFG.keyId);
    expect(vistos.decKey).toBe(CFG.keyId);
    expect(vistos.ctxEnc).toEqual(ENCRYPTION_CONTEXT);
    expect(vistos.ctxDec).toEqual(ENCRYPTION_CONTEXT);
  });

  it('G/H SÓLO la data key (32B) viaja a KMS; el token Meta NUNCA', async () => {
    const cliente = new ClienteKmsProductivoSimulado();
    const be = new EnvelopeSecretBackend(port(cliente), new InMemoryCiphertextStore());
    const { secretRef } = await be.almacenar('org-smileflow', 'meta-user-token', TOKEN_META);
    await be.resolver(ctx('org-smileflow'), secretRef);
    expect(cliente.plaintextsEnviados.length).toBeGreaterThan(0);
    for (const pt of cliente.plaintextsEnviados) {
      expect(pt.length).toBe(32); // sólo data keys de 32 bytes
      expect(pt.toString('utf8')).not.toContain(TOKEN_META);
      expect(pt.toString('latin1')).not.toContain(TOKEN_META);
    }
  });
});

describe('aws-kms · validación y fail-closed', () => {
  it('I DATA_KEY_TAMANO_INVALIDO pre-red: no llama a KMS', async () => {
    const cliente = new FakeClienteKms();
    await expect(port(cliente).wrapDataKey(Buffer.alloc(16))).rejects.toBeInstanceOf(AwsKmsConfiguracionError);
    expect(cliente.plaintextsEnviados.length).toBe(0);
  });
  it('J PLAINTEXT_DECRYPT_TAMANO_INVALIDO ⇒ RespuestaInvalida', async () => {
    const bueno = new FakeClienteKms();
    const wrapped = await port(bueno).wrapDataKey(Buffer.alloc(32, 3));
    await expect(port(new FakeClienteKms({ plaintextTamanoInvalido: true })).unwrapDataKey(wrapped)).rejects.toBeInstanceOf(AwsKmsRespuestaInvalidaError);
  });
  it('K/L/M/N/O errores tipados: auth, permiso, timeout, malformed, key-not-found', async () => {
    await expect(port(new FakeClienteKms({ authFailure: true })).wrapDataKey(Buffer.alloc(32))).rejects.toBeInstanceOf(AwsKmsAutenticacionError);
    await expect(port(new FakeClienteKms({ permissionFailure: true })).wrapDataKey(Buffer.alloc(32))).rejects.toBeInstanceOf(AwsKmsPermisoError);
    await expect(port(new FakeClienteKms({ timeout: true })).wrapDataKey(Buffer.alloc(32))).rejects.toBeInstanceOf(AwsKmsTimeoutError);
    await expect(port(new FakeClienteKms({ malformedResponse: true })).wrapDataKey(Buffer.alloc(32))).rejects.toBeInstanceOf(AwsKmsRespuestaInvalidaError);
    await expect(port(new FakeClienteKms({ keyNotFound: true })).wrapDataKey(Buffer.alloc(32))).rejects.toBeInstanceOf(AwsKmsKeyNoEncontradaError);
  });
  it('CONFIG incompleta ⇒ AwsKmsConfiguracionError', () => {
    expect(() => validarConfigAwsKms({ ...CFG, region: '' })).toThrow(AwsKmsConfiguracionError);
    expect(() => validarConfigAwsKms({ ...CFG, keyId: '' })).toThrow(AwsKmsConfiguracionError);
    expect(() => validarConfigAwsKms({ ...CFG, timeoutMs: 0 })).toThrow(AwsKmsConfiguracionError);
    expect(() => validarConfigAwsKms({ ...CFG, maxAttempts: 0 })).toThrow(AwsKmsConfiguracionError);
  });
});

describe('aws-kms · smoke (core reutilizado)', () => {
  it('Q/R HAPPY: store/resolve/roundtrip/cross-tenant/cleanup ⇒ READY (adapter productivo simulado)', async () => {
    const r = await ejecutarSmoke(backend(new ClienteKmsProductivoSimulado()), { generarSecreto: () => SECRETO_CONOCIDO });
    expect(r.store).toBe('PASS');
    expect(r.roundTripMatch).toBe('YES');
    expect(r.crossTenantResolve).toBe('REJECT');
    expect(r.delete).toBe('PASS');
    expect(r.resolveAfterDelete).toBe('FAIL_EXPECTED');
    expect(r.orphanSecret).toBe('NO');
    expect(r.productionSecretBackend).toBe('READY');
    expect(exitCodeDe(r)).toBe(0);
  });

  it('P FAKE_NO_ES_READY: backend no productivo nunca alcanza READY aunque pase el round-trip', async () => {
    const r = await ejecutarSmoke(backend(new FakeClienteKms()));
    expect(r.productionAdapter).toBe(false);
    expect(r.roundTripMatch).toBe('YES');
    expect(r.productionSecretBackend).not.toBe('READY');
  });

  it('R CLEANUP en fallo: si resolve falla, el finally limpia (delete PASS, sin huérfano)', async () => {
    const bueno = new FakeClienteKms();
    // cliente productivo que cifra OK pero cuyo decrypt no está disponible
    const inestable: ClienteKms = {
      esProductivo: true,
      encrypt: (e) => bueno.encrypt(e),
      decrypt: async () => {
        throw new AwsKmsTimeoutError('decrypt no disponible');
      },
      describeKey: (k) => bueno.describeKey(k),
    };
    const r = await ejecutarSmoke(backend(inestable), { clasificarError: clasificarErrorKms });
    expect(r.store).toBe('PASS');
    expect(r.resolve).toBe('FAIL');
    expect(r.failureClass).toBe('TIMEOUT');
    expect(r.delete).toBe('PASS');
    expect(r.resolveAfterDelete).toBe('FAIL_EXPECTED');
    expect(r.orphanSecret).toBe('NO');
  });

  it('S/T ESTERILIDAD: ni el resultado ni la salida contienen el secreto', async () => {
    const r = await ejecutarSmoke(backend(new ClienteKmsProductivoSimulado()), { generarSecreto: () => SECRETO_CONOCIDO });
    const salida = formatearSalidaKms(r);
    expect(salida).not.toContain(SECRETO_CONOCIDO);
    expect(JSON.stringify(r)).not.toContain(SECRETO_CONOCIDO);
    expect(salida).toContain('PRODUCTION_SECRET_BACKEND = READY');
    expect(salida).not.toContain('AKIA');
  });
});

describe('aws-kms · CLI fail-closed y no-Meta', () => {
  it('V CONFIG_AUSENTE ⇒ exit 2, CONFIGURATION, sin arrancar', async () => {
    const lineas: string[] = [];
    const res = await mainSmokeKms({}, (s) => lineas.push(s));
    expect(res.exitCode).toBe(2);
    const salida = lineas.join('\n');
    expect(salida).toContain('AWS_REGION_PRESENT = NO');
    expect(salida).toContain('CONFIG_READY = NO');
    expect(salida).toContain('FAILURE_CLASS = CONFIGURATION');
    expect(salida).toContain('KMS_HEALTH = NOT_RUN');
  });
  it('CONFIG sin credenciales ⇒ CONFIGURATION (no intenta conexión)', async () => {
    const res = await mainSmokeKms({ AWS_REGION: 'us-east-1', SOEC_KMS_KEY_ID: 'alias/x' }, () => {});
    expect(res.exitCode).toBe(2);
    expect(res.resultado.failureClass).toBe('CONFIGURATION');
  });
  it('SDK_ERROR_MAP: firma incompleta ⇒ AUTH; AccessDenied ⇒ PERMISSION; NotFound ⇒ KEY_NOT_FOUND', () => {
    // Regresión del defecto detectado por el smoke real: IncompleteSignatureException (HTTP 400) mal
    // clasificado como no-disponible; ahora es AUTH (credencial/firma inválida).
    expect(traducirErrorSdk({ name: 'IncompleteSignatureException', $metadata: { httpStatusCode: 400 } }, 'describeKey')).toBeInstanceOf(AwsKmsAutenticacionError);
    expect(traducirErrorSdk({ name: 'SignatureDoesNotMatch' }, 'encrypt')).toBeInstanceOf(AwsKmsAutenticacionError);
    expect(traducirErrorSdk({ name: 'AccessDeniedException', $metadata: { httpStatusCode: 400 } }, 'decrypt')).toBeInstanceOf(AwsKmsPermisoError);
    expect(traducirErrorSdk({ name: 'NotFoundException' }, 'describeKey')).toBeInstanceOf(AwsKmsKeyNoEncontradaError);
    expect(traducirErrorSdk({ name: 'TimeoutError' }, 'describeKey')).toBeInstanceOf(AwsKmsTimeoutError);
  });

  it('U NO_META: los fuentes AWS KMS no referencian Graph/OAuth/App de Meta', () => {
    const fuentes = ['../src/acquisition/aws-kms.ts', '../src/acquisition/aws-kms-sdk.ts', '../src/acquisition/aws-kms-fake.ts', '../src/acquisition/kms-smoke.cli.ts'].map((rel) => readFileSync(new URL(rel, import.meta.url), 'utf8'));
    const prohibidos = ['graph.facebook.com', 'dialog/oauth', 'exchangeAuthorizationCode', 'client_id', 'appsecret_proof', 'MetaOAuth', 'access_token='];
    for (const src of fuentes) for (const t of prohibidos) expect(src.includes(t)).toBe(false);
  });
});
