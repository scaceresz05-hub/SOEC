/**
 * Tests del provider Google Ads OAuth (READ ONLY, multi-tenant). Fakes en memoria (envelope real con KmsFake,
 * sin red). Cubren: state provider-bound / tenant-bound / replay, callback fail-closed, descubrimiento y
 * selección de cuentas con validación de acceso, recuperación de invalid_grant, aislamiento del scheduler y
 * no-fuga de secretos (el refresh token nunca en DTO ni en claro en el "DB" de ciphertext).
 */
import { describe, expect, it } from 'vitest';
import type { EventStore, RequestContext } from '@soec/contracts';
import { EnvelopeSecretBackend, InMemoryCiphertextStore, KmsFake } from '../src/acquisition/meta-secret-backend';
import {
  crearEstadoGoogleAds, validarEstadoGoogleAds, construirAuthorizationUrl, SCOPE_ADWORDS, PROVIDER_GOOGLE_ADS,
  type EstadoOAuthGoogleAds,
} from '../src/acquisition/google-ads-oauth';
import {
  procesarCallbackGoogleAds, descubrirCuentas, seleccionarCuenta, desconectar,
  InMemoryStateStore, InMemoryCredentialRepo, InMemoryConnectionRepo,
  type ComponentesFlujoGoogleAds,
} from '../src/acquisition/google-ads-oauth-flow';
import { connectionIdDe, aConexionDTO, type ConexionGoogleAds } from '../src/acquisition/google-ads-connection';
import type { GoogleOAuthPort, GoogleAdsAccountsPort, ResultadoIntercambio, ResultadoRefresh } from '../src/acquisition/google-ads-api-http';
import { sincronizarConexion } from '../src/ingesta/google-ads-connection-service';
import { correrTodasLasConexiones, InMemorySyncLease } from '../src/ingesta/google-ads-scheduler';

const AHORA = '2026-08-18T00:00:00.000Z';
const NONCE = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';

// --- Fakes de frontera ------------------------------------------------------

class GoogleOAuthFake implements GoogleOAuthPort {
  invalidGrant = false;
  revocado: string | null = null;
  constructor(private readonly refreshToken = 'refresh-secreto-123', private readonly codeInvalido = false) {}
  async intercambiarCodigo(code: string): Promise<ResultadoIntercambio> {
    if (this.codeInvalido || code === 'BAD') return { ok: false, motivo: 'CODE_INVALIDO' };
    return { ok: true, refreshToken: this.refreshToken, accessToken: 'access-efimero', scope: SCOPE_ADWORDS, expiresIn: 3600 };
  }
  async refrescarAccessToken(refreshToken: string): Promise<ResultadoRefresh> {
    if (this.invalidGrant) return { ok: false, motivo: 'INVALID_GRANT' };
    return { ok: true, accessToken: `access-${refreshToken.slice(0, 4)}`, expiresIn: 3600 };
  }
  async revocar(refreshToken: string): Promise<void> {
    this.revocado = refreshToken;
  }
}

class GoogleAdsAccountsFake implements GoogleAdsAccountsPort {
  constructor(private readonly accesibles: readonly string[], private readonly managers: Record<string, readonly string[]> = {}, private readonly esManager: ReadonlySet<string> = new Set()) {}
  async listAccessibleCustomers(): Promise<readonly string[]> {
    return this.accesibles;
  }
  async describeCustomer(_at: string, customerId: string, loginCustomerId: string | null) {
    const conocido = this.accesibles.includes(customerId) || Object.values(this.managers).some((cs) => cs.includes(customerId));
    if (!conocido) return null;
    return {
      customerId,
      descriptiveName: `Cuenta ${customerId}`,
      currencyCode: 'CLP',
      timeZone: 'America/Santiago',
      manager: this.esManager.has(customerId),
      testAccount: false,
      managerCustomerId: loginCustomerId,
    };
  }
  async listClientCustomers(_at: string, managerCustomerId: string): Promise<readonly string[]> {
    return this.managers[managerCustomerId] ?? [];
  }
}

