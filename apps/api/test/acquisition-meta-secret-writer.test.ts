/**
 * Wiring del SecretWriter PRODUCTIVO (EnvelopeSecretBackend + AWS KMS) al flujo OAuth de Meta.
 * Sin AWS/Meta reales: KMS fake + MetaOAuthFake. Verifica que el token OAuth se almacene como secretRef
 * (nunca plaintext en DB/DTO) y que JAMÁS viaje a AWS KMS (sólo la data key).
 */
import { describe, expect, it } from 'vitest';
import { EnvelopeSecretBackend, InMemoryCiphertextStore, type CiphertextStore } from '../src/acquisition/meta-secret-backend';
import { AwsKmsPort } from '../src/acquisition/aws-kms';
import { ClienteKmsProductivoSimulado } from '../src/acquisition/aws-kms-fake';
import { crearSecretWriterEnvelope, esSecretWriter } from '../src/acquisition/meta-secret-writer';
import { configMetaOAuthDesdeEnv, presenciaMetaOAuth } from '../src/acquisition/meta-config';
import {
  InMemoryOAuthStateStore,
  InMemoryCredentialRepo,
  InMemoryConnectionRepo,
  MetaOAuthFake,
  metaSecretWriterStatus,
  iniciarConexionMeta,
  procesarCallbackMeta,
  aConexionDTO,
  type ProcesarCallbackDeps,
} from '../src/acquisition/meta-oauth-flow';

const REQUIRED = ['pages_show_list', 'business_management', 'instagram_basic', 'pages_read_engagement', 'instagram_manage_insights', 'ads_read'];
const CFG_KMS = { region: 'us-east-1', keyId: 'alias/soec-production-secrets', timeoutMs: 2000, maxAttempts: 3 };
// El token que devuelve MetaOAuthFake (lo que NUNCA debe filtrarse ni llegar a KMS).
const TOKEN_FAKE = 'SYNTH_FAKE_TOKEN_do_not_use';

function writerProductivo(): { writer: EnvelopeSecretBackend; kms: ClienteKmsProductivoSimulado; store: CiphertextStore } {
  const kms = new ClienteKmsProductivoSimulado();
  const store = new InMemoryCiphertextStore();
  const writer = crearSecretWriterEnvelope(new AwsKmsPort(CFG_KMS, kms), store);
  return { writer, kms, store };
}

describe('meta-secret-writer · tipo y estado', () => {
  it('EnvelopeSecretBackend es SecretWriterPort y con KMS productivo ⇒ WIRED', () => {
    const { writer } = writerProductivo();
    expect(esSecretWriter(writer).nombre).toBe('envelope-kms');
    expect(writer.esProductivo).toBe(true);
    expect(metaSecretWriterStatus(writer)).toBe('WIRED');
  });
});

