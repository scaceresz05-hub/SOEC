/**
 * apps/api · campana · ADAPTER PAUSE-ONLY de Google Ads. La ÚNICA operación que expone es PAUSAR una campaña
 * (Campaign status ENABLED→PAUSED) — acción REDUCTORA DE RIESGO. Estructuralmente INCAPAZ de habilitar, crear
 * (campaign/budget/adGroup/ad/criterio), editar presupuesto/geo/keywords o cualquier otra mutación: el body está
 * fijado a `{ status: 'PAUSED' }` con `updateMask: 'status'`. NO reutiliza el executor de creación ni el translator
 * general. Token por conexión REAL (mismo path que el resto). Errores sanitizados, sin secretos.
 */
const HOSTS_AUTORIZADOS = new Set<string>(['googleads.googleapis.com']);
const API_VERSION = 'v25';

export interface DepsPauseAdapter {
  readonly resolverAccessToken: () => Promise<string | null>;
  readonly developerToken: string;
  readonly loginCustomerId: string;
  readonly fetchFn?: typeof fetch;
  readonly apiBaseUrl?: string;
  readonly logger?: (info: { service: string; customerId: string; httpStatus: number | null; requestId: string | null; ok: boolean; errorStatus: string | null }) => void;
}

export interface ResultadoPausa {
  readonly ok: boolean;
  readonly httpStatus: number;
  readonly requestId: string | null;
  readonly resourceName: string | null; // el recurso realmente pausado (de la respuesta), o null en error
  readonly errorStatus: string | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
}

function urlAutorizada(raw: string): URL | null {
  try { const u = new URL(raw); return HOSTS_AUTORIZADOS.has(u.host) ? u : null; } catch { return null; }
}

function parseError(texto: string): { status: string | null; code: string | null; message: string | null } {
  try {
    const j = JSON.parse(texto) as { error?: { status?: string; message?: string; details?: Array<{ errors?: Array<{ errorCode?: Record<string, unknown>; message?: string }> }> } };
    const err = j.error; const primero = err?.details?.[0]?.errors?.[0];
    const code = primero?.errorCode ? Object.entries(primero.errorCode).map(([k, v]) => `${k}:${String(v)}`).join('|') : null;
    return { status: err?.status ?? null, code, message: (primero?.message ?? err?.message ?? null)?.slice(0, 600) ?? null };
  } catch { return { status: null, code: null, message: null }; }
}

export class GoogleAdsPauseAdapter {
  private readonly fetchFn: typeof fetch;
  private readonly apiBaseUrl: string;
  constructor(private readonly deps: DepsPauseAdapter) {
    this.fetchFn = deps.fetchFn ?? fetch;
    this.apiBaseUrl = (deps.apiBaseUrl ?? 'https://googleads.googleapis.com').replace(/\/+$/, '');
  }

  /**
   * Pausa UNA campaña por su resourceName real. Valida que el recurso sea una CAMPAÑA del customer indicado
   * (nunca otro recurso, nunca otro customer). El único cambio posible es status=PAUSED (updateMask=status).
   */
  async pausarCampania(customerId: string, campaignResourceName: string): Promise<ResultadoPausa> {
    if (!/^customers\/\d+\/campaigns\/\d+$/.test(campaignResourceName)) throw new Error('RESOURCE_NAME_NO_ES_CAMPAIGN');
    if (!campaignResourceName.startsWith(`customers/${customerId}/`)) throw new Error('CUSTOMER_ID_MISMATCH');
    const accessToken = await this.deps.resolverAccessToken();
    if (!accessToken) throw new Error('NO_ACCESS_TOKEN');
    const url = urlAutorizada(`${this.apiBaseUrl}/${API_VERSION}/customers/${customerId}/campaigns:mutate`);
    if (url === null) throw new Error('HOST_NO_AUTORIZADO');
    // PAUSE-ONLY: body FIJO. Sólo status→PAUSED. Nada de create/enable/budget/targeting.
    const body = { operations: [{ update: { resourceName: campaignResourceName, status: 'PAUSED' }, updateMask: 'status' }] };
    const res = await this.fetchFn(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'developer-token': this.deps.developerToken, 'login-customer-id': this.deps.loginCustomerId, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const requestId = res.headers.get('request-id') ?? res.headers.get('x-request-id') ?? null;
    if (!res.ok) {
      const e = parseError(await res.text());
      this.deps.logger?.({ service: 'campaigns:mutate(pause)', customerId, httpStatus: res.status, requestId, ok: false, errorStatus: e.status });
      return { ok: false, httpStatus: res.status, requestId, resourceName: null, errorStatus: e.status, errorCode: e.code, errorMessage: e.message };
    }
    let resourceName: string | null = null;
    try { const j = JSON.parse(await res.text()) as { results?: Array<{ resourceName?: string }> }; resourceName = j.results?.[0]?.resourceName ?? campaignResourceName; } catch { resourceName = campaignResourceName; }
    this.deps.logger?.({ service: 'campaigns:mutate(pause)', customerId, httpStatus: res.status, requestId, ok: true, errorStatus: null });
    return { ok: true, httpStatus: res.status, requestId, resourceName, errorStatus: null, errorCode: null, errorMessage: null };
  }
}
