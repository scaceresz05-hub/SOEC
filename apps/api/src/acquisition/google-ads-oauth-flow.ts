/**
 * apps/api · ORQUESTACIÓN del OAuth Google Ads (READ ONLY, tenant-scoped). Coordina state → intercambio de
 * code → almacenamiento CIFRADO del refresh token → conexión en ACCOUNT_SELECTION_PENDING → selección de
 * cuenta con VALIDACIÓN DE ACCESO → CONNECTED. Recuperación de invalid_grant → NEEDS_REAUTH conservando la
 * cuenta seleccionada (los datos históricos del event store nunca se tocan).
 *
 * Invariantes de seguridad:
 *  - La org autoritativa proviene SIEMPRE del state almacenado (nunca del callback) — anti org-swapping.
 *  - State provider-bound + one-time atómico (consumir) — anti replay / anti cross-provider.
 *  - El refresh token se persiste SÓLO como envelope cifrado (secretRef opaco); si el store falla, no se
 *    marca credencial ni conexión (fail-closed): el token nunca llega a una fila sin cifrar.
 *  - El callback NUNCA deja CONNECTED: la selección de cuenta es un acto humano posterior y autenticado.
 */

import { ActorId, OrganizationId, type RequestContext } from '@soec/contracts';
import type { SecretStore } from '@soec/secretos';
import type { GoogleOAuthPort, GoogleAdsAccountsPort } from './google-ads-api-http';
import { validarEstadoGoogleAds, type EstadoOAuthGoogleAds, type ResultadoValidacionGoogleAds } from './google-ads-oauth';
import {
  connectionIdDe, conexionInicial, transicionConexionValida,
  type ConexionGoogleAds, type CredencialGoogleAdsRef, type CuentaGoogleAds,
} from './google-ads-connection';

const NOMBRE_SECRETO_REFRESH = 'google-ads-refresh-token';

// ---------------------------------------------------------------------------
// Puertos de persistencia (satisfechos por los repos PG y por los in-memory de test)
// ---------------------------------------------------------------------------

export type ResultadoConsumoState = 'CONSUMED' | 'ALREADY_CONSUMED' | 'NOT_FOUND';

export interface StateStorePort {
  guardar(e: EstadoOAuthGoogleAds): Promise<void>;
  obtener(valor: string): Promise<EstadoOAuthGoogleAds | null>;
  consumir(valor: string): Promise<ResultadoConsumoState>;
}
export interface CredentialRepoPort {
  guardar(c: CredencialGoogleAdsRef): Promise<void>;
  obtener(org: string, credentialId: string): Promise<CredencialGoogleAdsRef | null>;
}
export interface ConnectionRepoPort {
  guardar(c: ConexionGoogleAds): Promise<void>;
  obtener(org: string, connectionId: string): Promise<ConexionGoogleAds | null>;
  listarConectadas(): Promise<readonly ConexionGoogleAds[]>;
}
export interface EscritorSecretos {
  almacenar(org: string, nombre: string, valor: string): Promise<{ readonly secretRef: string }>;
  revocar(secretRef: string): Promise<void>;
}

export interface ComponentesFlujoGoogleAds {
  readonly stateStore: StateStorePort;
  readonly credRepo: CredentialRepoPort;
  readonly connRepo: ConnectionRepoPort;
  readonly secretWriter: EscritorSecretos & SecretStore; // EnvelopeSecretBackend cumple ambos
  readonly oauth: GoogleOAuthPort;
  readonly accounts: GoogleAdsAccountsPort;
  /** clientId OAuth (NO secreto: aparece en la URL de consentimiento por diseño). El client_secret jamás sale. */
  readonly clientId: string;
  readonly redirectUri: string;
  readonly ahora: () => string;
}

/** Contexto de sistema para resolver el secretRef (org autoritativa del state/conexión). */
function ctxSistema(org: string): RequestContext {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('google-ads-oauth'), scope: { organizationId: o, permissions: ['events:read'] }, correlationId: 'google-ads-oauth' };
}

