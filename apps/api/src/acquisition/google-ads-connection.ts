/**
 * apps/api · DOMINIO de la conexión Google Ads (READ ONLY, multi-tenant). Provider AISLADO: no comparte
 * tipos con Meta (Meta permanece congelado). Modela el ciclo de vida de una conexión OAuth por organización:
 *
 *   NOT_CONNECTED → OAUTH_PENDING → ACCOUNT_SELECTION_PENDING → CONNECTED
 *                                                            ↘ NEEDS_REAUTH (token revocado/caducado)
 *   CONNECTED/NEEDS_REAUTH → DISCONNECTED (desconexión explícita del usuario)
 *
 * La deuda de identidad de la cuenta (customerId/loginCustomerId/timezone) vive en la fila de la conexión
 * en DB (tenant-scoped), NO en el registro estático TS: por eso una empresa nueva conecta sin editar código.
 * El refresh token NUNCA vive aquí: sólo su REFERENCIA opaca (`credencialRef` = `secretstore:<org>/<name>`).
 * Ningún DTO expone credencialRef ni token: el usuario ve estado/cuenta/frescura, nunca secretos ni OAuth internals.
 */

/** Estado del ciclo de vida de la conexión (máquina determinista). */
export type EstadoConexionGoogleAds =
  | 'NOT_CONNECTED' // sin conexión
  | 'OAUTH_PENDING' // start emitido; esperando callback
  | 'ACCOUNT_SELECTION_PENDING' // OAuth OK, refresh token guardado; falta que el humano elija cuenta
  | 'CONNECTED' // cuenta seleccionada y acceso validado
  | 'NEEDS_REAUTH' // token revocado/caducado (invalid_grant): datos históricos conservados
  | 'DISCONNECTED'; // desconectado explícitamente (credencial revocada)

/** Salud operacional, separada del estado del ciclo de vida (derivada de frescura/último refresh). */
export type SaludConexionGoogleAds = 'HEALTHY' | 'STALE' | 'NEEDS_REAUTH' | 'NO_DATA' | 'ERROR' | 'UNKNOWN';

/** Transiciones VÁLIDAS. Cualquier otra es rechazada (fail-closed). */
const TRANSICIONES: Readonly<Record<EstadoConexionGoogleAds, readonly EstadoConexionGoogleAds[]>> = {
  NOT_CONNECTED: ['OAUTH_PENDING'],
  OAUTH_PENDING: ['ACCOUNT_SELECTION_PENDING', 'NOT_CONNECTED', 'NEEDS_REAUTH'],
  ACCOUNT_SELECTION_PENDING: ['CONNECTED', 'ACCOUNT_SELECTION_PENDING', 'NEEDS_REAUTH', 'DISCONNECTED'],
  CONNECTED: ['CONNECTED', 'ACCOUNT_SELECTION_PENDING', 'NEEDS_REAUTH', 'DISCONNECTED'],
  NEEDS_REAUTH: ['OAUTH_PENDING', 'ACCOUNT_SELECTION_PENDING', 'CONNECTED', 'DISCONNECTED'],
  DISCONNECTED: ['OAUTH_PENDING'],
};

export function transicionConexionValida(desde: EstadoConexionGoogleAds, hacia: EstadoConexionGoogleAds): boolean {
  return TRANSICIONES[desde].includes(hacia);
}

/** ¿La conexión está operativa para sincronizar? Sólo CONNECTED. */
export function conexionOperativa(estado: EstadoConexionGoogleAds): boolean {
  return estado === 'CONNECTED';
}

/** Referencia de credencial: metadatos + secretRef OPACO. NUNCA el token. */
export type EstadoCredencialGoogleAds = 'ACTIVE' | 'REVOKED';
export interface CredencialGoogleAdsRef {
  readonly provider: 'google-ads';
  readonly organizationId: string;
  readonly credentialId: string;
  readonly secretRef: string; // `secretstore:<org>/<name>` — opaco, sin material secreto
  readonly issuedAt: string | null;
  readonly lastValidatedAt: string | null;
  readonly revokedAt: string | null;
  readonly status: EstadoCredencialGoogleAds;
}