// --- Composición de test ----------------------------------------------------

function comp(oauth: GoogleOAuthFake, accounts: GoogleAdsAccountsFake, store = new EnvelopeSecretBackend(new KmsFake(), new InMemoryCiphertextStore())): ComponentesFlujoGoogleAds & { secretWriter: EnvelopeSecretBackend } {
  return {
    stateStore: new InMemoryStateStore(),
    credRepo: new InMemoryCredentialRepo(),
    connRepo: new InMemoryConnectionRepo(),
    secretWriter: store,
    oauth,
    accounts,
    clientId: 'cid.apps.googleusercontent.com',
    redirectUri: 'https://soec-api/acquisition/google-ads/oauth/callback',
    ahora: () => AHORA,
  };
}

async function conectar(c: ComponentesFlujoGoogleAds, org: string, code = 'good'): Promise<string> {
  const st = crearEstadoGoogleAds({ nonce: NONCE, ahora: AHORA, ttlMs: 600_000 }, org, 'actor-1');
  await c.stateStore.guardar(st);
  await procesarCallbackGoogleAds(c, { stateValor: st.valor, code });
  return st.valor;
}

// --- FakeStore para refresh-state (aislamiento del scheduler) ---------------

class FakeStore {
  readonly streams = new Map<string, unknown[]>();
  boomOrg: string | null = null;
  async readStream(_ctx: RequestContext, id: string): Promise<unknown[]> {
    if (this.boomOrg && id.includes(this.boomOrg)) throw new Error('boom lectura');
    return this.streams.get(id) ?? [];
  }
  async append(_ctx: RequestContext, id: string, _v: number, events: unknown[]): Promise<{ version: number; events: unknown[] }> {
    const a = this.streams.get(id) ?? [];
    a.push(...events);
    this.streams.set(id, a);
    return { version: a.length, events };
  }
}
const asStore = (f: FakeStore): EventStore => f as unknown as EventStore;

// ===========================================================================

describe('google-ads: state OAuth provider-bound + tenant-bound + replay', () => {
  it('oauth_state_provider_bound: un state que NO es google-ads ⇒ PROVIDER_MISMATCH; el de google-ads ⇒ OK', () => {
    const g = crearEstadoGoogleAds({ nonce: NONCE, ahora: AHORA, ttlMs: 600_000 }, 'org-a', 'actor');
    expect(g.provider).toBe(PROVIDER_GOOGLE_ADS);
    // Un state de otro provider (p.ej. Meta) jamás valida en el callback de Google Ads.
    const meta = { ...g, provider: 'meta' } as unknown as EstadoOAuthGoogleAds;
    expect(validarEstadoGoogleAds(meta, { valor: g.valor, ahora: AHORA })).toBe('PROVIDER_MISMATCH');
    expect(validarEstadoGoogleAds(g, { valor: g.valor, ahora: AHORA })).toBe('OK');
  });

  it('oauth_state_tenant_bound: la org autoritativa es la del state; otra org en el callback ⇒ CROSS_TENANT', () => {
    const g = crearEstadoGoogleAds({ nonce: NONCE, ahora: AHORA, ttlMs: 600_000 }, 'org-a', 'actor');
    expect(validarEstadoGoogleAds(g, { valor: g.valor, organizationIdCallback: 'org-b', ahora: AHORA })).toBe('CROSS_TENANT');
  });

  it('replay/expiración: consumido ⇒ STATE_CONSUMIDO; vencido ⇒ STATE_EXPIRADO; desconocido ⇒ STATE_DESCONOCIDO', () => {
    const g = crearEstadoGoogleAds({ nonce: NONCE, ahora: AHORA, ttlMs: 1000 }, 'org-a', 'actor');
    expect(validarEstadoGoogleAds({ ...g, consumido: true }, { valor: g.valor, ahora: AHORA })).toBe('STATE_CONSUMIDO');
    expect(validarEstadoGoogleAds(g, { valor: g.valor, ahora: '2026-08-18T00:01:00.000Z' })).toBe('STATE_EXPIRADO');
    expect(validarEstadoGoogleAds(null, { valor: g.valor, ahora: AHORA })).toBe('STATE_DESCONOCIDO');
  });

  it('authorization URL: scope adwords + access_type=offline + prompt=consent + state', () => {
    const url = new URL(construirAuthorizationUrl({ clientId: 'cid', redirectUri: 'https://x/cb' }, 'st-123'));
    expect(url.searchParams.get('scope')).toBe(SCOPE_ADWORDS);
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('state')).toBe('st-123');
    expect(url.searchParams.get('response_type')).toBe('code');
  });
});