// ---------------------------------------------------------------------------
// Callback
// ---------------------------------------------------------------------------

export type ResultadoCallbackGoogleAds =
  | { readonly estado: 'ACCOUNT_SELECTION_PENDING'; readonly organizationId: string }
  | { readonly estado: 'STATE_INVALIDO'; readonly detalle: ResultadoValidacionGoogleAds | 'RACE'; readonly organizationId: null }
  | { readonly estado: 'OAUTH_FALLIDO'; readonly organizationId: string | null };

/**
 * Procesa el callback: valida el state provider-bound, lo consume ATÓMICAMENTE (one-time), intercambia el
 * code, guarda el refresh token CIFRADO y deja la conexión en ACCOUNT_SELECTION_PENDING. Nunca CONNECTED.
 */
export async function procesarCallbackGoogleAds(comp: ComponentesFlujoGoogleAds, entrada: { stateValor: string; code: string }): Promise<ResultadoCallbackGoogleAds> {
  const ahora = comp.ahora();
  const almacenado = await comp.stateStore.obtener(entrada.stateValor);
  const validacion = validarEstadoGoogleAds(almacenado, { valor: entrada.stateValor, ahora }); // sin organizationIdCallback: org del state
  if (validacion !== 'OK' || almacenado === null) {
    return { estado: 'STATE_INVALIDO', detalle: validacion, organizationId: null };
  }
  // Consumo atómico one-time: si otro request ganó la carrera ⇒ replay, rechazado.
  const consumo = await comp.stateStore.consumir(entrada.stateValor);
  if (consumo !== 'CONSUMED') return { estado: 'STATE_INVALIDO', detalle: 'RACE', organizationId: null };

  const org = almacenado.organizationId;
  const intercambio = await comp.oauth.intercambiarCodigo(entrada.code, comp.redirectUri);
  if (!intercambio.ok) return { estado: 'OAUTH_FALLIDO', organizationId: org };

  // Guardar el refresh token CIFRADO. Fail-closed: si el store falla, no se persiste credencial ni conexión.
  const almacen = await comp.secretWriter.almacenar(org, NOMBRE_SECRETO_REFRESH, intercambio.refreshToken);
  const connectionId = connectionIdDe(org);
  const cred: CredencialGoogleAdsRef = {
    provider: 'google-ads',
    organizationId: org,
    credentialId: connectionId,
    secretRef: almacen.secretRef,
    issuedAt: ahora,
    lastValidatedAt: ahora,
    revokedAt: null,
    status: 'ACTIVE',
  };
  await comp.credRepo.guardar(cred);

  const previa = (await comp.connRepo.obtener(org, connectionId)) ?? conexionInicial(org, ahora);
  const conexion: ConexionGoogleAds = {
    ...previa,
    estado: 'ACCOUNT_SELECTION_PENDING',
    salud: 'UNKNOWN',
    credencialRef: almacen.secretRef,
    needsReauth: false,
    updatedAt: ahora,
  };
  await comp.connRepo.guardar(conexion);
  return { estado: 'ACCOUNT_SELECTION_PENDING', organizationId: org };
}

// ---------------------------------------------------------------------------
// Descubrimiento de cuentas
// ---------------------------------------------------------------------------

export type ResultadoDescubrimiento =
  | { readonly ok: true; readonly cuentas: readonly CuentaGoogleAds[] }
  | { readonly ok: false; readonly motivo: 'NOT_CONNECTED' | 'NO_CREDENTIAL' | 'NEEDS_REAUTH' | 'ERROR' };

/**
 * Renueva un access token efímero desde el refresh token cifrado, clasificando invalid_grant. Si el token
 * fue revocado ⇒ marca la conexión NEEDS_REAUTH (conserva la cuenta y el histórico). Devuelve el access
 * token SÓLO al callback interno (jamás sale de este módulo hacia el usuario).
 */
