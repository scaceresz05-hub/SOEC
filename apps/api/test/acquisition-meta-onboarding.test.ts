/**
 * Meta production read-only onboarding — diseño seguro (FASE 19). Sin OAuth/token/Graph reales.
 */
import { describe, expect, it } from 'vitest';
import {
  crearEstadoOAuth,
  validarEstadoOAuth,
  procesarCallback,
  validarScopes,
  clasificarScope,
  type EstadoOAuth,
} from '../src/acquisition/meta-oauth';
import {
  transicionConexionValida,
  conexionActiva,
  negociarCapacidades,
  puedeVincular,
  credencialSinPlaintext,
  saludDesdeToken,
  requiereReauth,
  MetaGraphReadFake,
  BINDING_AUTOMATICO_PROHIBIDO,
  type BindingMeta,
  type CredencialMetaRef,
} from '../src/acquisition/meta-onboarding';
import type { CandidatoActivo } from '../src/acquisition/meta-oauth';

const AHORA = '2026-08-16T12:00:00.000Z';
const NONCE = 'nonce-impredecible-0123456789abcdef';

function estado(over: Partial<EstadoOAuth> = {}): EstadoOAuth {
  return { ...crearEstadoOAuth({ nonce: NONCE, ahora: AHORA, ttlMs: 600_000 }, 'org-smileflow', 'actor-1'), ...over };
}

describe('OAuth state · CSRF / replay / cross-tenant', () => {
  it('forged/desconocido, expirado y consumido son rechazados', () => {
    const st = estado();
    expect(validarEstadoOAuth(st, { valor: 'otro', ahora: AHORA })).toBe('STATE_DESCONOCIDO');
    expect(validarEstadoOAuth(null, { valor: NONCE, ahora: AHORA })).toBe('STATE_DESCONOCIDO');
    expect(validarEstadoOAuth(st, { valor: NONCE, ahora: '2026-08-16T13:00:00.000Z' })).toBe('STATE_EXPIRADO');
    expect(validarEstadoOAuth({ ...st, consumido: true }, { valor: NONCE, ahora: AHORA })).toBe('STATE_CONSUMIDO');
  });
  it('CALLBACK_CANNOT_OVERRIDE_ORG: org distinta en el callback ⇒ CROSS_TENANT', () => {
    const st = estado();
    expect(validarEstadoOAuth(st, { valor: NONCE, organizationIdCallback: 'org-cyp', ahora: AHORA })).toBe('CROSS_TENANT');
    expect(validarEstadoOAuth(st, { valor: NONCE, organizationIdCallback: 'org-smileflow', ahora: AHORA })).toBe('OK');
  });
  it('el nonce corto se rechaza al crear el state', () => {
    expect(() => crearEstadoOAuth({ nonce: 'corto', ahora: AHORA, ttlMs: 1000 }, 'o', 'a')).toThrow();
  });
});

describe('scopes · allowlist read-only', () => {
  it('scope de escritura ⇒ FORBIDDEN; validación marca prohibidos y no queda ok', () => {
    expect(clasificarScope('ads_management')).toBe('FORBIDDEN');
    expect(clasificarScope('leads_retrieval')).toBe('FORBIDDEN');
    const r = validarScopes(['pages_show_list', 'ads_read', 'ads_management']);
    expect(r.prohibidos).toContain('ads_management');
    expect(r.ok).toBe(false);
  });
  it('faltan scopes requeridos ⇒ no ok', () => {
    expect(validarScopes(['pages_show_list']).faltantes.length).toBeGreaterThan(0);
    expect(validarScopes(['pages_show_list']).ok).toBe(false);
  });
});

