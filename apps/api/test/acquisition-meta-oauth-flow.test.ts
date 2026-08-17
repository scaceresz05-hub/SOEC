/**
 * Meta OAuth production flow — matriz de seguridad (FASE 26). Sin OAuth/token/Graph reales; FAKES.
 */
import { describe, expect, it } from 'vitest';
import {
  InMemoryOAuthStateStore,
  InMemoryCredentialRepo,
  InMemoryConnectionRepo,
  SecretWriterFake,
  MetaOAuthFake,
  metaSecretWriterStatus,
  construirAuthorizationUrl,
  iniciarConexionMeta,
  procesarCallbackMeta,
  confirmarBindingMeta,
  aConexionDTO,
  type ProcesarCallbackDeps,
} from '../src/acquisition/meta-oauth-flow';
import { credencialSinPlaintext, type ConexionMeta } from '../src/acquisition/meta-onboarding';
import { redactarSecretos } from '../src/acquisition/meta-organic';
import type { CandidatoActivo } from '../src/acquisition/meta-oauth';

const AHORA = '2026-08-16T12:00:00.000Z';
const NONCE = 'nonce-impredecible-0123456789abcdef';
const REQUIRED = ['pages_show_list', 'business_management', 'instagram_basic', 'pages_read_engagement', 'instagram_manage_insights', 'ads_read'];
const PAGE_SMILEFLOW: CandidatoActivo = { provider: 'meta', assetType: 'page', externalId: '1066708446525633', displayName: 'Smileflow.clinic', provenance: 'GRAPH_OBSERVED' };
const PAGE_SC: CandidatoActivo = { provider: 'meta', assetType: 'page', externalId: '100558733139736', displayName: 'SC Topografía', provenance: 'GRAPH_OBSERVED' };

async function iniciar(store: InMemoryOAuthStateStore, org = 'org-smileflow') {
  return iniciarConexionMeta({ stateStore: store, appId: 'APP', redirectUri: 'https://soec/cb', graphVersion: 'v26.0', nonce: NONCE, ahora: AHORA, ttlMs: 600_000 }, org, 'actor-1');
}

function callbackDeps(over: Partial<ProcesarCallbackDeps> & Pick<ProcesarCallbackDeps, 'stateStore'>): ProcesarCallbackDeps {
  return {
    oauth: new MetaOAuthFake({ effectiveScopes: REQUIRED, expiresAt: null }),
    secretWriter: new SecretWriterFake(),
    credRepo: new InMemoryCredentialRepo(),
    connRepo: new InMemoryConnectionRepo(),
    descubrir: async () => [PAGE_SMILEFLOW, PAGE_SC],
    redirectUri: 'https://soec/cb',
    ahora: AHORA,
    ...over,
  };
}

describe('OAuth flow · authorization URL + backend', () => {
  it('URL con allowlist read-only, state, sin token; sin scope de escritura', () => {
    const url = construirAuthorizationUrl({ appId: 'APP', redirectUri: 'https://soec/cb', graphVersion: 'v26.0', state: 'ST' });
    expect(url).toContain('state=ST');
    expect(url).toContain('ads_read');
    expect(url).not.toMatch(/ads_management|leads_retrieval|manage_posts|content_publish/);
    expect(url).not.toMatch(/access_token|Bearer/i);
  });
  it('META_SECRET_WRITER_STATUS: fake ⇒ NOT_WIRED (no confundir con KMS READY)', () => {
    expect(metaSecretWriterStatus(new SecretWriterFake())).toBe('NOT_WIRED');
    expect(metaSecretWriterStatus({ esProductivo: true })).toBe('WIRED');
    expect(new SecretWriterFake().esProductivo).toBe(false);
  });
});