async function obtenerAccessToken(comp: ComponentesFlujoGoogleAds, conexion: ConexionGoogleAds): Promise<{ ok: true; accessToken: string } | { ok: false; motivo: 'NO_CREDENTIAL' | 'NEEDS_REAUTH' | 'ERROR' }> {
  if (conexion.credencialRef === null) return { ok: false, motivo: 'NO_CREDENTIAL' };
  let resultado: Awaited<ReturnType<GoogleOAuthPort['refrescarAccessToken']>>;
  try {
    const resuelto = await comp.secretWriter.resolver(ctxSistema(conexion.organizationId), conexion.credencialRef);
    resultado = await resuelto.usar((refreshToken) => comp.oauth.refrescarAccessToken(refreshToken));
  } catch {
    return { ok: false, motivo: 'ERROR' };
  }
  if (resultado.ok) return { ok: true, accessToken: resultado.accessToken };
  if (resultado.motivo === 'INVALID_GRANT') {
    await marcarNeedsReauth(comp, conexion.organizationId);
    return { ok: false, motivo: 'NEEDS_REAUTH' };
  }
  return { ok: false, motivo: 'ERROR' };
}

/**
 * Resuelve un access_token efímero para la ORG a partir de su conexión CONNECTED (refresh token CIFRADO por
 * tenant). Es la MISMA vía que usa el descubrimiento de cuentas / refresh (la que SÍ funciona en producción);
 * el transporte de escritura debe usar esta, NO `env:GOOGLE_ADS_REFRESH_TOKEN`. null si no hay token válido.
 */
export async function obtenerAccessTokenDeOrg(comp: ComponentesFlujoGoogleAds, org: string): Promise<string | null> {
  const conexion = await comp.connRepo.obtener(org, connectionIdDe(org));
  if (conexion === null) return null;
  const t = await obtenerAccessToken(comp, conexion);
  return t.ok ? t.accessToken : null;
}

/** Descubre las cuentas accesibles por el token, resolviendo el manager (login-customer-id) por cliente. */
export async function descubrirCuentas(comp: ComponentesFlujoGoogleAds, org: string): Promise<ResultadoDescubrimiento> {
  const conexion = await comp.connRepo.obtener(org, connectionIdDe(org));
  if (conexion === null || conexion.estado === 'NOT_CONNECTED' || conexion.estado === 'DISCONNECTED') return { ok: false, motivo: 'NOT_CONNECTED' };
  const token = await obtenerAccessToken(comp, conexion);
  if (!token.ok) return { ok: false, motivo: token.motivo === 'NO_CREDENTIAL' ? 'NO_CREDENTIAL' : token.motivo === 'NEEDS_REAUTH' ? 'NEEDS_REAUTH' : 'ERROR' };
  const cuentas = await enumerarCuentas(comp.accounts, token.accessToken);
  return { ok: true, cuentas };
}

/** Enumeración pura (dado un access token): accesibles + clientes bajo managers, deduplicadas por customerId. */
async function enumerarCuentas(accounts: GoogleAdsAccountsPort, accessToken: string): Promise<readonly CuentaGoogleAds[]> {
  const accesibles = await accounts.listAccessibleCustomers(accessToken);
  const porId = new Map<string, CuentaGoogleAds>();
  for (const id of accesibles) {
    const c = await accounts.describeCustomer(accessToken, id, id);
    if (c) porId.set(id, { ...c, managerCustomerId: c.manager ? null : id });
  }
  // Para cada manager accesible, enumerar sus clientes y describirlos con login = manager.
  for (const [id, c] of [...porId]) {
    if (!c.manager) continue;
    const clientes = await accounts.listClientCustomers(accessToken, id);
    for (const clienteId of clientes) {
      const existente = porId.get(clienteId);
      if (existente && existente.managerCustomerId) continue; // ya resuelto con manager
      const cc = await accounts.describeCustomer(accessToken, clienteId, id);
      if (cc) porId.set(clienteId, { ...cc, managerCustomerId: id });
    }
  }
  return [...porId.values()];
}

