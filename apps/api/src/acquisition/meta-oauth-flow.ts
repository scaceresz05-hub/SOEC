/**
 * apps/api · IMPLEMENTACIÓN productiva del OAuth READ-ONLY de Meta — casos de uso + puertos + fakes.
 *
 * Implementa el flujo seguro diseñado en ed84bc8 SIN ejecutar nada real: sin OAuth real, token real ni
 * llamada Graph (`META_GRAPH_CALLS_FROM_SOEC = 0`). Los adaptadores productivos (HTTP a Meta, backend
 * real de secretos) son PUERTOS inyectados; en tests se usan FAKES.
 *
 * El writer productivo de secretos es `EnvelopeSecretBackend` (envelope AES-256-GCM + AWS KMS), que YA
 * satisface `SecretWriterPort`. El estado de cableado se reporta con `metaSecretWriterStatus` (WIRED/NOT_WIRED),
 * separado del `KmsBackendStatus` (READY del kms:smoke). El flujo persiste únicamente una REFERENCIA opaca
 * (`secretRef`); el valor del token nunca sale del boundary del `SecretWriterPort`.
 */

import { crearEstadoOAuth, validarEstadoOAuth, validarScopes, SCOPES_REQUERIDOS, type EstadoOAuth, type ScopeMeta, type CandidatoActivo } from './meta-oauth';
import {
  negociarCapacidades,
  puedeVincular,
  type CapacidadNegociada,
  type ConexionMeta,
  type ConfirmacionHumanaBinding,
  type CredencialMetaRef,
  type EstadoConexionMeta,
  type TipoTokenMeta,
} from './meta-onboarding';

// ---------------------------------------------------------------------------
// OAuth state store — consumo ATÓMICO de un solo uso (FASE 3)
// ---------------------------------------------------------------------------

export type ResultadoConsumo = 'CONSUMED' | 'ALREADY_CONSUMED' | 'NOT_FOUND';

export interface OAuthStateStore {
  guardar(e: EstadoOAuth): Promise<void>;
  obtener(valor: string): Promise<EstadoOAuth | null>;
  /** Consumo atómico: con dos callbacks concurrentes, exactamente UNO obtiene CONSUMED. */
  consumir(valor: string): Promise<ResultadoConsumo>;
}

export class InMemoryOAuthStateStore implements OAuthStateStore {
  private readonly m = new Map<string, EstadoOAuth>();
  async guardar(e: EstadoOAuth): Promise<void> {
    this.m.set(e.valor, e);
  }
  async obtener(valor: string): Promise<EstadoOAuth | null> {
    return this.m.get(valor) ?? null;
  }
  async consumir(valor: string): Promise<ResultadoConsumo> {
    // Sección crítica síncrona (un solo hilo de event-loop) ⇒ atómica: sólo el primero marca consumido.
    const e = this.m.get(valor);
    if (!e) return 'NOT_FOUND';
    if (e.consumido) return 'ALREADY_CONSUMED';
    this.m.set(valor, { ...e, consumido: true });
    return 'CONSUMED';
  }
}

// ---------------------------------------------------------------------------
// Secret writer — el boundary de ESCRITURA de secretos que HOY falta en producción (FASE 10)
// ---------------------------------------------------------------------------

export interface ResultadoAlmacenSecreto {
  readonly secretRef: string;
}

export interface SecretWriterPort {
  readonly nombre: string;
  readonly esProductivo: boolean;
  /** Almacena un valor secreto y devuelve SÓLO una referencia opaca. El valor no sale de esta frontera. */
  almacenar(organizationId: string, nombreLogico: string, valorSecreto: string): Promise<ResultadoAlmacenSecreto>;
  revocar(secretRef: string): Promise<void>;
}

/**
 * Estados EXPLÍCITAMENTE separados para evitar la colisión conceptual detectada:
 *  - `KmsBackendStatus`: madurez del backend de cifrado (AWS KMS). READY = kms:smoke real pasó.
 *  - `MetaSecretWriterStatus`: si el flujo OAuth tiene CABLEADO un writer productivo de secretos.
 * Un KMS READY NO implica un writer OAuth cableado; son cosas distintas.
 */
export type KmsBackendStatus = 'READY' | 'IMPLEMENTED_NOT_VERIFIED' | 'MISSING';
export type MetaSecretWriterStatus = 'WIRED' | 'NOT_WIRED';

/** El writer está WIRED sólo si se inyectó uno PRODUCTIVO (esProductivo=true). */
export function metaSecretWriterStatus(writer: Pick<SecretWriterPort, 'esProductivo'> | null | undefined): MetaSecretWriterStatus {
  return writer && writer.esProductivo ? 'WIRED' : 'NOT_WIRED';
}

