/**
 * apps/api · DISEÑO del onboarding productivo READ-ONLY de Meta — contratos + máquina de estados.
 *
 * NO conecta nada: no hay OAuth real, token real ni llamada Graph. Diseña el lifecycle seguro para
 * convertir la capacidad ya demostrada manualmente en una conexión productiva de SOLO LECTURA. Reglas:
 *   · descubrir ╪ vincular ╪ conectar: nunca se salta de OAuth a CONNECTED;
 *   · binding SIEMPRE por confirmación humana explícita, por ID canónico (nunca por nombre/admin/app);
 *   · el token NUNCA se almacena en claro; sólo una referencia opaca (`@soec/secretos` lo materializa
 *     en el adapter, jamás el dominio); nunca al frontend/logs/audit/errores;
 *   · capability ╪ authorization: SOEC gobierna por su propia allowlist; un scope inesperado NO eleva
 *     capacidades; jamás hay capacidad de ESCRITURA;
 *   · connectionStatus ╪ healthStatus: una conexión registrada puede estar DEGRADED/REAUTH_REQUIRED.
 * Toda respuesta del futuro Graph client pasa por `sanitizarGraph` de `meta-organic.ts` antes de
 * loggear/persistir. `META_GRAPH_CALLS_FROM_SOEC = 0`.
 */

import type { CandidatoActivo, ScopeMeta } from './meta-oauth';

// ---------------------------------------------------------------------------
// Máquina de estados de la conexión (FASE 1)
// ---------------------------------------------------------------------------

export type EstadoConexionMeta =
  | 'NOT_CONNECTED'
  | 'OAUTH_PENDING'
  | 'OAUTH_CALLBACK_RECEIVED'
  | 'TOKEN_VALIDATING'
  | 'SCOPES_INCOMPLETE'
  | 'ASSETS_DISCOVERED'
  | 'BINDING_PENDING'
  | 'CONNECTED_READ_ONLY'
  | 'DEGRADED'
  | 'REAUTH_REQUIRED'
  | 'REVOKED'
  | 'DISCONNECTED';

const TRANSICIONES: Record<EstadoConexionMeta, readonly EstadoConexionMeta[]> = {
  NOT_CONNECTED: ['OAUTH_PENDING'],
  OAUTH_PENDING: ['OAUTH_CALLBACK_RECEIVED', 'NOT_CONNECTED'], // falla/cancela ⇒ vuelve, nunca CONNECTED
  OAUTH_CALLBACK_RECEIVED: ['TOKEN_VALIDATING', 'NOT_CONNECTED'],
  TOKEN_VALIDATING: ['SCOPES_INCOMPLETE', 'ASSETS_DISCOVERED', 'NOT_CONNECTED'],
  SCOPES_INCOMPLETE: ['OAUTH_PENDING', 'NOT_CONNECTED'], // reintenta autorización
  ASSETS_DISCOVERED: ['BINDING_PENDING', 'NOT_CONNECTED'],
  BINDING_PENDING: ['CONNECTED_READ_ONLY', 'NOT_CONNECTED'], // sólo con confirmación humana pasa a CONNECTED
  CONNECTED_READ_ONLY: ['DEGRADED', 'REAUTH_REQUIRED', 'REVOKED', 'DISCONNECTED'],
  DEGRADED: ['CONNECTED_READ_ONLY', 'REAUTH_REQUIRED', 'REVOKED', 'DISCONNECTED'],
  REAUTH_REQUIRED: ['OAUTH_PENDING', 'REVOKED', 'DISCONNECTED'], // reauth conserva bindings históricos
  REVOKED: ['DISCONNECTED', 'OAUTH_PENDING'],
  DISCONNECTED: ['OAUTH_PENDING'],
};

export function transicionConexionValida(desde: EstadoConexionMeta, hacia: EstadoConexionMeta): boolean {
  return TRANSICIONES[desde].includes(hacia);
}

/** Estados que representan una conexión de lectura efectivamente activa. */
export function conexionActiva(e: EstadoConexionMeta): boolean {
  return e === 'CONNECTED_READ_ONLY' || e === 'DEGRADED';
}

// ---------------------------------------------------------------------------
// Salud (FASE 12) — separada del estado de conexión
// ---------------------------------------------------------------------------

export type SaludConexionMeta =
  | 'HEALTHY'
  | 'TOKEN_EXPIRING'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_REVOKED'
  | 'SCOPE_MISSING'
  | 'ASSET_ACCESS_LOST'
  | 'PROVIDER_ERROR'
  | 'RATE_LIMITED'
  | 'DEGRADED'
  | 'UNKNOWN';

