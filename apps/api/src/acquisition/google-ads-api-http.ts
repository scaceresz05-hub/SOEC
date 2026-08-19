/**
 * apps/api · CAPA DE COMPOSICIÓN · Adaptadores de FRONTERA HTTP para Google Ads OAuth + descubrimiento de
 * cuentas (READ ONLY). Vive fuera de @soec/adaptadores (que prohíbe red): aquí sí se permite `fetch`.
 *
 * Allowlist de host default-deny: sólo `oauth2.googleapis.com` (token/revoke) y `googleads.googleapis.com`
 * (cuentas). Cualquier otro host ⇒ error, jamás wildcard. NUNCA se registran ni retornan secretos
 * (client_secret / refresh_token / access_token / developer_token). El cuerpo de error del proveedor NO se
 * propaga al usuario: sólo se CLASIFICA (INVALID_GRANT vs OTHER) para el estado de la conexión.
 *
 * READ ONLY: los únicos endpoints usados son token-exchange/refresh/revoke y `googleAds:searchStream` /
 * `customers:listAccessibleCustomers`. NO existe ningún método de mutación (mutate/create/update/remove).
 */

import type { CuentaGoogleAds } from './google-ads-connection';

const API_VERSION = 'v25';
const HOSTS_AUTORIZADOS = new Set<string>(['oauth2.googleapis.com', 'googleads.googleapis.com']);

function urlAutorizada(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  return HOSTS_AUTORIZADOS.has(url.host) ? url : null;
}

// ---------------------------------------------------------------------------
// Puerto OAuth
// ---------------------------------------------------------------------------

/** Resultado del intercambio de authorization code: incluye el refresh_token (se persistirá CIFRADO). */
export type ResultadoIntercambio =
  | { readonly ok: true; readonly refreshToken: string; readonly accessToken: string; readonly scope: string; readonly expiresIn: number }
  | { readonly ok: false; readonly motivo: 'CODE_INVALIDO' | 'SIN_REFRESH_TOKEN' | 'ERROR' };

/** Resultado del refresh de access token: clasifica invalid_grant (token revocado/caducado) sin filtrar el cuerpo. */
export type ResultadoRefresh =
  | { readonly ok: true; readonly accessToken: string; readonly expiresIn: number }
  | { readonly ok: false; readonly motivo: 'INVALID_GRANT' | 'ERROR' };

export interface GoogleOAuthPort {
  /** Intercambia un authorization code por tokens. Exige refresh_token (access_type=offline). */
  intercambiarCodigo(code: string, redirectUri: string, signal?: AbortSignal): Promise<ResultadoIntercambio>;
  /** Renueva un access_token efímero desde el refresh_token. Clasifica invalid_grant. */
  refrescarAccessToken(refreshToken: string, signal?: AbortSignal): Promise<ResultadoRefresh>;
  /** Revoca el refresh_token en Google (best-effort; usado al desconectar). */
  revocar(refreshToken: string, signal?: AbortSignal): Promise<void>;
}

interface RespuestaTokenGoogle {
  readonly access_token?: string;
  readonly refresh_token?: string;
  readonly expires_in?: number;
  readonly scope?: string;
  readonly error?: string;
}

export interface DepsGoogleOAuthHttp {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly fetchFn?: typeof fetch;
  readonly tokenUrl?: string;
  readonly revokeUrl?: string;
}

/**
 * Adaptador OAuth HTTP productivo. Los secretos (clientId/clientSecret/refreshToken) llegan EN CLARO sólo
 * dentro de esta frontera y jamás se registran ni retornan.
 */
export class GoogleOAuthHttpAdapter implements GoogleOAuthPort {
  private readonly fetchFn: typeof fetch;
  private readonly tokenUrl: string;
  private readonly revokeUrl: string;
  constructor(private readonly deps: DepsGoogleOAuthHttp) {
    this.fetchFn = deps.fetchFn ?? fetch;
    this.tokenUrl = deps.tokenUrl ?? 'https://oauth2.googleapis.com/token';
    this.revokeUrl = deps.revokeUrl ?? 'https://oauth2.googleapis.com/revoke';
  }