/** Writer FAKE (in-memory) para tests: nunca conserva el valor; devuelve una referencia opaca. */
export class SecretWriterFake implements SecretWriterPort {
  readonly nombre = 'fake-in-memory';
  readonly esProductivo = false;
  private readonly refs = new Set<string>();
  falloForzado = false;
  async almacenar(organizationId: string, nombreLogico: string, _valorSecreto: string): Promise<ResultadoAlmacenSecreto> {
    if (this.falloForzado) throw new Error('SecretWriter no disponible');
    const secretRef = `file:${organizationId}/${nombreLogico}`;
    this.refs.add(secretRef);
    return { secretRef };
  }
  async revocar(secretRef: string): Promise<void> {
    this.refs.delete(secretRef);
  }
  tieneRef(secretRef: string): boolean {
    return this.refs.has(secretRef);
  }
}

// ---------------------------------------------------------------------------
// Meta OAuth port (intercambio de code) + fake (FASE 7)
// ---------------------------------------------------------------------------

export interface ResultadoExchange {
  readonly tokenType: TipoTokenMeta;
  readonly accessTokenValor: string; // vive SÓLO en el boundary; nunca se persiste como valor
  readonly effectiveScopes: readonly ScopeMeta[];
  readonly issuedAt: string | null;
  readonly expiresAt: string | null;
  readonly providerUserId: string;
}

export interface MetaOAuthPort {
  exchangeAuthorizationCode(code: string, redirectUri: string): Promise<ResultadoExchange>;
  revoke(accessTokenValor: string): Promise<void>;
}

export class MetaOAuthFake implements MetaOAuthPort {
  constructor(private readonly cfg: { effectiveScopes: readonly ScopeMeta[]; expiresAt: string | null }) {}
  async exchangeAuthorizationCode(): Promise<ResultadoExchange> {
    return {
      tokenType: 'USER_LONG_LIVED',
      accessTokenValor: 'SYNTH_FAKE_TOKEN_do_not_use',
      effectiveScopes: this.cfg.effectiveScopes,
      issuedAt: null,
      expiresAt: this.cfg.expiresAt,
      providerUserId: 'fake-user',
    };
  }
  async revoke(): Promise<void> {}
}

// ---------------------------------------------------------------------------
// Repos de credencial (metadata) y conexión — sólo secretRef, jamás token
// ---------------------------------------------------------------------------

export interface RegistroConexionMeta {
  readonly conexion: ConexionMeta;
  readonly candidatos: readonly CandidatoActivo[]; // activos descubiertos para esta conexión
}

export interface CredentialRepo {
  guardar(c: CredencialMetaRef): Promise<void>;
  obtener(organizationId: string, credentialId: string): Promise<CredencialMetaRef | null>;
}
export interface ConnectionRepo {
  guardar(r: RegistroConexionMeta): Promise<void>;
  obtener(organizationId: string, connectionId: string): Promise<RegistroConexionMeta | null>;
}

export class InMemoryCredentialRepo implements CredentialRepo {
  private readonly m = new Map<string, CredencialMetaRef>();
  async guardar(c: CredencialMetaRef): Promise<void> {
    this.m.set(`${c.organizationId}:${c.credentialId}`, c);
  }
  async obtener(org: string, id: string): Promise<CredencialMetaRef | null> {
    return this.m.get(`${org}:${id}`) ?? null;
  }
}
export class InMemoryConnectionRepo implements ConnectionRepo {
  private readonly m = new Map<string, RegistroConexionMeta>();
  async guardar(r: RegistroConexionMeta): Promise<void> {
    this.m.set(`${r.conexion.organizationId}:${r.conexion.connectionId}`, r);
  }
  async obtener(org: string, id: string): Promise<RegistroConexionMeta | null> {
    return this.m.get(`${org}:${id}`) ?? null;
  }
}

// ---------------------------------------------------------------------------
// Authorization URL (FASE 4-5) — allowlist read-only, sin token/secret
// ---------------------------------------------------------------------------

export const SCOPES_A_SOLICITAR: readonly ScopeMeta[] = SCOPES_REQUERIDOS;

export function construirAuthorizationUrl(deps: { appId: string; redirectUri: string; graphVersion: string; state: string }): string {
  const p = new URLSearchParams({
    client_id: deps.appId,
    redirect_uri: deps.redirectUri,
    state: deps.state,
    scope: SCOPES_A_SOLICITAR.join(','),
    response_type: 'code',
  });
  return `https://www.facebook.com/${deps.graphVersion}/dialog/oauth?${p.toString()}`;
}