/** Cuenta publicitaria descubierta (candidato de selección). `displayName` es sólo display; identidad = customerId. */
export interface CuentaGoogleAds {
  readonly customerId: string; // 10 dígitos, sin guiones
  readonly descriptiveName: string | null; // sólo display; NUNCA identidad
  readonly currencyCode: string | null;
  readonly timeZone: string | null;
  readonly manager: boolean; // ¿es una cuenta administradora (MCC)?
  readonly testAccount: boolean;
  /** Manager (MCC) a usar como `login-customer-id` al consultar esta cuenta cliente; null ⇒ acceso directo. */
  readonly managerCustomerId?: string | null;
}

/** Conexión Google Ads persistida (tenant-scoped). El identificador estable es `connectionId = google-ads-<org>`. */
export interface ConexionGoogleAds {
  readonly organizationId: string;
  readonly connectionId: string;
  readonly estado: EstadoConexionGoogleAds;
  readonly salud: SaludConexionGoogleAds;
  /** Cuenta seleccionada (null hasta que el humano elige). */
  readonly customerId: string | null;
  /** MCC autorizante para el header `login-customer-id`; null ⇒ acceso directo (login = customerId). */
  readonly loginCustomerId: string | null;
  readonly descriptiveName: string | null;
  readonly timeZone: string | null;
  readonly currencyCode: string | null;
  readonly credencialRef: string | null; // secretRef OPACO del refresh token; null si sin credencial
  readonly needsReauth: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function connectionIdDe(org: string): string {
  return `google-ads-${org}`;
}

/** DTO SEGURO para el frontend: nunca credencialRef, nunca token, nunca OAuth internals. */
export interface ConexionGoogleAdsDTO {
  readonly estado: EstadoConexionGoogleAds;
  readonly salud: SaludConexionGoogleAds;
  readonly customerId: string | null;
  readonly descriptiveName: string | null;
  readonly timeZone: string | null;
  readonly currencyCode: string | null;
  readonly needsReauth: boolean;
  readonly connectedAt: string | null;
}

export function aConexionDTO(c: ConexionGoogleAds): ConexionGoogleAdsDTO {
  return {
    estado: c.estado,
    salud: c.salud,
    customerId: c.customerId,
    descriptiveName: c.descriptiveName,
    timeZone: c.timeZone,
    currencyCode: c.currencyCode,
    needsReauth: c.needsReauth,
    connectedAt: c.estado === 'CONNECTED' ? c.updatedAt : null,
  };
}

/** DTO SEGURO de una cuenta candidata (sólo lo necesario para elegir). */
export interface CuentaGoogleAdsDTO {
  readonly customerId: string;
  readonly descriptiveName: string | null;
  readonly currencyCode: string | null;
  readonly timeZone: string | null;
  readonly manager: boolean;
  readonly testAccount: boolean;
}

export function aCuentaDTO(c: CuentaGoogleAds): CuentaGoogleAdsDTO {
  return {
    customerId: c.customerId,
    descriptiveName: c.descriptiveName,
    currencyCode: c.currencyCode,
    timeZone: c.timeZone,
    manager: c.manager,
    testAccount: c.testAccount,
  };
}

/** Conexión inicial vacía (NOT_CONNECTED) para una organización. */
export function conexionInicial(org: string, ahora: string): ConexionGoogleAds {
  return {
    organizationId: org,
    connectionId: connectionIdDe(org),
    estado: 'NOT_CONNECTED',
    salud: 'UNKNOWN',
    customerId: null,
    loginCustomerId: null,
    descriptiveName: null,
    timeZone: null,
    currencyCode: null,
    credencialRef: null,
    needsReauth: false,
    createdAt: ahora,
    updatedAt: ahora,
  };
}