describe('OAuth state · consumo atómico + rechazos', () => {
  it('doble consumo (callback concurrente) ⇒ exactamente UN ganador', async () => {
    const store = new InMemoryOAuthStateStore();
    const { stateValor } = await iniciar(store);
    const r1 = await store.consumir(stateValor);
    const r2 = await store.consumir(stateValor);
    expect([r1, r2].filter((r) => r === 'CONSUMED')).toHaveLength(1);
    expect(r2).toBe('ALREADY_CONSUMED');
  });
  it('forged/expired/replay/cross-tenant ⇒ NOT_CONNECTED', async () => {
    const store = new InMemoryOAuthStateStore();
    const { stateValor } = await iniciar(store);
    // forged
    expect((await procesarCallbackMeta(callbackDeps({ stateStore: store }), { stateValor: 'x', code: 'c' })).estado).toBe('NOT_CONNECTED');
    // cross-tenant
    expect((await procesarCallbackMeta(callbackDeps({ stateStore: store }), { stateValor, organizationIdCallback: 'org-cyp', code: 'c' })).estado).toBe('NOT_CONNECTED');
    // expired
    const store2 = new InMemoryOAuthStateStore();
    const s2 = await iniciar(store2);
    const dEx = callbackDeps({ stateStore: store2, ahora: '2026-08-16T13:00:00.000Z' });
    expect((await procesarCallbackMeta(dEx, { stateValor: s2.stateValor, code: 'c' })).estado).toBe('NOT_CONNECTED');
  });
  it('replay: segundo callback con el mismo state ⇒ NOT_CONNECTED', async () => {
    const store = new InMemoryOAuthStateStore();
    const { stateValor } = await iniciar(store);
    const deps = callbackDeps({ stateStore: store });
    const r1 = await procesarCallbackMeta(deps, { stateValor, code: 'c' });
    expect(r1.estado).toBe('BINDING_PENDING');
    const r2 = await procesarCallbackMeta(deps, { stateValor, code: 'c' });
    expect(r2.estado).toBe('NOT_CONNECTED'); // ya consumido
  });
});

describe('OAuth callback · scopes, secret store, sin CONNECTED falso', () => {
  it('scope FORBIDDEN inesperado ⇒ SCOPES_INCOMPLETE; sin credencial persistida', async () => {
    const store = new InMemoryOAuthStateStore();
    const { stateValor } = await iniciar(store);
    const credRepo = new InMemoryCredentialRepo();
    const deps = callbackDeps({ stateStore: store, credRepo, oauth: new MetaOAuthFake({ effectiveScopes: [...REQUIRED, 'ads_management'], expiresAt: null }) });
    const r = await procesarCallbackMeta(deps, { stateValor, code: 'c' });
    expect(r.estado).toBe('SCOPES_INCOMPLETE');
    expect(await credRepo.obtener('org-smileflow', 'meta-org-smileflow')).toBeNull(); // token NO persistido
  });
  it('scopes faltantes ⇒ SCOPES_INCOMPLETE', async () => {
    const store = new InMemoryOAuthStateStore();
    const { stateValor } = await iniciar(store);
    const deps = callbackDeps({ stateStore: store, oauth: new MetaOAuthFake({ effectiveScopes: ['pages_show_list'], expiresAt: null }) });
    expect((await procesarCallbackMeta(deps, { stateValor, code: 'c' })).estado).toBe('SCOPES_INCOMPLETE');
  });
  it('SecretWriter falla ⇒ NOT_CONNECTED; token NUNCA en la metadata', async () => {
    const store = new InMemoryOAuthStateStore();
    const { stateValor } = await iniciar(store);
    const sw = new SecretWriterFake();
    sw.falloForzado = true;
    const credRepo = new InMemoryCredentialRepo();
    const deps = callbackDeps({ stateStore: store, secretWriter: sw, credRepo });
    const r = await procesarCallbackMeta(deps, { stateValor, code: 'c' });
    expect(r.estado).toBe('NOT_CONNECTED');
    expect(await credRepo.obtener('org-smileflow', 'meta-org-smileflow')).toBeNull();
  });
  it('éxito ⇒ BINDING_PENDING (nunca CONNECTED); credencial sólo con secretRef', async () => {
    const store = new InMemoryOAuthStateStore();
    const { stateValor } = await iniciar(store);
    const credRepo = new InMemoryCredentialRepo();
    const deps = callbackDeps({ stateStore: store, credRepo });
    const r = await procesarCallbackMeta(deps, { stateValor, code: 'c' });
    expect(r.estado).toBe('BINDING_PENDING');
    const cred = await credRepo.obtener('org-smileflow', r.connectionId!);
    expect(cred?.secretRef).toBe('file:org-smileflow/meta-user-token-meta-org-smileflow');
    expect(credencialSinPlaintext(cred as unknown as Record<string, unknown>)).toBe(true);
    expect(JSON.stringify(cred)).not.toContain('SYNTH_FAKE_TOKEN'); // token nunca en metadata
  });
});