// ---------------------------------------------------------------------------
// Casos de uso
// ---------------------------------------------------------------------------

export interface IniciarConexionDeps {
  readonly stateStore: OAuthStateStore;
  readonly appId: string;
  readonly redirectUri: string;
  readonly graphVersion: string;
  readonly nonce: string;
  readonly ahora: string;
  readonly ttlMs: number;
}

/** Inicia la conexión Meta: crea el state seguro y devuelve la authorization URL (sin token/secret). */
export async function iniciarConexionMeta(deps: IniciarConexionDeps, organizationId: string, actorId: string): Promise<{ authorizationUrl: string; stateValor: string }> {
  const st = crearEstadoOAuth({ nonce: deps.nonce, ahora: deps.ahora, ttlMs: deps.ttlMs }, organizationId, actorId);
  await deps.stateStore.guardar(st);
  return {
    authorizationUrl: construirAuthorizationUrl({ appId: deps.appId, redirectUri: deps.redirectUri, graphVersion: deps.graphVersion, state: st.valor }),
    stateValor: st.valor,
  };
}

export interface ProcesarCallbackDeps {
  readonly stateStore: OAuthStateStore;
  readonly oauth: MetaOAuthPort;
  readonly secretWriter: SecretWriterPort;
  readonly credRepo: CredentialRepo;
  readonly connRepo: ConnectionRepo;
  readonly descubrir: () => Promise<readonly CandidatoActivo[]>;
  readonly redirectUri: string;
  readonly ahora: string;
}

export interface ResultadoCallbackConexion {
  readonly estado: EstadoConexionMeta;
  readonly connectionId: string | null;
  readonly organizationId: string | null;
  readonly scopesFaltantes: readonly ScopeMeta[];
}

/**
 * Callback: valida+consume state (atómico), intercambia code (fake), valida scopes efectivos, almacena el
 * token vía SecretWriter (sólo referencia), persiste metadata + conexión en BINDING_PENDING. NUNCA marca
 * CONNECTED. Fail-closed: cualquier fallo ⇒ sin CONNECTED falso y el token nunca llega a DB/metadata.
 */
export async function procesarCallbackMeta(deps: ProcesarCallbackDeps, entrada: { stateValor: string; organizationIdCallback?: string; code: string }): Promise<ResultadoCallbackConexion> {
  const fail = (estado: EstadoConexionMeta, org: string | null, faltantes: readonly ScopeMeta[] = []): ResultadoCallbackConexion => ({ estado, connectionId: null, organizationId: org, scopesFaltantes: faltantes });

  const st = await deps.stateStore.obtener(entrada.stateValor);
  const validacion = validarEstadoOAuth(st, { valor: entrada.stateValor, organizationIdCallback: entrada.organizationIdCallback, ahora: deps.ahora });
  if (validacion !== 'OK' || st === null) return fail('NOT_CONNECTED', null);

  const consumo = await deps.stateStore.consumir(entrada.stateValor);
  if (consumo !== 'CONSUMED') return fail('NOT_CONNECTED', st.organizationId); // replay / perdedor de la carrera

  const org = st.organizationId;
  const ex = await deps.oauth.exchangeAuthorizationCode(entrada.code, deps.redirectUri);

  const scopes = validarScopes(ex.effectiveScopes);
  if (!scopes.ok) return fail('SCOPES_INCOMPLETE', org, scopes.faltantes); // token NO se persiste

  const connectionId = `meta-${org}`;
  let secretRef: string;
  try {
    const r = await deps.secretWriter.almacenar(org, `meta-user-token-${connectionId}`, ex.accessTokenValor);
    secretRef = r.secretRef;
  } catch {
    // Exchange OK pero el store falló ⇒ el token NO debe terminar en DB/log/audit. Sin CONNECTED falso.
    return fail('NOT_CONNECTED', org);
  }

  const cred: CredencialMetaRef = {
    provider: 'meta',
    organizationId: org,
    credentialId: connectionId,
    tokenType: ex.tokenType,
    secretRef, // sólo referencia
    issuedAt: ex.issuedAt,
    expiresAt: ex.expiresAt,
    lastValidatedAt: deps.ahora,
    revokedAt: null,
    status: 'ACTIVE',
  };
  await deps.credRepo.guardar(cred);

  const candidatos = await deps.descubrir(); // orquestación de discovery (fake); token nunca al frontend
  const conexion: ConexionMeta = { organizationId: org, provider: 'meta', connectionId, estado: 'BINDING_PENDING', salud: 'HEALTHY', bindings: [], credencialRef: secretRef };
  await deps.connRepo.guardar({ conexion, candidatos });
  return { estado: 'BINDING_PENDING', connectionId, organizationId: org, scopesFaltantes: [] };
}