describe('meta-secret-writer · callback end-to-end (token → secretRef, nunca a KMS)', () => {
  it('almacena el token como secretRef; DTO sin token; KMS sólo recibe la data key (32B); ciphertext store sin plaintext', async () => {
    const stateStore = new InMemoryOAuthStateStore();
    const credRepo = new InMemoryCredentialRepo();
    const connRepo = new InMemoryConnectionRepo();
    const { writer, kms, store } = writerProductivo();

    const { stateValor } = await iniciarConexionMeta(
      { stateStore, appId: 'APP', redirectUri: 'https://soec/cb', graphVersion: 'v26.0', nonce: 'nonce-impredecible-0123456789abcdef', ahora: '2026-08-17T12:00:00.000Z', ttlMs: 600_000 },
      'org-smileflow',
      'actor-1',
    );

    const deps: ProcesarCallbackDeps = {
      stateStore,
      oauth: new MetaOAuthFake({ effectiveScopes: REQUIRED, expiresAt: null }),
      secretWriter: writer,
      credRepo,
      connRepo,
      descubrir: async () => [],
      redirectUri: 'https://soec/cb',
      ahora: '2026-08-17T12:00:00.000Z',
    };
    const res = await procesarCallbackMeta(deps, { stateValor, organizationIdCallback: 'org-smileflow', code: 'CODE' });

    expect(res.estado).toBe('BINDING_PENDING'); // nunca CONNECTED automático
    expect(res.connectionId).not.toBeNull();

    // La credencial guarda SÓLO un secretRef opaco (no el token).
    const cred = await credRepo.obtener('org-smileflow', res.connectionId!);
    expect(cred).not.toBeNull();
    expect(cred!.secretRef).toMatch(/^secretstore:org-smileflow\//);
    expect(JSON.stringify(cred)).not.toContain(TOKEN_FAKE);

    // El DTO de conexión no expone token ni secretRef.
    const reg = await connRepo.obtener('org-smileflow', res.connectionId!);
    expect(JSON.stringify(aConexionDTO(reg!.conexion))).not.toContain(TOKEN_FAKE);

    // El token JAMÁS viaja a AWS KMS: sólo data keys de 32 bytes.
    expect(kms.plaintextsEnviados.length).toBeGreaterThan(0);
    for (const pt of kms.plaintextsEnviados) {
      expect(pt.length).toBe(32);
      expect(pt.toString('latin1')).not.toContain(TOKEN_FAKE);
    }

    // El ciphertext store NO contiene el token en claro.
    const blob = await store.get('org-smileflow/' + `meta-user-token-${res.connectionId}`);
    expect(blob).not.toBeNull();
    expect(JSON.stringify(blob)).not.toContain(TOKEN_FAKE);
  });

  it('SECRET_WRITER_FAILURE ⇒ no CONNECTED (fail-closed): si el store falla, no se persiste credencial', async () => {
    const stateStore = new InMemoryOAuthStateStore();
    const credRepo = new InMemoryCredentialRepo();
    // KMS que falla el wrap ⇒ almacenar lanza ⇒ callback fail-closed.
    const kmsRoto = new AwsKmsPort(CFG_KMS, new ClienteKmsProductivoSimulado({ permissionFailure: true }));
    const writer = new EnvelopeSecretBackend(kmsRoto, new InMemoryCiphertextStore());

    const { stateValor } = await iniciarConexionMeta(
      { stateStore, appId: 'APP', redirectUri: 'https://soec/cb', graphVersion: 'v26.0', nonce: 'nonce-impredecible-0123456789abcdef', ahora: '2026-08-17T12:00:00.000Z', ttlMs: 600_000 },
      'org-a',
      'actor-1',
    );
    const res = await procesarCallbackMeta(
      { stateStore, oauth: new MetaOAuthFake({ effectiveScopes: REQUIRED, expiresAt: null }), secretWriter: writer, credRepo, connRepo: new InMemoryConnectionRepo(), descubrir: async () => [], redirectUri: 'https://soec/cb', ahora: '2026-08-17T12:00:00.000Z' },
      { stateValor, organizationIdCallback: 'org-a', code: 'CODE' },
    );
    expect(res.estado).toBe('NOT_CONNECTED');
    expect(await credRepo.obtener('org-a', 'meta-org-a')).toBeNull();
  });
});

describe('meta-config · contrato productivo fail-closed', () => {
  it('presencia + config desde env (sin exponer valores)', () => {
    expect(presenciaMetaOAuth({})).toEqual({ appId: false, appSecret: false, redirectUri: false });
    expect(configMetaOAuthDesdeEnv({})).toBeNull();
    expect(configMetaOAuthDesdeEnv({ META_APP_ID: 'x', META_APP_SECRET: 's', META_OAUTH_REDIRECT_URI: 'http://insecure' })).toBeNull(); // exige https
    const cfg = configMetaOAuthDesdeEnv({ META_APP_ID: 'x', META_APP_SECRET: 's', META_OAUTH_REDIRECT_URI: 'https://soec/cb' });
    expect(cfg).not.toBeNull();
    expect(cfg!.graphVersion).toBe('v26.0');
  });
});
