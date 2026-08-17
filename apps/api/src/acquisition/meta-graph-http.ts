/**
 * apps/api · Adaptador PRODUCTIVO de `MetaGraphReadPort` sobre Graph — SÓLO LECTURA. Cero métodos write.
 *
 * Todas las peticiones son GET, con `appsecret_proof` (HMAC-SHA256 del token con el app secret). El token
 * vive SÓLO en el boundary (inyectado; el orquestador lo resuelve desde el SecretStore para la duración del
 * read smoke y lo descarta). NUNCA se loggea token/proof ni se persiste el raw response: toda respuesta pasa
 * por `sanitizarGraph`, que descarta las URLs de paging (con access_token) y conserva sólo cursors.
 */

import { createHmac } from 'node:crypto';
import type { CandidatoActivo } from './meta-oauth';
import type { MetaGraphReadPort } from './meta-onboarding';
import { claseErrorGraph, codigoErrorGraph, type TransporteMeta } from './meta-http';
import { sanitizarGraph } from './meta-organic';

export interface ConfigGraphRead {
  readonly graphVersion: string;
  readonly appSecret: string; // sólo para computar appsecret_proof; nunca se loggea
}

function enc(s: string): string {
  return encodeURIComponent(s);
}

export class MetaGraphReadHttpAdapter implements MetaGraphReadPort {
  private readonly proof: string;
  constructor(
    private readonly cfg: ConfigGraphRead,
    private readonly transporte: TransporteMeta,
    private readonly accessToken: string, // boundary-only; jamás persistido/loggeado
    private readonly timeoutMs = 8000,
  ) {
    this.proof = createHmac('sha256', cfg.appSecret).update(accessToken).digest('hex');
  }

  /** GET read-only → JSON sanitizado (sin URLs de paging, sin tokens). Errores tipados. */
  private async get(path: string, params: Readonly<Record<string, string>> = {}): Promise<unknown> {
    const qs = new URLSearchParams({ ...params, access_token: this.accessToken, appsecret_proof: this.proof }).toString();
    const url = `https://graph.facebook.com/${this.cfg.graphVersion}/${path}?${qs}`;
    const r = await this.transporte.enviar({ metodo: 'GET', url, timeoutMs: this.timeoutMs });
    if (!r.ok) throw claseErrorGraph(r.status, codigoErrorGraph(r.json))(`Graph read falló en ${path}`);
    return sanitizarGraph(r.json);
  }

  private lista(json: unknown): readonly Record<string, unknown>[] {
    const data = (json as { data?: unknown } | null)?.data;
    return Array.isArray(data) ? (data.filter((x) => x && typeof x === 'object') as Record<string, unknown>[]) : [];
  }
  private candidato(assetType: CandidatoActivo['assetType'], id: unknown, name: unknown): CandidatoActivo | null {
    if (typeof id !== 'string' || id.length === 0) return null;
    return { provider: 'meta', assetType, externalId: id, displayName: typeof name === 'string' ? name : null, provenance: 'GRAPH_OBSERVED' };
  }

  async discoverBusinesses(): Promise<readonly CandidatoActivo[]> {
    const j = await this.get('me/businesses', { fields: 'id,name' });
    return this.lista(j)
      .map((b) => this.candidato('business', b['id'], b['name']))
      .filter((c): c is CandidatoActivo => c !== null);
  }

  async discoverPages(): Promise<readonly CandidatoActivo[]> {
    const j = await this.get('me/accounts', { fields: 'id,name' });
    return this.lista(j)
      .map((p) => this.candidato('page', p['id'], p['name']))
      .filter((c): c is CandidatoActivo => c !== null);
  }

  async discoverInstagram(): Promise<readonly CandidatoActivo[]> {
    const j = await this.get('me/accounts', { fields: 'instagram_business_account{id,username}' });
    const out: CandidatoActivo[] = [];
    for (const p of this.lista(j)) {
      const iba = p['instagram_business_account'] as Record<string, unknown> | undefined;
      const c = iba ? this.candidato('instagram', iba['id'], iba['username']) : null;
      if (c) out.push(c);
    }
    return out;
  }

  readInstagramMedia(igsid: string): Promise<unknown> {
    return this.get(`${enc(igsid)}/media`, { fields: 'id,media_type,media_product_type,timestamp,permalink' });
  }
  readInstagramMediaInsights(externalMediaId: string): Promise<unknown> {
    return this.get(`${enc(externalMediaId)}/insights`, { metric: 'reach,likes,comments,saved,shares,total_interactions,views' });
  }
  readInstagramAccountInsights(igsid: string): Promise<unknown> {
    return this.get(`${enc(igsid)}/insights`, { metric: 'reach,follower_count', period: 'day' });
  }
  readAdAccount(externalAdAccountId: string): Promise<unknown> {
    return this.get(enc(externalAdAccountId), { fields: 'id,account_id,name,currency,account_status' });
  }
  readCampaigns(externalAdAccountId: string): Promise<unknown> {
    return this.get(`${enc(externalAdAccountId)}/campaigns`, { fields: 'id,name,objective,status,effective_status' });
  }
  readAdsInsights(externalAdAccountId: string): Promise<unknown> {
    return this.get(`${enc(externalAdAccountId)}/insights`, { fields: 'impressions,clicks,spend,actions', level: 'account' });
  }
}
