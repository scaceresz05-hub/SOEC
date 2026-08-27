/**
 * apps/api · campana · TRANSPORTE HTTP de ESCRITURA de Google Ads (`GoogleAdsApiClient`). Cliente de bajo nivel
 * que el `GoogleAdsRealMutatePort` necesita: recibe UNA operación ya certificada por el translator y la envía al
 * endpoint `:mutate` correspondiente. NO reimplementa translator ni port — sólo transporta.
 *
 * TOKEN (P0): el access_token se resuelve por un THUNK inyectado que usa la CONEXIÓN OAuth REAL por tenant
 * (refresh token CIFRADO) — la misma vía que el descubrimiento de cuentas / refresh, la que funciona en prod.
 * NUNCA `env:GOOGLE_ADS_REFRESH_TOKEN` (ausente en prod). Host allowlist default-deny, developer-token +
 * login-customer-id (manager). Secretos JAMÁS se registran.
 *
 * DIAGNÓSTICO SEGURO: `validateOnly=true` valida la mutación como si fuera real pero Google NO ejecuta (no crea
 * recursos ni gasta). El error de Google (status/code/message) y el `request-id` se registran SANITIZADOS.
 */
import type { GoogleAdsApiClient, GoogleAdsOperation } from './google-ads-real-port';

const HOSTS_AUTORIZADOS = new Set<string>(['googleads.googleapis.com', 'oauth2.googleapis.com']);
const API_VERSION = 'v25';

/** resource_type Google → colección REST del endpoint `:mutate`. */
const COLECCION: Record<string, string> = {
  campaign_budget: 'campaignBudgets',
  campaign: 'campaigns',
  ad_group: 'adGroups',
  ad_group_ad: 'adGroupAds',
  ad_group_criterion: 'adGroupCriteria',
  campaign_criterion: 'campaignCriteria',
};

export interface GoogleAdsWriteLog {
  readonly service: string;
  readonly endpoint: string;
  readonly customerId: string;
  readonly loginCustomerId: string;
  readonly httpStatus: number | null;
  readonly requestId: string | null;
  readonly errorStatus: string | null;
  readonly errorCode: string | null;
  readonly validateOnly: boolean;
  readonly ok: boolean;
}

export interface DepsGoogleAdsMutateHttp {
  /** Resuelve un access_token efímero desde la conexión REAL (refresh token cifrado por tenant). */
  readonly resolverAccessToken: () => Promise<string | null>;
  readonly developerToken: string;
  readonly loginCustomerId: string;
  readonly validateOnly?: boolean;
  /** Sink de logging SANITIZADO (sin secretos). */
  readonly logger?: (info: GoogleAdsWriteLog) => void;
  readonly fetchFn?: typeof fetch;
  readonly apiBaseUrl?: string;
}

function urlAutorizada(raw: string): URL | null {
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  return HOSTS_AUTORIZADOS.has(url.host) ? url : null;
}

/** Extrae status/code/message del cuerpo de error de Google Ads (sin exponer secretos). */
function parseGoogleAdsError(texto: string): { status: string | null; code: string | null; message: string | null } {
  try {
    const j = JSON.parse(texto) as { error?: { status?: string; message?: string; details?: Array<{ errors?: Array<{ errorCode?: Record<string, unknown>; message?: string }> }> } };
    const err = j.error;
    const primero = err?.details?.[0]?.errors?.[0];
    const code = primero?.errorCode ? Object.entries(primero.errorCode).map(([k, v]) => `${k}:${String(v)}`).join('|') : null;
    return { status: err?.status ?? null, code, message: primero?.message ?? err?.message ?? null };
  } catch {
    return { status: null, code: null, message: null };
  }
}

export class GoogleAdsMutateHttpClient implements GoogleAdsApiClient {
  private readonly fetchFn: typeof fetch;
  private readonly apiBaseUrl: string;
  constructor(private readonly deps: DepsGoogleAdsMutateHttp) {
    this.fetchFn = deps.fetchFn ?? fetch;
    this.apiBaseUrl = (deps.apiBaseUrl ?? 'https://googleads.googleapis.com').replace(/\/+$/, '');
  }

  async aplicar(op: GoogleAdsOperation): Promise<{ resourceName: string }> {
    const coleccion = COLECCION[op.resourceType];
    if (!coleccion) throw new Error(`RESOURCE_NO_SOPORTADO: ${op.resourceType}`);
    const accessToken = await this.deps.resolverAccessToken();
    if (!accessToken) throw new Error('NO_ACCESS_TOKEN'); // conexión sin token válido (causa del fallo previo)
    const url = urlAutorizada(`${this.apiBaseUrl}/${API_VERSION}/customers/${op.customerId}/${coleccion}:mutate`);
    if (url === null) throw new Error('HOST_NO_AUTORIZADO');

    const esCreate = op.operation.endsWith('.create');
    const operacion = esCreate ? { create: op.fields } : { update: op.fields, updateMask: Object.keys(op.fields).join(',') };
    const validateOnly = this.deps.validateOnly === true;
    const body = { operations: [operacion], ...(validateOnly ? { validateOnly: true } : {}) };

    const res = await this.fetchFn(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'developer-token': this.deps.developerToken, 'login-customer-id': this.deps.loginCustomerId, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const requestId = res.headers.get('request-id') ?? res.headers.get('x-request-id') ?? null;
    const logBase = { service: coleccion, endpoint: `${coleccion}:mutate`, customerId: op.customerId, loginCustomerId: this.deps.loginCustomerId, httpStatus: res.status, requestId, validateOnly };

    if (!res.ok) {
      const err = parseGoogleAdsError(await res.text());
      this.deps.logger?.({ ...logBase, errorStatus: err.status, errorCode: err.code, ok: false });
      // El mensaje NO lleva secretos: sólo status HTTP, errorCode de Google y request-id (para trazar el fallo).
      throw new Error(`GOOGLE_MUTATE_HTTP_${res.status}${err.status ? `:${err.status}` : ''}${err.code ? `:${err.code}` : ''}${requestId ? `:req=${requestId}` : ''}`);
    }
    this.deps.logger?.({ ...logBase, errorStatus: null, errorCode: null, ok: true });
    // validate_only exitoso ⇒ Google NO crea recurso (results vacío): sentinela, nunca un resourceName inventado.
    if (validateOnly) return { resourceName: 'VALIDATE_ONLY_OK' };
    const json = (await res.json()) as { results?: Array<{ resourceName?: string }> };
    const resourceName = json.results?.[0]?.resourceName;
    if (!resourceName) throw new Error('SIN_RESOURCE_NAME');
    return { resourceName };
  }
}