describe('callback · nunca CONNECTED; fail-closed', () => {
  it('CALLBACK_FAILURE_NEVER_CONNECTED: state inválido ⇒ NOT_CONNECTED', () => {
    expect(procesarCallback('STATE_EXPIRADO', null, SCOPES_OK()).estadoConexion).toBe('NOT_CONNECTED');
    expect(procesarCallback('CROSS_TENANT', estado(), SCOPES_OK()).estadoConexion).toBe('NOT_CONNECTED');
  });
  it('scopes incompletos ⇒ SCOPES_INCOMPLETE; scopes ok ⇒ ASSETS_DISCOVERED (no CONNECTED)', () => {
    expect(procesarCallback('OK', estado(), ['pages_show_list']).estadoConexion).toBe('SCOPES_INCOMPLETE');
    const ok = procesarCallback('OK', estado(), SCOPES_OK());
    expect(ok.estadoConexion).toBe('ASSETS_DISCOVERED');
    expect(ok.estadoConexion).not.toBe('CONNECTED_READ_ONLY');
    expect(ok.organizationId).toBe('org-smileflow'); // del state, no del callback
  });
});

describe('state machine · discovery ≠ connected', () => {
  it('PARTIAL_DISCOVERY_NEVER_CONNECTED: ASSETS_DISCOVERED no salta a CONNECTED', () => {
    expect(transicionConexionValida('ASSETS_DISCOVERED', 'CONNECTED_READ_ONLY')).toBe(false);
    expect(transicionConexionValida('ASSETS_DISCOVERED', 'BINDING_PENDING')).toBe(true);
    expect(transicionConexionValida('BINDING_PENDING', 'CONNECTED_READ_ONLY')).toBe(true);
    expect(transicionConexionValida('OAUTH_PENDING', 'CONNECTED_READ_ONLY')).toBe(false);
  });
});

describe('human binding gate · discovery ≠ binding', () => {
  const candidato: CandidatoActivo = { provider: 'meta', assetType: 'page', externalId: '1066708446525633', displayName: 'Smileflow.clinic', provenance: 'GRAPH_OBSERVED' };
  it('DISCOVERED_ASSET_NOT_BOUND: sin confirmación humana no se vincula', () => {
    expect(BINDING_AUTOMATICO_PROHIBIDO).toBe(true);
    expect(puedeVincular(candidato, { organizationId: 'org-smileflow', assetType: 'page', externalId: '1066708446525633', actorId: 'humano' })).toBe(true);
  });
  it('SC_TOPOGRAFIA_CANNOT_AUTO_BIND / DISPLAY_NAME_NOT_IDENTITY / UI_ID_NOT_CANONICAL', () => {
    // La Page de SC Topografía (otro externalId) no puede vincularse como si fuera la de SmileFlow.
    expect(puedeVincular(candidato, { organizationId: 'org-smileflow', assetType: 'page', externalId: '100558733139736', actorId: 'humano' })).toBe(false);
    // Coincidir por nombre no basta (se compara externalId, no displayName).
    const porNombre = { ...candidato, externalId: 'nombre-igual-distinto-id' };
    expect(puedeVincular(porNombre, { organizationId: 'org-smileflow', assetType: 'page', externalId: '1066708446525633', actorId: 'h' })).toBe(false);
    // Un id de UI no coincide con el canónico confirmado.
    expect(puedeVincular({ ...candidato, externalId: '61570785690749' }, { organizationId: 'org-smileflow', assetType: 'page', externalId: '1066708446525633', actorId: 'h' })).toBe(false);
    // Falta actor humano.
    expect(puedeVincular(candidato, { organizationId: 'org-smileflow', assetType: 'page', externalId: '1066708446525633', actorId: '' })).toBe(false);
  });
});