export interface ConfirmarBindingDeps {
  readonly connRepo: ConnectionRepo;
  readonly scopesEfectivos: readonly ScopeMeta[];
}

export interface ResultadoConfirmarBinding {
  readonly estado: EstadoConexionMeta;
  readonly capacidades: readonly CapacidadNegociada[];
  readonly rechazo: 'NONE' | 'CONNECTION_NOT_FOUND' | 'NOT_DISCOVERED' | 'HUMAN_CONFIRMATION_INVALID';
}

/**
 * Confirma un binding humano. Exige que el candidato HAYA SIDO DESCUBIERTO para esta conexión (no un ID
 * arbitrario del frontend) y confirmación humana por ID canónico. Idempotente para el mismo binding.
 */
export async function confirmarBindingMeta(
  deps: ConfirmarBindingDeps,
  organizationId: string,
  connectionId: string,
  candidato: CandidatoActivo,
  confirmacion: ConfirmacionHumanaBinding,
): Promise<ResultadoConfirmarBinding> {
  const reg = await deps.connRepo.obtener(organizationId, connectionId);
  if (reg === null) return { estado: 'NOT_CONNECTED', capacidades: [], rechazo: 'CONNECTION_NOT_FOUND' };

  const descubierto = reg.candidatos.some((c) => c.externalId === candidato.externalId && c.assetType === candidato.assetType);
  if (!descubierto) return { estado: reg.conexion.estado, capacidades: [], rechazo: 'NOT_DISCOVERED' };

  if (!puedeVincular(candidato, confirmacion)) return { estado: reg.conexion.estado, capacidades: [], rechazo: 'HUMAN_CONFIRMATION_INVALID' };

  const yaVinculado = reg.conexion.bindings.some((b) => b.externalId === candidato.externalId && b.assetType === candidato.assetType);
  const bindings = yaVinculado
    ? reg.conexion.bindings
    : [...reg.conexion.bindings, { assetType: candidato.assetType, externalId: candidato.externalId, displayName: candidato.displayName, confirmadoPorHumano: true }];

  const conexion: ConexionMeta = { ...reg.conexion, estado: 'CONNECTED_READ_ONLY', bindings };
  await deps.connRepo.guardar({ conexion, candidatos: reg.candidatos });
  return { estado: 'CONNECTED_READ_ONLY', capacidades: negociarCapacidades(deps.scopesEfectivos, bindings, 'CONNECTED_READ_ONLY'), rechazo: 'NONE' };
}

// ---------------------------------------------------------------------------
// DTO seguro para el frontend (FASE 19) — jamás token/secretRef/raw
// ---------------------------------------------------------------------------

export interface ConexionDTO {
  readonly organizationId: string;
  readonly provider: 'meta';
  readonly connectionId: string;
  readonly estado: EstadoConexionMeta;
  readonly salud: string;
  readonly bindings: readonly { readonly assetType: string; readonly externalId: string; readonly displayName: string | null }[];
}

export function aConexionDTO(c: ConexionMeta): ConexionDTO {
  return {
    organizationId: c.organizationId,
    provider: c.provider,
    connectionId: c.connectionId,
    estado: c.estado,
    salud: c.salud,
    bindings: c.bindings.map((b) => ({ assetType: b.assetType, externalId: b.externalId, displayName: b.displayName })),
    // NO credencialRef, NO token, NO raw provider response
  };
}

export interface CandidatoDTO {
  readonly assetType: string;
  readonly externalId: string;
  readonly displayName: string | null;
  readonly provider: 'meta';
  /** Sólo `adAccount`: Business propietario o `null` (accesible sin ownership demostrado). */
  readonly ownerBusinessId?: string | null;
  /** Sólo `adAccount`: BUSINESS_OWNED vs USER_ACCESSIBLE. */
  readonly accessMode?: string;
  /** Un candidato descubierto es elegible para binding humano (ownership NO es requisito). */
  readonly bindingEligible: boolean;
}
export function aCandidatoDTO(c: CandidatoActivo): CandidatoDTO {
  const base = { assetType: c.assetType, externalId: c.externalId, displayName: c.displayName, provider: c.provider, bindingEligible: true };
  // ACCESSIBLE ≠ OWNED: para ad accounts se expone la relación real; el binding sigue exigiendo confirmación humana.
  return c.assetType === 'adAccount'
    ? { ...base, ownerBusinessId: c.ownerBusinessId ?? null, accessMode: c.accessMode ?? 'USER_ACCESSIBLE' }
    : base;
}