describe('google-ads: callback fail-closed + almacenamiento cifrado', () => {
  it('state válido + code OK ⇒ ACCOUNT_SELECTION_PENDING y refresh token guardado CIFRADO (secretRef opaco)', async () => {
    const c = comp(new GoogleOAuthFake('refresh-XYZ'), new GoogleAdsAccountsFake(['1111111111']));
    const st = crearEstadoGoogleAds({ nonce: NONCE, ahora: AHORA, ttlMs: 600_000 }, 'org-a', 'actor');
    await c.stateStore.guardar(st);
    const r = await procesarCallbackGoogleAds(c, { stateValor: st.valor, code: 'good' });
    expect(r.estado).toBe('ACCOUNT_SELECTION_PENDING');
    const conexion = await c.connRepo.obtener('org-a', connectionIdDe('org-a'));
    expect(conexion?.estado).toBe('ACCOUNT_SELECTION_PENDING');
    // secretRef OPACO, sin material secreto.
    expect(conexion?.credencialRef).toMatch(/^secretstore:org-a\//);
    expect(JSON.stringify(conexion)).not.toContain('refresh-XYZ');
    // El valor cifrado se resuelve al original SÓLO por la caja opaca; el "DB" no guarda plaintext.
    const ctx = { organizationId: 'org-a', actor: 'x', scope: { organizationId: 'org-a', permissions: [] }, correlationId: 'c' } as unknown as RequestContext;
    const resuelto = await c.secretWriter.resolver(ctx, conexion!.credencialRef!);
    const igual = resuelto.usar((v) => v === 'refresh-XYZ');
    expect(igual).toBe(true);
  });

  it('code inválido ⇒ OAUTH_FALLIDO y NO se persiste credencial ni conexión CONNECTED (fail-closed)', async () => {
    const c = comp(new GoogleOAuthFake('r', true), new GoogleAdsAccountsFake(['1']));
    const st = crearEstadoGoogleAds({ nonce: NONCE, ahora: AHORA, ttlMs: 600_000 }, 'org-a', 'actor');
    await c.stateStore.guardar(st);
    const r = await procesarCallbackGoogleAds(c, { stateValor: st.valor, code: 'BAD' });
    expect(r.estado).toBe('OAUTH_FALLIDO');
    expect(await c.credRepo.obtener('org-a', connectionIdDe('org-a'))).toBeNull();
  });

  it('replay del callback: el segundo intento con el mismo state ⇒ STATE_INVALIDO (consumo one-time atómico)', async () => {
    const c = comp(new GoogleOAuthFake(), new GoogleAdsAccountsFake(['1']));
    const st = crearEstadoGoogleAds({ nonce: NONCE, ahora: AHORA, ttlMs: 600_000 }, 'org-a', 'actor');
    await c.stateStore.guardar(st);
    const r1 = await procesarCallbackGoogleAds(c, { stateValor: st.valor, code: 'good' });
    expect(r1.estado).toBe('ACCOUNT_SELECTION_PENDING');
    const r2 = await procesarCallbackGoogleAds(c, { stateValor: st.valor, code: 'good' });
    expect(r2.estado).toBe('STATE_INVALIDO');
  });
});

describe('google-ads: descubrimiento y selección de cuentas (con validación de acceso)', () => {
  it('account_discovery: enumera accesibles + clientes bajo managers, con login-customer-id resuelto', async () => {
    const c = comp(new GoogleOAuthFake(), new GoogleAdsAccountsFake(['7000000000'], { '7000000000': ['8888888888'] }, new Set(['7000000000'])));
    await conectar(c, 'org-a');
    const r = await descubrirCuentas(c, 'org-a');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ids = r.cuentas.map((x) => x.customerId).sort();
    expect(ids).toContain('7000000000'); // manager
    expect(ids).toContain('8888888888'); // cliente bajo el manager
    const cliente = r.cuentas.find((x) => x.customerId === '8888888888')!;
    expect(cliente.managerCustomerId).toBe('7000000000');
  });

  it('account_selection + customer_access_validation: elegir una cuenta accesible ⇒ CONNECTED con login derivado', async () => {
    const c = comp(new GoogleOAuthFake(), new GoogleAdsAccountsFake(['9999999999']));
    await conectar(c, 'org-a');
    const r = await seleccionarCuenta(c, 'org-a', '9999999999');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.conexion.estado).toBe('CONNECTED');
    expect(r.conexion.customerId).toBe('9999999999');
    expect(r.conexion.loginCustomerId).toBe('9999999999'); // acceso directo ⇒ login = self
  });

  it('customer_access_validation: elegir una cuenta NO accesible por el token ⇒ ACCESO_DENEGADO (no CONNECTED)', async () => {
    const c = comp(new GoogleOAuthFake(), new GoogleAdsAccountsFake(['1111111111']));
    await conectar(c, 'org-a');
    const r = await seleccionarCuenta(c, 'org-a', '2222222222'); // no está entre los accesibles
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toBe('ACCESO_DENEGADO');
    const conexion = await c.connRepo.obtener('org-a', connectionIdDe('org-a'));
    expect(conexion?.estado).toBe('ACCOUNT_SELECTION_PENDING'); // sigue sin conectar
  });

  it('dynamic_tenant_onboarding: una org SIN entrada en el registro estático TS conecta y selecciona sin editar código', async () => {
    const orgNueva = 'org-cliente-nuevo-jamas-registrado';
    const c = comp(new GoogleOAuthFake(), new GoogleAdsAccountsFake(['5555555555']));
    await conectar(c, orgNueva);
    const r = await seleccionarCuenta(c, orgNueva, '5555555555');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.conexion.estado).toBe('CONNECTED');
    // El DTO seguro no expone credencialRef ni token.
    const dto = aConexionDTO(r.conexion);
    expect(Object.keys(dto)).not.toContain('credencialRef');
    expect(JSON.stringify(dto)).not.toContain('secretstore:');
  });
});