describe('capabilities · read-only, governadas por SOEC', () => {
  const bindings: readonly BindingMeta[] = [
    { assetType: 'page', externalId: '1066708446525633', displayName: null, confirmadoPorHumano: true },
    { assetType: 'instagram', externalId: '17841432883225770', displayName: null, confirmadoPorHumano: true },
    { assetType: 'adAccount', externalId: '1037025024374407', displayName: null, confirmadoPorHumano: true },
  ];
  it('UNEXPECTED_WRITE_SCOPE_DOES_NOT_ENABLE_WRITE: nunca hay capacidad de escritura', () => {
    const caps = negociarCapacidades(['pages_show_list', 'pages_read_engagement', 'ads_read', 'ads_management'], bindings, 'CONNECTED_READ_ONLY');
    expect(caps).toContain('CAN_READ_PAGE');
    expect(caps).toContain('CAN_READ_ADS');
    expect(caps.join(',')).not.toContain('WRITE'); // ningún CAN_WRITE_*, aunque ads_management esté presente
  });
  it('ORGANIC_INDEPENDENT_FROM_ADS: capacidades por scope+binding, independientes', () => {
    const soloOrganic = negociarCapacidades(['instagram_basic'], bindings, 'CONNECTED_READ_ONLY');
    expect(soloOrganic).toContain('CAN_READ_INSTAGRAM_MEDIA');
    expect(soloOrganic).not.toContain('CAN_READ_ADS');
  });
  it('CAPABILITY_INDEPENDENT_FROM_CONNECTION: sin conexión activa ⇒ ninguna capacidad', () => {
    expect(negociarCapacidades(['ads_read'], bindings, 'BINDING_PENDING')).toEqual([]);
    expect(conexionActiva('BINDING_PENDING')).toBe(false);
  });
});

describe('credenciales / salud · sin plaintext; reauth; revocación', () => {
  const cred = (over: Partial<CredencialMetaRef> = {}): CredencialMetaRef => ({
    provider: 'meta', organizationId: 'org-smileflow', credentialId: 'c1', tokenType: 'USER_LONG_LIVED',
    secretRef: 'file:org-smileflow/meta-user-token', issuedAt: AHORA, expiresAt: null, lastValidatedAt: AHORA, revokedAt: null, status: 'ACTIVE', ...over,
  });
  it('TOKEN_NEVER_IN_CREDENTIAL_OBJECT: sólo referencia opaca, sin token en claro', () => {
    expect(credencialSinPlaintext(cred() as unknown as Record<string, unknown>)).toBe(true);
    expect(credencialSinPlaintext({ ...cred(), access_token: 'x' } as unknown as Record<string, unknown>)).toBe(false);
  });
  it('EXPIRED_TOKEN ⇒ REAUTH_REQUIRED (sin borrar bindings)', () => {
    const c = cred({ expiresAt: '2026-08-16T11:00:00.000Z' });
    expect(saludDesdeToken(c, AHORA)).toBe('TOKEN_EXPIRED');
    expect(requiereReauth('TOKEN_EXPIRED')).toBe(true);
    expect(transicionConexionValida('REAUTH_REQUIRED', 'OAUTH_PENDING')).toBe(true); // conserva historia, re-autoriza
  });
  it('REVOKED_TOKEN_DOES_NOT_DELETE_HISTORY: revocación es un estado, no un borrado', () => {
    expect(saludDesdeToken(cred({ status: 'REVOKED', revokedAt: AHORA }), AHORA)).toBe('TOKEN_REVOKED');
    expect(transicionConexionValida('REVOKED', 'DISCONNECTED')).toBe(true);
  });
});

describe('graph read port · sin métodos de escritura', () => {
  it('READ_ONLY_PORT: el fake no expone create/pause/publish/send/budget', async () => {
    const p = new MetaGraphReadFake();
    const metodos = Object.getOwnPropertyNames(Object.getPrototypeOf(p));
    expect(metodos.some((m) => /create|pause|publish|send|budget|write|update|delete/i.test(m))).toBe(false);
    expect(await p.discoverPages()).toEqual([]);
  });
});

// util
function SCOPES_OK(): string[] {
  return ['pages_show_list', 'business_management', 'instagram_basic', 'pages_read_engagement', 'instagram_manage_insights', 'ads_read'];
}