  async intercambiarCodigo(code: string, redirectUri: string, signal?: AbortSignal): Promise<ResultadoIntercambio> {
    const url = urlAutorizada(this.tokenUrl);
    if (url === null) return { ok: false, motivo: 'ERROR' };
    const body = new URLSearchParams({
      code,
      client_id: this.deps.clientId,
      client_secret: this.deps.clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });
    let res: Response;
    try {
      res = await this.fetchFn(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, ...(signal ? { signal } : {}) });
    } catch {
      return { ok: false, motivo: 'ERROR' };
    }
    if (!res.ok) return { ok: false, motivo: 'CODE_INVALIDO' };
    const json = (await res.json()) as RespuestaTokenGoogle;
    if (!json.refresh_token || !json.access_token) return { ok: false, motivo: 'SIN_REFRESH_TOKEN' };
    return { ok: true, refreshToken: json.refresh_token, accessToken: json.access_token, scope: json.scope ?? '', expiresIn: json.expires_in ?? 0 };
  }

  async refrescarAccessToken(refreshToken: string, signal?: AbortSignal): Promise<ResultadoRefresh> {
    const url = urlAutorizada(this.tokenUrl);
    if (url === null) return { ok: false, motivo: 'ERROR' };
    const body = new URLSearchParams({
      client_id: this.deps.clientId,
      client_secret: this.deps.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });
    let res: Response;
    try {
      res = await this.fetchFn(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, ...(signal ? { signal } : {}) });
    } catch {
      return { ok: false, motivo: 'ERROR' };
    }
    if (!res.ok) {
      // Clasificamos invalid_grant SIN propagar el cuerpo del proveedor al usuario.
      let motivo: 'INVALID_GRANT' | 'ERROR' = 'ERROR';
      try {
        const json = (await res.json()) as RespuestaTokenGoogle;
        if (json.error === 'invalid_grant') motivo = 'INVALID_GRANT';
      } catch {
        /* cuerpo no-JSON ⇒ ERROR genérico */
      }
      return { ok: false, motivo };
    }
    const json = (await res.json()) as RespuestaTokenGoogle;
    if (!json.access_token) return { ok: false, motivo: 'ERROR' };
    return { ok: true, accessToken: json.access_token, expiresIn: json.expires_in ?? 0 };
  }

  async revocar(refreshToken: string, signal?: AbortSignal): Promise<void> {
    const url = urlAutorizada(this.revokeUrl);
    if (url === null) return;
    const body = new URLSearchParams({ token: refreshToken });
    try {
      await this.fetchFn(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, ...(signal ? { signal } : {}) });
    } catch {
      /* best-effort: la desconexión local procede aunque la revocación remota falle */
    }
  }
}

// ---------------------------------------------------------------------------
// Puerto de descubrimiento de cuentas
// ---------------------------------------------------------------------------

export interface GoogleAdsAccountsPort {
  /** Customers accesibles por el token (IDs de 10 dígitos, sin `customers/`). */
  listAccessibleCustomers(accessToken: string, signal?: AbortSignal): Promise<readonly string[]>;
  /** Describe una cuenta (nombre/moneda/tz/manager/test). null si no accesible con ese login. */
  describeCustomer(accessToken: string, customerId: string, loginCustomerId: string | null, signal?: AbortSignal): Promise<CuentaGoogleAds | null>;
  /** Lista los customerIds cliente bajo un manager (MCC) — para resolver `login-customer-id`. */
  listClientCustomers(accessToken: string, managerCustomerId: string, signal?: AbortSignal): Promise<readonly string[]>;
}

const GAQL_CUSTOMER = 'SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.manager, customer.test_account FROM customer';
const GAQL_CLIENTES = 'SELECT customer_client.id, customer_client.manager, customer_client.level FROM customer_client WHERE customer_client.level <= 1';

