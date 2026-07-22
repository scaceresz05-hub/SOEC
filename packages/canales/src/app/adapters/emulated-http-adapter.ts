/**
 * Adaptador de canal EMULADO por HTTP (modo `sandbox`, F2-CHAN-01 §3). Cruza una
 * frontera de red real (fetch) hacia el proveedor emulado. Traduce respuestas del
 * proveedor a resultados de envío, distinguiendo aceptada/publicada/rate_limited/
 * desconocida/fallida, respetando `Retry-After` y tratando el timeout como estado
 * DESCONOCIDO (el objeto pudo crearse → reconciliar por clave de idempotencia).
 * Envía el token de credencial como Bearer; nunca lo registra.
 */
import type { CanalCapabilities } from '../../domain/capabilities';
import type { CredencialResuelta } from '../../domain/credentials';
import { categoriaDesdeHttp, errorPublicacion } from '../../domain/errors-canal';
import type { AdaptadorCanal, ContextoEnvio, EstadoRemoto, ResultadoEnvio } from '../../domain/ports';
import { capacidadesDeCanal } from '../capabilities-catalog';

interface RespuestaHttp {
  status: number;
  body: unknown;
  retryAfterMs: number | null;
  redError: boolean;
}

export class AdaptadorCanalEmulado implements AdaptadorCanal {
  readonly nombre = 'canal-emulado-http';
  readonly version = '1.0.0';
  readonly modo = 'sandbox' as const;

  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs = 3000,
  ) {}

  soporta(canal: string): boolean {
    return capacidadesDeCanal(canal) !== null;
  }
  capacidades(canal: string): CanalCapabilities {
    const c = capacidadesDeCanal(canal);
    if (!c) throw new Error(`canal no soportado: ${canal}`);
    return c;
  }

  private async pedir(metodo: string, ruta: string, token: string, cuenta: string, cuerpo?: unknown, idem?: string, signal?: AbortSignal): Promise<RespuestaHttp> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    if (signal) signal.addEventListener('abort', () => ctrl.abort(), { once: true });
    const headers: Record<string, string> = { authorization: `Bearer ${token}`, 'x-emu-account': cuenta };
    if (cuerpo) headers['content-type'] = 'application/json'; // sin cuerpo no se declara content-type (evita 400 en GET/DELETE)
    if (idem) headers['idempotency-key'] = idem;
    try {
      const res = await fetch(`${this.baseUrl}${ruta}`, { method: metodo, headers, body: cuerpo ? JSON.stringify(cuerpo) : undefined, signal: ctrl.signal });
      const retry = res.headers.get('retry-after');
      const body = await res.json().catch(() => ({}));
      return { status: res.status, body, retryAfterMs: retry ? Number(retry) * 1000 : null, redError: false };
    } catch {
      // Timeout/red: outcome DESCONOCIDO (el objeto pudo haberse creado).
      return { status: 0, body: {}, retryAfterMs: null, redError: true };
    } finally {
      clearTimeout(timer);
    }
  }

  async enviar(ctx: ContextoEnvio, signal?: AbortSignal): Promise<ResultadoEnvio> {
    const p = ctx.payload;
    const r = await this.pedir(
      'POST',
      '/v1/posts',
      ctx.credencial.token,
      ctx.credencial.ref.cuentaLogica,
      { content: p.content, title: p.title, requiereArchivoReal: p.requiereArchivoReal, assetsReales: p.assetsReales },
      ctx.idempotencyKey,
      signal,
    );
    if (r.redError) {
      return { resultado: 'desconocida', externalRef: null, estadoRemoto: null, error: errorPublicacion('red_timeout', 'timeout', 'la respuesta del proveedor se perdió', 'fetch abortado/red', ''), retryAfterMs: null };
    }
    const body = r.body as { externalId?: string; status?: string; error?: string };
    if (r.status === 429) {
      return { resultado: 'rate_limited', externalRef: null, estadoRemoto: null, error: errorPublicacion('rate_limited', 'rate_limit', 'el proveedor aplicó un límite de peticiones', String(body.error ?? ''), ''), retryAfterMs: r.retryAfterMs };
    }
    if (r.status === 504 || r.status === 408) {
      return { resultado: 'desconocida', externalRef: null, estadoRemoto: null, error: errorPublicacion('gateway_timeout', 'timeout', 'la respuesta del proveedor se perdió tras el envío', String(body.error ?? ''), ''), retryAfterMs: null };
    }
    if (r.status === 200 && body.externalId) {
      // Duplicado idempotente: el proveedor devuelve la misma publicación.
      return { resultado: body.status === 'published' ? 'publicada' : 'aceptada', externalRef: body.externalId, estadoRemoto: body.status ?? null, error: null, retryAfterMs: null };
    }
    if (r.status === 201 && body.externalId) {
      return { resultado: body.status === 'published' ? 'publicada' : 'aceptada', externalRef: body.externalId, estadoRemoto: body.status ?? null, error: null, retryAfterMs: null };
    }
    const categoria = categoriaDesdeHttp(r.status);
    return { resultado: 'fallida', externalRef: null, estadoRemoto: null, error: errorPublicacion(`http_${r.status}`, categoria, 'el proveedor rechazó el envío', String(body.error ?? ''), `status ${r.status}`), retryAfterMs: null };
  }

  async verificar(externalRef: string, credencial: CredencialResuelta): Promise<EstadoRemoto> {
    const r = await this.pedir('GET', `/v1/posts/${encodeURIComponent(externalRef)}`, credencial.token, credencial.ref.cuentaLogica);
    if (r.status === 200) {
      const b = r.body as { externalId: string; status: string; publishedAt: string | null };
      return { existe: true, status: b.status, externalRef: b.externalId, publishedAt: b.publishedAt };
    }
    return { existe: false, status: r.status === 404 ? 'not_found' : 'desconocido', externalRef, publishedAt: null };
  }

  async buscarPorIdempotencia(idempotencyKey: string, credencial: CredencialResuelta): Promise<EstadoRemoto | null> {
    const r = await this.pedir('GET', `/v1/posts?idempotencyKey=${encodeURIComponent(idempotencyKey)}`, credencial.token, credencial.ref.cuentaLogica);
    if (r.status !== 200) return null;
    const b = r.body as { encontrado: boolean; post: { externalId: string; status: string; publishedAt: string | null } | null };
    if (!b.encontrado || !b.post) return { existe: false, status: 'not_found', externalRef: '', publishedAt: null };
    return { existe: true, status: b.post.status, externalRef: b.post.externalId, publishedAt: b.post.publishedAt };
  }

  async retirar(externalRef: string, credencial: CredencialResuelta): Promise<{ ok: boolean; status: string }> {
    const r = await this.pedir('DELETE', `/v1/posts/${encodeURIComponent(externalRef)}`, credencial.token, credencial.ref.cuentaLogica);
    if (r.status === 200) return { ok: true, status: 'deleted' };
    return { ok: false, status: r.status === 404 ? 'not_found' : 'error' };
  }
}