// ---------------------------------------------------------------------------
// Credencial por REFERENCIA (FASE 3-4, 13) — jamás token en claro
// ---------------------------------------------------------------------------

export type TipoTokenMeta = 'USER_LONG_LIVED' | 'PAGE' | 'SYSTEM_USER' | 'NONE';
export type EstadoCredencial = 'VALIDATING' | 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'INVALID';

export interface CredencialMetaRef {
  readonly provider: 'meta';
  readonly organizationId: string;
  readonly credentialId: string;
  readonly tokenType: TipoTokenMeta;
  /** Referencia OPACA (`file:<org>/…`, `vault:…`); nunca el valor. La resuelve el adapter vía SecretStore. */
  readonly secretRef: string;
  readonly issuedAt: string | null;
  readonly expiresAt: string | null;
  readonly lastValidatedAt: string | null;
  readonly revokedAt: string | null;
  readonly status: EstadoCredencial;
}

/** Claves que jamás deben aparecer en una credencial persistida/serializada (token en claro). */
const CLAVES_PROHIBIDAS_CREDENCIAL = ['token', 'accessToken', 'access_token', 'value', 'plaintext', 'secret'];

/** Verifica que un objeto-credencial NO contiene el token en claro (sólo referencia). */
export function credencialSinPlaintext(cred: Record<string, unknown>): boolean {
  return !Object.keys(cred).some((k) => CLAVES_PROHIBIDAS_CREDENCIAL.includes(k));
}

/** Deriva salud desde la vigencia del token (instante inyectado; sin reloj ambiente). */
export function saludDesdeToken(cred: CredencialMetaRef, ahoraISO: string, ventanaExpiracionMs = 72 * 3600 * 1000): SaludConexionMeta {
  if (cred.status === 'REVOKED' || cred.revokedAt !== null) return 'TOKEN_REVOKED';
  if (cred.expiresAt === null) return cred.status === 'ACTIVE' ? 'HEALTHY' : 'UNKNOWN';
  const restante = Date.parse(cred.expiresAt) - Date.parse(ahoraISO);
  if (restante <= 0) return 'TOKEN_EXPIRED';
  if (restante <= ventanaExpiracionMs) return 'TOKEN_EXPIRING';
  return 'HEALTHY';
}

/** Salud del token ⇒ ¿la conexión debe pedir reautorización? Sin borrar bindings históricos. */
export function requiereReauth(salud: SaludConexionMeta): boolean {
  return salud === 'TOKEN_EXPIRED' || salud === 'TOKEN_REVOKED' || salud === 'SCOPE_MISSING';
}

// ---------------------------------------------------------------------------
// Bindings + gate humano (FASE 8, 10)
// ---------------------------------------------------------------------------

export type TipoBindingMeta = 'business' | 'page' | 'instagram' | 'adAccount';

export interface BindingMeta {
  readonly assetType: TipoBindingMeta;
  readonly externalId: string; // ID canónico de Graph, nunca nombre ni id de UI
  readonly displayName: string | null; // sólo display
  readonly confirmadoPorHumano: boolean;
}

export interface ConfirmacionHumanaBinding {
  readonly organizationId: string;
  readonly assetType: TipoBindingMeta;
  readonly externalId: string;
  readonly actorId: string; // quién confirma
}

/**
 * Gate de vinculación humana. Un candidato SÓLO se vincula si un humano confirma explícitamente el par
 * (organizationId, externalId canónico). NUNCA se auto-vincula por mismo admin/nombre/app/Business ni por
 * ser el único resultado. `SC Topografía` es la prueba adversarial: no debe poder entrar a SmileFlow.
 */
export function puedeVincular(candidato: CandidatoActivo, confirmacion: ConfirmacionHumanaBinding): boolean {
  return (
    candidato.provider === 'meta' &&
    candidato.externalId === confirmacion.externalId && // por ID, no por nombre
    candidato.assetType === confirmacion.assetType &&
    confirmacion.actorId.trim() !== '' &&
    confirmacion.organizationId.trim() !== ''
  );
}

/** El binding automático está PROHIBIDO por diseño. */
export const BINDING_AUTOMATICO_PROHIBIDO = true as const;

// ---------------------------------------------------------------------------
// Conexión + negociación de capacidades (FASE 10-11, 15-16)
// ---------------------------------------------------------------------------

export interface ConexionMeta {
  readonly organizationId: string;
  readonly provider: 'meta';
  readonly connectionId: string;
  readonly estado: EstadoConexionMeta;
  readonly salud: SaludConexionMeta;
  readonly bindings: readonly BindingMeta[];
  readonly credencialRef: string | null; // referencia opaca; nunca token
}