describe('google-ads: recuperación de invalid_grant (NEEDS_REAUTH conserva histórico)', () => {
  it('invalid_grant_recovery: token revocado ⇒ conexión NEEDS_REAUTH; cuenta y credencial se conservan', async () => {
    const oauth = new GoogleOAuthFake();
    const c = comp(oauth, new GoogleAdsAccountsFake(['3333333333']));
    await conectar(c, 'org-a');
    await seleccionarCuenta(c, 'org-a', '3333333333');
    // Google revoca el token: el siguiente refresh clasifica invalid_grant.
    oauth.invalidGrant = true;
    const r = await descubrirCuentas(c, 'org-a'); // dispara el refresh
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toBe('NEEDS_REAUTH');
    const conexion = await c.connRepo.obtener('org-a', connectionIdDe('org-a'));
    expect(conexion?.estado).toBe('NEEDS_REAUTH');
    expect(conexion?.needsReauth).toBe(true);
    expect(conexion?.customerId).toBe('3333333333'); // la cuenta seleccionada se conserva
    expect(conexion?.credencialRef).not.toBeNull(); // el histórico/credencial no se borra
  });

  it('desconectar: revoca el refresh en Google, marca DISCONNECTED y limpia credencialRef', async () => {
    const oauth = new GoogleOAuthFake('refresh-a-revocar');
    const c = comp(oauth, new GoogleAdsAccountsFake(['4444444444']));
    await conectar(c, 'org-a');
    await seleccionarCuenta(c, 'org-a', '4444444444');
    await desconectar(c, 'org-a');
    expect(oauth.revocado).toBe('refresh-a-revocar');
    const conexion = await c.connRepo.obtener('org-a', connectionIdDe('org-a'));
    expect(conexion?.estado).toBe('DISCONNECTED');
    expect(conexion?.credencialRef).toBeNull();
  });
});

