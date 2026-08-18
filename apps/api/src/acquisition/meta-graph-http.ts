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

/** Nodo de Graph de una cuenta publicitaria: `act_<account_id>`. Idempotente si ya trae el prefijo. */
function nodoAdAccount(id: string): string {
  return id.startsWith('act_') ? id : `act_${id}`;
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

  /**
   * Cuentas publicitarias ACCESIBLES por el token (`me/adaccounts`), con ads_read. Enumera tanto las
   * propiedad de un Business (BUSINESS_OWNED) como las accesibles sin ownership demostrado
   * (USER_ACCESSIBLE, ownerBusinessId=null). NO usa ownership del Business como única fuente; el identificador
   * canónico es `account_id` (numérico, sin prefijo `act_`). Sólo lectura.
   */
  async discoverAdAccounts(): Promise<readonly CandidatoActivo[]> {
    const j = await this.get('me/adaccounts', { fields: 'account_id,name,account_status,business' });
    const out: CandidatoActivo[] = [];
    for (const a of this.lista(j)) {
      const raw = a['account_id'];
      const id = typeof raw === 'string' ? raw : typeof raw === 'number' ? String(raw) : null;
      if (id === null || id.length === 0) continue;
      const biz = a['business'] as Record<string, unknown> | undefined;
      const ownerBusinessId = biz && typeof biz['id'] === 'string' ? (biz['id'] as string) : null;
      out.push({
        provider: 'meta',
        assetType: 'adAccount',
        externalId: id,
        displayName: typeof a['name'] === 'string' ? (a['name'] as string) : null,
        provenance: 'GRAPH_OBSERVED',
        ownerBusinessId,
        accessMode: ownerBusinessId !== null ? 'BUSINESS_OWNED' : 'USER_ACCESSIBLE',
      });
    }
    return out;
  }

  readInstagramProfile(igsid: string): Promise<unknown> {
    // Identidad básica del IG vinculado (instagram_basic). Distinta de la lectura de /media.
    return this.get(enc(igsid), { fields: 'id,username' });
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
    return this.get(enc(nodoAdAccount(externalAdAccountId)), { fields: 'id,account_id,name,currency,account_status' });
  }
  readCampaigns(externalAdAccountId: string): Promise<unknown> {
    return this.get(`${enc(nodoAdAccount(externalAdAccountId))}/campaigns`, { fields: 'id,name,objective,status,effective_status' });
  }
  readAdsInsights(externalAdAccountId: string): Promise<unknown> {
    return this.get(`${enc(nodoAdAccount(externalAdAccountId))}/insights`, { fields: 'impressions,clicks,spend,actions', level: 'account' });
  }
}
