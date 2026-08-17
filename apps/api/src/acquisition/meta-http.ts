/**
 * apps/api · Transporte HTTP compartido hacia Meta (Graph/OAuth). Boundary único; fetch + timeout. Los
 * adaptadores (`meta-oauth-http`, `meta-graph-http`) lo usan. NUNCA loggea code/token/app_secret/Authorization
 * ni el cuerpo crudo; los errores se sanitizan con el sanitizer central. En tests se usa un fake fiel.
 */

import { redactarSecretos } from './meta-organic';

export type MetodoHttp = 'GET' | 'POST' | 'DELETE';

export interface PeticionHttpMeta {
  readonly metodo: MetodoHttp;
  readonly url: string; // puede llevar access_token/secret en query → NUNCA loggear cruda
  readonly timeoutMs: number;
}

export interface RespuestaHttpMeta {
  readonly status: number;
  readonly ok: boolean;
  readonly json: unknown; // body parseado o null
}

export interface TransporteMeta {
  readonly esProductivo: boolean;
  enviar(req: PeticionHttpMeta): Promise<RespuestaHttpMeta>;
}

// --- Errores tipados y sanitizados ---------------------------------------------------------------

export class MetaHttpError extends Error {
  constructor(mensaje: string) {
    super(redactarSecretos(mensaje));
    this.name = new.target.name;
  }
}
export class MetaAutenticacionError extends MetaHttpError {} // token/app secret inválido (190/OAuthException)
export class MetaPermisoError extends MetaHttpError {} // falta permiso/scope (10/200/#3)
export class MetaNoDisponibleError extends MetaHttpError {} // red/5xx/rate limit
export class MetaTimeoutError extends MetaHttpError {}
export class MetaRespuestaInvalidaError extends MetaHttpError {} // body inesperado/no-JSON

/** Transporte productivo con `fetch` global (Node 20+) + AbortController. Nunca reexpone url/body en errores. */
export class TransporteHttpMeta implements TransporteMeta {
  readonly esProductivo = true;
  async enviar(req: PeticionHttpMeta): Promise<RespuestaHttpMeta> {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), req.timeoutMs);
    try {
      const resp = await fetch(req.url, { method: req.metodo, signal: ac.signal });
      const texto = await resp.text();
      let json: unknown = null;
      if (texto.length > 0) {
        try {
          json = JSON.parse(texto);
        } catch {
          json = null;
        }
      }
      return { status: resp.status, ok: resp.ok, json };
    } catch {
      throw new MetaNoDisponibleError('transporte Meta no disponible (red o timeout)');
    } finally {
      clearTimeout(t);
    }
  }
}

export interface OpcionesFakeMeta {
  readonly scopes?: readonly string[]; // scopes que devuelve debug_token
  readonly forzarErrorCodigo?: number; // data.error.code para respuestas de crypto/read
  readonly forzarStatus?: number; // status http forzado
  readonly forzarTimeout?: boolean;
}

/**
 * Fake fiel del transporte Meta para tests: responde por substring de URL a los endpoints de OAuth/debug_token
 * y a los reads de Graph con fixtures de SmileFlow. Captura las peticiones para aserciones (p. ej. que el
 * `access_token` nunca se loggea desde acá — el fake sí lo recibe en la URL, como el real). `esProductivo=false`.
 */
export class FakeTransporteMeta implements TransporteMeta {
  readonly esProductivo = false;
  readonly urls: string[] = [];
  constructor(private readonly opts: OpcionesFakeMeta = {}) {}

  async enviar(req: PeticionHttpMeta): Promise<RespuestaHttpMeta> {
    this.urls.push(req.url);
    if (this.opts.forzarTimeout) throw new MetaNoDisponibleError('timeout simulado');
    if (this.opts.forzarStatus !== undefined && !(this.opts.forzarStatus >= 200 && this.opts.forzarStatus < 300)) {
      return { status: this.opts.forzarStatus, ok: false, json: this.opts.forzarErrorCodigo !== undefined ? { error: { code: this.opts.forzarErrorCodigo, message: 'forzado' } } : { error: { message: 'forzado' } } };
    }
    const u = req.url;
    if (u.includes('/oauth/access_token') && u.includes('fb_exchange_token')) return this.ok({ access_token: 'SYNTH_LONG_TOKEN', token_type: 'bearer', expires_in: 5184000 });
    if (u.includes('/oauth/access_token')) return this.ok({ access_token: 'SYNTH_SHORT_TOKEN', token_type: 'bearer', expires_in: 3600 });
    if (u.includes('/debug_token')) return this.ok({ data: { scopes: [...(this.opts.scopes ?? ['pages_show_list', 'business_management', 'instagram_basic', 'pages_read_engagement', 'instagram_manage_insights', 'ads_read'])], user_id: 'SYNTH_USER_1', expires_at: 0 } });
    if (this.opts.forzarErrorCodigo !== undefined) return { status: 400, ok: false, json: { error: { code: this.opts.forzarErrorCodigo, message: 'forzado' } } };
    if (u.includes('/me/businesses')) return this.ok({ data: [{ id: '934186066270538', name: 'SmileFlow' }], paging: { next: 'https://graph.facebook.com/next?access_token=SYNTH_LONG_TOKEN', cursors: { after: 'CUR_A' } } });
    if (u.includes('/me/accounts')) return this.ok({ data: [{ id: '1066708446525633', name: 'Smileflow.clinic', instagram_business_account: { id: '17841432883225770', username: 'smileflow' } }] });
    return this.ok({ data: [], paging: { next: 'https://graph.facebook.com/n?access_token=SYNTH_LONG_TOKEN', cursors: { after: 'CUR_B' } } });
  }
  private ok(json: unknown): RespuestaHttpMeta {
    return { status: this.opts.forzarStatus ?? 200, ok: true, json };
  }
}

/** Código de error de Graph (data.error.code) → clase tipada. */
export function claseErrorGraph(status: number, codigo: number | null): (m: string) => MetaHttpError {
  if (codigo === 190 || status === 401) return (m) => new MetaAutenticacionError(m);
  if (codigo === 10 || codigo === 200 || codigo === 3 || status === 403) return (m) => new MetaPermisoError(m);
  if (status === 429 || status >= 500) return (m) => new MetaNoDisponibleError(m);
  return (m) => new MetaRespuestaInvalidaError(m);
}

/** Extrae `data.error.code` de una respuesta de Graph si existe. */
export function codigoErrorGraph(json: unknown): number | null {
  const err = (json as { error?: { code?: unknown } } | null)?.error;
  return err && typeof err.code === 'number' ? err.code : null;
}
