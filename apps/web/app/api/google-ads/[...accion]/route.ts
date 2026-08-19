import { API_BASE } from '../../../../lib/config';

/**
 * Proxy web→api del provider Google Ads (READ ONLY). Reenvía la organización que declara el navegador
 * (mismo modelo que /api/medicion): el proxy NO inventa una organización por defecto. En producción el
 * gateway autenticado sobreescribe las cabeceras con valores autoritativos server-side; aquí sólo se
 * suministran para el camino de desarrollo. Nunca se exponen tokens: sólo se reenvía JSON sanitizado.
 */

const GET_PATHS = new Set(['connection']);
const POST_PATHS = new Set(['oauth/start', 'accounts', 'select-account', 'refresh', 'disconnect']);

function cabecerasDe(req: Request): Record<string, string> {
  const h: Record<string, string> = { 'content-type': 'application/json' };
  const slug = req.headers.get('x-organization-slug') ?? req.headers.get('x-organization-id');
  if (slug) {
    h['x-organization-slug'] = slug;
    h['x-organization-id'] = slug;
    h['x-actor-id'] = req.headers.get('x-actor-id') ?? 'panel-web';
    h['x-scope'] = 'events:read,events:append';
    // Permisos de gestión del negocio (conectar/seleccionar/desconectar). En prod el gateway los
    // sobreescribe con los del rol autenticado; aquí es el valor de desarrollo.
    h['x-permissions'] = req.headers.get('x-permissions') ?? 'business.manage';
  }
  return h;
}

async function proxiar(path: string, method: 'GET' | 'POST', headers: Record<string, string>, body?: unknown): Promise<Response> {
  try {
    const res = await fetch(`${API_BASE}/acquisition/google-ads/${path}`, {
      method,
      headers,
      cache: 'no-store',
      ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}),
    });
    return Response.json(await res.json(), { status: res.status });
  } catch {
    return Response.json({ error: 'ApiUnreachable', mensaje: 'No se pudo contactar el servicio.' }, { status: 502 });
  }
}

export async function GET(req: Request, ctx: { params: Promise<{ accion: string[] }> }): Promise<Response> {
  const path = (await ctx.params).accion.join('/');
  if (!GET_PATHS.has(path)) return Response.json({ error: 'NotFound' }, { status: 404 });
  return proxiar(path, 'GET', cabecerasDe(req));
}

export async function POST(req: Request, ctx: { params: Promise<{ accion: string[] }> }): Promise<Response> {
  const path = (await ctx.params).accion.join('/');
  if (!POST_PATHS.has(path)) return Response.json({ error: 'NotFound' }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  return proxiar(path, 'POST', cabecerasDe(req), body);
}