// ---------------------------------------------------------------------------
// Selección de cuenta (con validación de acceso)
// ---------------------------------------------------------------------------

export type ResultadoSeleccion =
  | { readonly ok: true; readonly conexion: ConexionGoogleAds }
  | { readonly ok: false; readonly motivo: 'NOT_CONNECTED' | 'NO_CREDENTIAL' | 'NEEDS_REAUTH' | 'ACCESO_DENEGADO' | 'ESTADO_INVALIDO' | 'ERROR' };

/**
 * Selecciona una cuenta: RE-DESCUBRE (no confía en un ID arbitrario del frontend), valida que el token
 * realmente accede a esa cuenta (CUSTOMER_ACCESS_VALIDATION), y persiste CONNECTED con customerId +
 * loginCustomerId derivado del manager. Idempotente y re-seleccionable.
 */
export async function seleccionarCuenta(comp: ComponentesFlujoGoogleAds, org: string, customerId: string): Promise<ResultadoSeleccion> {
  const connectionId = connectionIdDe(org);
  const conexion = await comp.connRepo.obtener(org, connectionId);
  if (conexion === null || conexion.estado === 'NOT_CONNECTED' || conexion.estado === 'DISCONNECTED') return { ok: false, motivo: 'NOT_CONNECTED' };
  if (conexion.estado !== 'ACCOUNT_SELECTION_PENDING' && conexion.estado !== 'CONNECTED') return { ok: false, motivo: 'ESTADO_INVALIDO' };

  const token = await obtenerAccessToken(comp, conexion);
  if (!token.ok) return { ok: false, motivo: token.motivo === 'NO_CREDENTIAL' ? 'NO_CREDENTIAL' : token.motivo === 'NEEDS_REAUTH' ? 'NEEDS_REAUTH' : 'ERROR' };

  const cuentas = await enumerarCuentas(comp.accounts, token.accessToken);
  const elegida = cuentas.find((c) => c.customerId === customerId);
  if (!elegida) return { ok: false, motivo: 'ACCESO_DENEGADO' }; // el ID no está entre los accesibles por el token

  const loginCustomerId = elegida.managerCustomerId ?? elegida.customerId;
  const ahora = comp.ahora();
  if (!transicionConexionValida(conexion.estado, 'CONNECTED')) return { ok: false, motivo: 'ESTADO_INVALIDO' };
  const actualizada: ConexionGoogleAds = {
    ...conexion,
    estado: 'CONNECTED',
    salud: 'HEALTHY',
    customerId: elegida.customerId,
    loginCustomerId,
    descriptiveName: elegida.descriptiveName,
    timeZone: elegida.timeZone,
    currencyCode: elegida.currencyCode,
    needsReauth: false,
    updatedAt: ahora,
  };
  await comp.connRepo.guardar(actualizada);
  return { ok: true, conexion: actualizada };
}

// ---------------------------------------------------------------------------
// NEEDS_REAUTH / desconexión
// ---------------------------------------------------------------------------

/**
 * Prueba el token de una conexión (renueva un access token efímero). Clasifica invalid_grant → NEEDS_REAUTH
 * (marca la conexión). Usado por el scheduler/refresh antes de ingerir, para distinguir "token revocado"
 * (reconexión humana) de un fallo transitorio. No expone el access token.
 */
export async function probarTokenConexion(comp: ComponentesFlujoGoogleAds, conexion: ConexionGoogleAds): Promise<'OK' | 'NEEDS_REAUTH' | 'NO_CREDENTIAL' | 'ERROR'> {
  const t = await obtenerAccessToken(comp, conexion);
  return t.ok ? 'OK' : t.motivo;
}