describe('OAuth binding · discovery ≠ binding; SC Topografía adversarial', () => {
  async function conexionEnBinding() {
    const store = new InMemoryOAuthStateStore();
    const { stateValor } = await iniciar(store);
    const connRepo = new InMemoryConnectionRepo();
    const deps = callbackDeps({ stateStore: store, connRepo });
    const r = await procesarCallbackMeta(deps, { stateValor, code: 'c' });
    return { connRepo, connectionId: r.connectionId! };
  }
  it('ARBITRARY_UNDISCOVERED_ASSET_REJECT', async () => {
    const { connRepo, connectionId } = await conexionEnBinding();
    const inventado: CandidatoActivo = { provider: 'meta', assetType: 'page', externalId: '999', displayName: null, provenance: 'INFERRED' };
    const r = await confirmarBindingMeta({ connRepo, scopesEfectivos: REQUIRED }, 'org-smileflow', connectionId, inventado, { organizationId: 'org-smileflow', assetType: 'page', externalId: '999', actorId: 'h' });
    expect(r.rechazo).toBe('NOT_DISCOVERED');
    expect(r.estado).not.toBe('CONNECTED_READ_ONLY');
  });
  it('SC_TOPOGRAFIA_CANNOT_BIND_TO_SMILEFLOW; sólo SmileFlow confirmada ⇒ CONNECTED', async () => {
    const { connRepo, connectionId } = await conexionEnBinding();
    // Sustituir SC Topografía bajo una confirmación con el id de SmileFlow ⇒ mismatch ⇒ reject.
    const sust = await confirmarBindingMeta({ connRepo, scopesEfectivos: REQUIRED }, 'org-smileflow', connectionId, PAGE_SC, { organizationId: 'org-smileflow', assetType: 'page', externalId: '1066708446525633', actorId: 'h' });
    expect(sust.rechazo).toBe('HUMAN_CONFIRMATION_INVALID');
    // SmileFlow correcto ⇒ CONNECTED con capacidad de lectura de Page.
    const ok = await confirmarBindingMeta({ connRepo, scopesEfectivos: REQUIRED }, 'org-smileflow', connectionId, PAGE_SMILEFLOW, { organizationId: 'org-smileflow', assetType: 'page', externalId: '1066708446525633', actorId: 'h' });
    expect(ok.estado).toBe('CONNECTED_READ_ONLY');
    expect(ok.capacidades).toContain('CAN_READ_PAGE');
    expect(ok.capacidades.join(',')).not.toContain('WRITE');
  });
  it('binding duplicado es idempotente', async () => {
    const { connRepo, connectionId } = await conexionEnBinding();
    const conf = { organizationId: 'org-smileflow', assetType: 'page' as const, externalId: '1066708446525633', actorId: 'h' };
    await confirmarBindingMeta({ connRepo, scopesEfectivos: REQUIRED }, 'org-smileflow', connectionId, PAGE_SMILEFLOW, conf);
    await confirmarBindingMeta({ connRepo, scopesEfectivos: REQUIRED }, 'org-smileflow', connectionId, PAGE_SMILEFLOW, conf);
    const reg = await connRepo.obtener('org-smileflow', connectionId);
    expect(reg?.conexion.bindings.filter((b) => b.externalId === '1066708446525633')).toHaveLength(1);
  });
});

describe('OAuth · DTO seguro y redacción', () => {
  it('el DTO no expone credencialRef ni token', () => {
    const conn: ConexionMeta = { organizationId: 'org-smileflow', provider: 'meta', connectionId: 'c1', estado: 'CONNECTED_READ_ONLY', salud: 'HEALTHY', bindings: [{ assetType: 'page', externalId: '1066708446525633', displayName: 'x', confirmadoPorHumano: true }], credencialRef: 'file:org-smileflow/secret' };
    const dto = aConexionDTO(conn);
    expect(JSON.stringify(dto)).not.toContain('file:org-smileflow/secret');
    expect(dto).not.toHaveProperty('credencialRef');
  });
  it('BEARER_TOKEN_REDACTION: un error upstream con Bearer/access_token queda redactado', () => {
    const err = redactarSecretos('GET failed: Authorization: Bearer SYNTH_BEARER_abc123 and ?access_token=SYNTH_qt99');
    expect(err).not.toContain('SYNTH_BEARER_abc123');
    expect(err).not.toContain('SYNTH_qt99');
    expect(err).toContain('Bearer [REDACTED]');
  });
});