describe('google-ads: sincronización + scheduler (aislamiento multi-tenant)', () => {
  async function conexionConectada(c: ComponentesFlujoGoogleAds, org: string, customerId: string): Promise<ConexionGoogleAds> {
    await conectar(c, org);
    const r = await seleccionarCuenta(c, org, customerId);
    if (!r.ok) throw new Error('no conectó');
    return r.conexion;
  }

  it('sync invalid_grant: persiste NEEDS_REAUTH sin fabricar frescura', async () => {
    const oauth = new GoogleOAuthFake();
    const c = comp(oauth, new GoogleAdsAccountsFake(['6666666666']));
    const conexion = await conexionConectada(c, 'org-a', '6666666666');
    oauth.invalidGrant = true;
    const store = new FakeStore();
    const r = await sincronizarConexion({ store: asStore(store), env: {}, comp: c, ahora: () => AHORA }, conexion);
    expect(r.estado).toBe('NEEDS_REAUTH');
    expect(r.dataThrough).toBeNull();
  });

  it('sync sin app-level env ⇒ NOT_CONFIGURED (no inventa datos)', async () => {
    const c = comp(new GoogleOAuthFake(), new GoogleAdsAccountsFake(['6666666666']));
    const conexion = await conexionConectada(c, 'org-a', '6666666666');
    const r = await sincronizarConexion({ store: asStore(new FakeStore()), env: {}, comp: c, ahora: () => AHORA }, conexion);
    expect(r.estado).toBe('NOT_CONFIGURED');
  });

  it('scheduler_failure_isolation: el fallo (excepción) de un tenant NO impide procesar a los demás', async () => {
    const oauth = new GoogleOAuthFake();
    const c = comp(oauth, new GoogleAdsAccountsFake(['1010101010', '2020202020']));
    const connA = await conexionConectada(c, 'org-boom', '1010101010');
    const connB = await conexionConectada(c, 'org-ok', '2020202020');
    // connRepo del scheduler devuelve ambas conexiones CONNECTED.
    const connRepo = { listarConectadas: async () => [connA, connB], guardar: async () => undefined, obtener: async () => null };
    const store = new FakeStore();
    store.boomOrg = 'org-boom'; // la persistencia de refresh-state de org-boom lanza
    oauth.invalidGrant = true; // fuerza la rama que persiste refresh-state (dispara el boom en org-boom)
    const resumen = await correrTodasLasConexiones({ store: asStore(store), env: {}, comp: c, connRepo, holder: 'r1', habilitado: true, ahora: () => AHORA });
    expect(resumen.total).toBe(2);
    const porOrg = Object.fromEntries(resumen.resultados.map((r) => [r.org, r.estado]));
    expect(porOrg['org-boom']).toBe('FALLO'); // excepción aislada
    expect(porOrg['org-ok']).toBe('NEEDS_REAUTH'); // el otro tenant SÍ se procesó
  });

  it('scheduler_same_connection_single_flight: si otra réplica tiene el lease, esta réplica SALTEA esa conexión', async () => {
    const c = comp(new GoogleOAuthFake(), new GoogleAdsAccountsFake(['1010101010', '2020202020']));
    const connA = await conexionConectada(c, 'org-a', '1010101010');
    const connB = await conexionConectada(c, 'org-b', '2020202020');
    const connRepo = { listarConectadas: async () => [connA, connB], guardar: async () => undefined, obtener: async () => null };
    const lease = new InMemorySyncLease();
    // Otra réplica ya tiene el lease de la conexión de org-a.
    expect(await lease.adquirir(`org-a:${connA.connectionId}`, 'otra-replica', AHORA)).toBe(true);
    const resumen = await correrTodasLasConexiones({ store: asStore(new FakeStore()), env: {}, comp: c, connRepo, lease, holder: 'esta-replica', habilitado: true, ahora: () => AHORA });
    const porOrg = Object.fromEntries(resumen.resultados.map((r) => [r.org, r.estado]));
    expect(porOrg['org-a']).toBe('SKIPPED'); // lease ocupado por otra réplica ⇒ single-flight
    expect(porOrg['org-b']).not.toBe('SKIPPED'); // distinto tenant/lease ⇒ SÍ se procesa
  });

  it('scheduler_different_tenants_can_run_independently: leases de distintas conexiones no se bloquean entre sí', async () => {
    const lease = new InMemorySyncLease();
    expect(await lease.adquirir('org-a:conn-a', 'r1', AHORA)).toBe(true);
    expect(await lease.adquirir('org-b:conn-b', 'r1', AHORA)).toBe(true); // otra conexión ⇒ independiente
    // La misma conexión, en cambio, es single-flight:
    expect(await lease.adquirir('org-a:conn-a', 'r2', AHORA)).toBe(false);
  });
});