/** Marca la conexión NEEDS_REAUTH conservando cuenta e histórico. Ofrece Reconectar; nunca borra datos. */
export async function marcarNeedsReauth(comp: ComponentesFlujoGoogleAds, org: string): Promise<void> {
  const connectionId = connectionIdDe(org);
  const conexion = await comp.connRepo.obtener(org, connectionId);
  if (conexion === null) return;
  await comp.connRepo.guardar({ ...conexion, estado: 'NEEDS_REAUTH', salud: 'NEEDS_REAUTH', needsReauth: true, updatedAt: comp.ahora() });
}

/**
 * Desconecta: revoca el refresh token en Google (best-effort), borra el envelope cifrado, marca la credencial
 * REVOKED y la conexión DISCONNECTED. NO borra el histórico del event store (los datos previos se conservan).
 */
export async function desconectar(comp: ComponentesFlujoGoogleAds, org: string): Promise<{ ok: boolean }> {
  const connectionId = connectionIdDe(org);
  const conexion = await comp.connRepo.obtener(org, connectionId);
  if (conexion === null) return { ok: true };
  const cred = await comp.credRepo.obtener(org, connectionId);
  if (cred !== null && cred.secretRef) {
    try {
      const resuelto = await comp.secretWriter.resolver(ctxSistema(org), cred.secretRef);
      await resuelto.usar((refreshToken) => comp.oauth.revocar(refreshToken));
    } catch {
      /* best-effort: procedemos con la desconexión local aunque la revocación remota falle */
    }
    await comp.secretWriter.revocar(cred.secretRef);
    await comp.credRepo.guardar({ ...cred, status: 'REVOKED', revokedAt: comp.ahora() });
  }
  await comp.connRepo.guardar({ ...conexion, estado: 'DISCONNECTED', salud: 'UNKNOWN', credencialRef: null, needsReauth: false, updatedAt: comp.ahora() });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Stores IN-MEMORY (tests). Aislados por instancia; el consumo de state es one-time.
// ---------------------------------------------------------------------------

export class InMemoryStateStore implements StateStorePort {
  private readonly m = new Map<string, EstadoOAuthGoogleAds & { consumidoEn: string | null }>();
  async guardar(e: EstadoOAuthGoogleAds): Promise<void> {
    this.m.set(e.valor, { ...e, consumidoEn: e.consumido ? new Date(0).toISOString() : null });
  }
  async obtener(valor: string): Promise<EstadoOAuthGoogleAds | null> {
    const r = this.m.get(valor);
    if (!r) return null;
    return { valor: r.valor, provider: r.provider, organizationId: r.organizationId, actorId: r.actorId, creadoEn: r.creadoEn, expiraEn: r.expiraEn, consumido: r.consumidoEn !== null };
  }
  async consumir(valor: string): Promise<ResultadoConsumoState> {
    const r = this.m.get(valor);
    if (!r) return 'NOT_FOUND';
    if (r.consumidoEn !== null) return 'ALREADY_CONSUMED';
    r.consumidoEn = new Date().toISOString();
    return 'CONSUMED';
  }
}

export class InMemoryCredentialRepo implements CredentialRepoPort {
  private readonly m = new Map<string, CredencialGoogleAdsRef>();
  async guardar(c: CredencialGoogleAdsRef): Promise<void> {
    this.m.set(`${c.organizationId}/${c.credentialId}`, c);
  }
  async obtener(org: string, credentialId: string): Promise<CredencialGoogleAdsRef | null> {
    return this.m.get(`${org}/${credentialId}`) ?? null;
  }
}

export class InMemoryConnectionRepo implements ConnectionRepoPort {
  private readonly m = new Map<string, ConexionGoogleAds>();
  async guardar(c: ConexionGoogleAds): Promise<void> {
    this.m.set(`${c.organizationId}/${c.connectionId}`, c);
  }
  async obtener(org: string, connectionId: string): Promise<ConexionGoogleAds | null> {
    return this.m.get(`${org}/${connectionId}`) ?? null;
  }
  async listarConectadas(): Promise<readonly ConexionGoogleAds[]> {
    return [...this.m.values()].filter((c) => c.estado === 'CONNECTED');
  }
}
