import { API_BASE } from '../../../../../lib/config';

const GET_ACCIONES = new Set(['estado']);
const POST_ACCIONES = new Set(['preparar', 'activar']);

/** Reenvía la organización declarada por el navegador. Sin organización no hay expediente: hay rechazo. */
function cabecerasDe(req: Request): Record<string, string> {
  const h: Record<string, string> = { 'content-type': 'application/json' };
  const slug = req.headers.get('x-organization-slug') ?? req.headers.get('x-organization-id');
  if (slug) {
    h['x-organization-slug'] = slug;
    h['x-organization-id'] = slug;
    h['x-actor-id'] = req.headers.get('x-actor-id') ?? 'panel-web';
    h['x-scope'] = 'events:read,events:append';
  }
  return h;
}

async function proxiar(
  accion: string,
  method: 'GET' | 'POST',
  headers: Record<string, string>,
): Promise<Response> {
  try {
    const res = await fetch(`${API_BASE}/piloto/decision/${accion}`, {
      method,
      headers,
      cache: 'no-store',
      ...(method === 'POST' ? { body: '{}' } : {}),
    });
    return Response.json(await res.json(), { status: res.status });
  } catch {
    return Response.json(
      { error: 'ApiUnreachable', mensaje: 'No se pudo contactar el servicio.' },
      { status: 502 },
    );
  }
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ accion: string }> },
): Promise<Response> {
  const { accion } = await ctx.params;
  if (!GET_ACCIONES.has(accion)) return Response.json({ error: 'NotFound' }, { status: 404 });
  return proxiar(accion, 'GET', cabecerasDe(req));
}
export async function POST(
  req: Request,
  ctx: { params: Promise<{ accion: string }> },
): Promise<Response> {
  const { accion } = await ctx.params;
  if (!POST_ACCIONES.has(accion)) return Response.json({ error: 'NotFound' }, { status: 404 });
  return proxiar(accion, 'POST', cabecerasDe(req));
}