export interface DepsGoogleAdsAccountsHttp {
  readonly developerToken: string;
  readonly fetchFn?: typeof fetch;
  readonly apiBaseUrl?: string;
}

export class GoogleAdsAccountsHttpAdapter implements GoogleAdsAccountsPort {
  private readonly fetchFn: typeof fetch;
  private readonly apiBaseUrl: string;
  constructor(private readonly deps: DepsGoogleAdsAccountsHttp) {
    this.fetchFn = deps.fetchFn ?? fetch;
    this.apiBaseUrl = (deps.apiBaseUrl ?? 'https://googleads.googleapis.com').replace(/\/+$/, '');
  }

  private headers(accessToken: string, loginCustomerId: string | null): Record<string, string> {
    const h: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      'developer-token': this.deps.developerToken,
      'Content-Type': 'application/json',
    };
    if (loginCustomerId) h['login-customer-id'] = loginCustomerId;
    return h;
  }

  async listAccessibleCustomers(accessToken: string, signal?: AbortSignal): Promise<readonly string[]> {
    const url = urlAutorizada(`${this.apiBaseUrl}/${API_VERSION}/customers:listAccessibleCustomers`);
    if (url === null) return [];
    let res: Response;
    try {
      res = await this.fetchFn(url, { method: 'GET', headers: this.headers(accessToken, null), ...(signal ? { signal } : {}) });
    } catch {
      return [];
    }
    if (!res.ok) return [];
    const json = (await res.json()) as { resourceNames?: string[] };
    return (json.resourceNames ?? []).map((r) => r.replace(/^customers\//, ''));
  }

  private async searchStream(accessToken: string, customerId: string, loginCustomerId: string | null, query: string, signal?: AbortSignal): Promise<unknown[] | null> {
    const url = urlAutorizada(`${this.apiBaseUrl}/${API_VERSION}/customers/${customerId}/googleAds:searchStream`);
    if (url === null) return null;
    let res: Response;
    try {
      res = await this.fetchFn(url, { method: 'POST', headers: this.headers(accessToken, loginCustomerId), body: JSON.stringify({ query }), ...(signal ? { signal } : {}) });
    } catch {
      return null;
    }
    if (!res.ok) return null;
    const text = await res.text();
    try {
      const batches = JSON.parse(text) as Array<{ results?: unknown[] }>;
      return batches.flatMap((b) => b.results ?? []);
    } catch {
      return null;
    }
  }

  async describeCustomer(accessToken: string, customerId: string, loginCustomerId: string | null, signal?: AbortSignal): Promise<CuentaGoogleAds | null> {
    const filas = await this.searchStream(accessToken, customerId, loginCustomerId ?? customerId, GAQL_CUSTOMER, signal);
    if (filas === null || filas.length === 0) return null;
    const c = (filas[0] as { customer?: Record<string, unknown> }).customer ?? {};
    return {
      customerId,
      descriptiveName: c['descriptiveName'] != null ? String(c['descriptiveName']) : null,
      currencyCode: c['currencyCode'] != null ? String(c['currencyCode']) : null,
      timeZone: c['timeZone'] != null ? String(c['timeZone']) : null,
      manager: c['manager'] === true,
      testAccount: c['testAccount'] === true,
      managerCustomerId: loginCustomerId,
    };
  }

  async listClientCustomers(accessToken: string, managerCustomerId: string, signal?: AbortSignal): Promise<readonly string[]> {
    const filas = await this.searchStream(accessToken, managerCustomerId, managerCustomerId, GAQL_CLIENTES, signal);
    if (filas === null) return [];
    const ids: string[] = [];
    for (const f of filas) {
      const cc = (f as { customerClient?: Record<string, unknown> }).customerClient;
      if (cc && cc['id'] != null && cc['manager'] !== true) ids.push(String(cc['id']));
    }
    return ids;
  }
}
