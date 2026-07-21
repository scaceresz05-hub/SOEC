import { API_BASE } from '../../../../lib/config';

const GET_ACCIONES = new Set(['estado']);
const POST_ACCIONES = new Set(['preparar', 'ejecutar-siguiente', 'replanificar', 'pausar', 'reanudar']);

async function proxiar(accion: string, method: 'GET' | 'POST', body?: unknown): Promise<Response> {
  try {
    const res = await fetch(`${API_BASE}/marketing/${accion}`, {
      method,
      headers: { 'content-type': 'application/json' },
      cache: 'no-store',
      ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}),
    });
    return Response.json(await res.json(), { status: res.status });
  } catch {
    return Response.json({ error: 'ApiUnreachable', mensaje: 'No se pudo contactar el servicio.' }, { status: 502 });
  }
}

export async function GET(_req: Request, ctx: { params: Promise<{ accion: string }> }): Promise<Response> {
  const { accion } = await ctx.params;
  if (!GET_ACCIONES.has(accion)) return Response.json({ error: 'NotFound' }, { status: 404 });
  return proxiar(accion, 'GET');
}
export async function POST(req: Request, ctx: { params: Promise<{ accion: string }> }): Promise<Response> {
  const { accion } = await ctx.params;
  if (!POST_ACCIONES.has(accion)) return Response.json({ error: 'NotFound' }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  return proxiar(accion, 'POST', body);
}
