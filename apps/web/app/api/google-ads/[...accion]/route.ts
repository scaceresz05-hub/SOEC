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
  // Reenviar la COOKIE de sesión: el gateway autenticado la exige (si no, 401 NO_AUTENTICADO → la UI de
  // conexión queda en "cargando…"). La cabecera de organización no autoriza por sí sola; el gateway la
  // valida contra la membresía de la sesión e inyecta permisos/scope reales. Mismo patrón que /api/backend.
  const h: Record<string, string> = { 'content-type': 'application/json', cookie: req.headers.get('cookie') ?? '' };
  const slug = req.headers.get('x-organization-slug') ?? req.headers.get('x-organization-id');
  if (slug) h['x-organization-slug'] = slug;
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