/** Capacidades de LECTURA negociables. NUNCA existe una capacidad de escritura. */
export type CapacidadNegociada =
  | 'CAN_READ_PAGE'
  | 'CAN_READ_INSTAGRAM_MEDIA'
  | 'CAN_READ_INSTAGRAM_INSIGHTS'
  | 'CAN_READ_ADS';

const REQUISITOS_CAPACIDAD: Record<CapacidadNegociada, { scopes: readonly ScopeMeta[]; binding: TipoBindingMeta }> = {
  CAN_READ_PAGE: { scopes: ['pages_show_list', 'pages_read_engagement'], binding: 'page' },
  CAN_READ_INSTAGRAM_MEDIA: { scopes: ['instagram_basic'], binding: 'instagram' },
  CAN_READ_INSTAGRAM_INSIGHTS: { scopes: ['instagram_basic', 'instagram_manage_insights'], binding: 'instagram' },
  CAN_READ_ADS: { scopes: ['ads_read'], binding: 'adAccount' },
};

/**
 * Calcula capacidades de LECTURA desde scopes efectivos + bindings confirmados + salud. Gobernada por
 * la allowlist de SOEC: aunque Meta entregue scopes de escritura inesperados, NUNCA se deriva una
 * capacidad de escritura ni de lead retrieval. Sin conexión activa ⇒ ninguna capacidad.
 */
export function negociarCapacidades(
  scopesEfectivos: readonly ScopeMeta[],
  bindings: readonly BindingMeta[],
  estado: EstadoConexionMeta,
): readonly CapacidadNegociada[] {
  if (!conexionActiva(estado)) return [];
  const scopeSet = new Set(scopesEfectivos);
  const bindingConfirmado = (t: TipoBindingMeta) => bindings.some((b) => b.assetType === t && b.confirmadoPorHumano);
  const out: CapacidadNegociada[] = [];
  for (const cap of Object.keys(REQUISITOS_CAPACIDAD) as CapacidadNegociada[]) {
    const req = REQUISITOS_CAPACIDAD[cap];
    if (req.scopes.every((s) => scopeSet.has(s)) && bindingConfirmado(req.binding)) out.push(cap);
  }
  return out; // jamás incluye escritura, aunque scopes de escritura estén presentes
}

// ---------------------------------------------------------------------------
// Puerto de LECTURA de Graph (FASE 15) — sin ningún método de escritura
// ---------------------------------------------------------------------------

export interface MetaGraphReadPort {
  discoverBusinesses(): Promise<readonly CandidatoActivo[]>;
  discoverPages(): Promise<readonly CandidatoActivo[]>;
  discoverInstagram(): Promise<readonly CandidatoActivo[]>;
  /**
   * Enumera las cuentas publicitarias ACCESIBLES por el token (Graph `me/adaccounts`), independientemente
   * de la propiedad del Business. Incluye tanto business-owned como user-accessible (ownerBusinessId null).
   */
  discoverAdAccounts(): Promise<readonly CandidatoActivo[]>;
  readInstagramMedia(igsid: string): Promise<unknown>;
  readInstagramMediaInsights(externalMediaId: string): Promise<unknown>;
  readInstagramAccountInsights(igsid: string): Promise<unknown>;
  readAdAccount(externalAdAccountId: string): Promise<unknown>;
  readCampaigns(externalAdAccountId: string): Promise<unknown>;
  readAdsInsights(externalAdAccountId: string): Promise<unknown>;
}

/** Puerto fake para tests: no red, no token; devuelve candidatos vacíos. NO tiene métodos de escritura. */
export class MetaGraphReadFake implements MetaGraphReadPort {
  async discoverBusinesses(): Promise<readonly CandidatoActivo[]> {
    return [];
  }
  async discoverPages(): Promise<readonly CandidatoActivo[]> {
    return [];
  }
  async discoverInstagram(): Promise<readonly CandidatoActivo[]> {
    return [];
  }
  async discoverAdAccounts(): Promise<readonly CandidatoActivo[]> {
    return [];
  }
  async readInstagramMedia(): Promise<unknown> {
    return { data: [] };
  }
  async readInstagramMediaInsights(): Promise<unknown> {
    return { data: [] };
  }
  async readInstagramAccountInsights(): Promise<unknown> {
    return { data: [] };
  }
  async readAdAccount(): Promise<unknown> {
    return {};
  }
  async readCampaigns(): Promise<unknown> {
    return { data: [] };
  }
  async readAdsInsights(): Promise<unknown> {
    return { data: [] };
  }
}
