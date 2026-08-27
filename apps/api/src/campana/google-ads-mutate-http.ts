/**
 * apps/api · campana · TRANSPORTE HTTP de ESCRITURA de Google Ads (`GoogleAdsApiClient`). Es el cliente de bajo
 * nivel que el `GoogleAdsRealMutatePort` (adaptador real ya existente) necesitaba: recibe UNA operación Google
 * ya certificada por el translator y la envía al endpoint `:mutate` correspondiente. NO reimplementa el
 * translator ni el port — sólo transporta.
 *
 * Reutiliza el patrón PROBADO del adaptador de lectura: allowlist de host default-deny (googleads/oauth2),
 * access_token efímero desde el refresh_token CIFRADO (nested `usar`, jamás escapa), header developer-token +
 * login-customer-id. NUNCA registra secretos. En esta fase NO se invoca (SUPERVISED_REAL=false lo bloquea antes).
 */
import type { RequestContext } from '@soec/contracts';
import type { SecretStore } from '@soec/secretos';
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

export interface RefsSecretosEscritura {
  readonly developerToken: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
}
export interface DepsGoogleAdsMutateHttp {
  readonly secretStore: SecretStore;
  readonly ctx: RequestContext;
  readonly secretRefs: RefsSecretosEscritura;
  readonly loginCustomerId: string;
  readonly fetchFn?: typeof fetch;
  readonly apiBaseUrl?: string;
  readonly oauthTokenUrl?: string;
}

function urlAutorizada(raw: string): URL | null {
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  return HOSTS_AUTORIZADOS.has(url.host) ? url : null;
}

export class GoogleAdsMutateHttpClient implements GoogleAdsApiClient {
  private readonly fetchFn: typeof fetch;
  private readonly apiBaseUrl: string;
  private readonly oauthTokenUrl: string;
  constructor(private readonly deps: DepsGoogleAdsMutateHttp) {
    this.fetchFn = deps.fetchFn ?? fetch;
    this.apiBaseUrl = (deps.apiBaseUrl ?? 'https://googleads.googleapis.com').replace(/\/+$/, '');
    this.oauthTokenUrl = deps.oauthTokenUrl ?? 'https://oauth2.googleapis.com/token';
  }

  /** access_token efímero desde el refresh_token cifrado. Los secretos viven sólo dentro de esta frontera. */
  private async accessToken(): Promise<string | null> {
    const url = urlAutorizada(this.oauthTokenUrl);
    if (url === null) return null;
    const refCid = await this.deps.secretStore.resolver(this.deps.ctx, this.deps.secretRefs.clientId);
    const refSec = await this.deps.secretStore.resolver(this.deps.ctx, this.deps.secretRefs.clientSecret);
    const refRef = await this.deps.secretStore.resolver(this.deps.ctx, this.deps.secretRefs.refreshToken);
    return refCid.usar((clientId) => refSec.usar((clientSecret) => refRef.usar(async (refreshToken) => {
      const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' });
      const res = await this.fetchFn(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
      if (!res.ok) return null;
      const json = (await res.json()) as { access_token?: string };
      return json.access_token ?? null;
    })));
  }

  async aplicar(op: GoogleAdsOperation): Promise<{ resourceName: string }> {
    const coleccion = COLECCION[op.resourceType];
    if (!coleccion) throw new Error(`RESOURCE_NO_SOPORTADO: ${op.resourceType}`);
    const accessToken = await this.accessToken();
    if (!accessToken) throw new Error('NO_ACCESS_TOKEN');
    const url = urlAutorizada(`${this.apiBaseUrl}/${API_VERSION}/customers/${op.customerId}/${coleccion}:mutate`);
    if (url === null) throw new Error('HOST_NO_AUTORIZADO');
    // `.create` ⇒ operación create; `.mutate` (pause/stop) ⇒ update con updateMask de los campos enviados.
    const esCreate = op.operation.endsWith('.create');
    const operacion = esCreate ? { create: op.fields } : { update: op.fields, updateMask: Object.keys(op.fields).join(',') };
    const res = await this.deps.secretStore.resolver(this.deps.ctx, this.deps.secretRefs.developerToken).then((r) => r.usar((developerToken) =>
      this.fetchFn(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'developer-token': developerToken, 'login-customer-id': this.deps.loginCustomerId, 'Content-Type': 'application/json' },
        body: JSON.stringify({ operations: [operacion] }),
      }),
    ));
    if (!res.ok) throw new Error(`GOOGLE_MUTATE_HTTP_${res.status}`);
    const json = (await res.json()) as { results?: Array<{ resourceName?: string }> };
    const resourceName = json.results?.[0]?.resourceName;
    if (!resourceName) throw new Error('SIN_RESOURCE_NAME');
    return { resourceName };
  }
}