describe('google-ads: disconnect fail-closed', () => {
  async function conectado() {
    const oauth = new GoogleOAuthFake('refresh-a-borrar');
    const c = comp(oauth, new GoogleAdsAccountsFake(['7070707070']));
    await conectar(c, 'org-a');
    await seleccionarCuenta(c, 'org-a', '7070707070');
    return { c, oauth };
  }

  it('disconnected_connection_cannot_refresh: tras desconectar, la conexión no está CONNECTED ⇒ sync la saltea', async () => {
    const { c } = await conectado();
    await desconectar(c, 'org-a');
    const conexion = await c.connRepo.obtener('org-a', connectionIdDe('org-a'));
    expect(conexion?.estado).toBe('DISCONNECTED');
    const r = await sincronizarConexion({ store: asStore(new FakeStore()), env: {}, comp: c, ahora: () => AHORA }, conexion!);
    expect(r.estado).toBe('SKIPPED'); // no puede sincronizar
  });

  it('disconnected_connection_not_scheduled: DISCONNECTED no aparece en listarConectadas', async () => {
    const { c } = await conectado();
    await desconectar(c, 'org-a');
    expect((await c.connRepo.listarConectadas()).length).toBe(0);
  });

  it('disconnected_secret_not_usable: el secretRef ya no resuelve como credencial activa (envelope borrado)', async () => {
    const { c } = await conectado();
    const antes = await c.connRepo.obtener('org-a', connectionIdDe('org-a'));
    const refAntes = antes!.credencialRef!;
    await desconectar(c, 'org-a');
    // La conexión ya no expone credencialRef y el envelope fue borrado ⇒ resolver lanza.
    const despues = await c.connRepo.obtener('org-a', connectionIdDe('org-a'));
    expect(despues?.credencialRef).toBeNull();
    const ctx = { organizationId: 'org-a', actor: 'x', scope: { organizationId: 'org-a', permissions: [] }, correlationId: 'c' } as unknown as RequestContext;
    await expect(c.secretWriter.resolver(ctx, refAntes)).rejects.toThrow();
  });
});
