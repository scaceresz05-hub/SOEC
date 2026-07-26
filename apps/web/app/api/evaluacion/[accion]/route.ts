import { API_BASE } from '../../../../lib/config';

const GET_ACCIONES = new Set(['estado', 'lista']);
const POST_ACCIONES = new Set(['iniciar', 'responder', 'generar', 'cerrar']);

export async function GET(
  req: Request,
  ctx: { params: Promise<{ accion: string }> },
): Promise<Response> {
  const { accion } = await ctx.params;
  if (!GET_ACCIONES.has(accion)) return Response.json({ error: 'NotFound' }, { status: 404 });
  const qs = new URL(req.url).search;
  try {
    const res = await fetch(`${API_BASE}/experience/evaluacion/${accion}${qs}`, {
      cache: 'no-store',
    });
    return Response.json(await res.json(), { status: res.status });
  } catch {
    return Response.json(
      { error: 'ApiUnreachable', mensaje: 'No se pudo contactar el servicio.' },
      { status: 502 },
    );
  }
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ accion: string }> },
): Promise<Response> {
  const { accion } = await ctx.params;
  if (!POST_ACCIONES.has(accion)) return Response.json({ error: 'NotFound' }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  try {
    const res = await fetch(`${API_BASE}/experience/evaluacion/${accion}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify(body ?? {}),
    });
    return Response.json(await res.json(), { status: res.status });
  } catch {
    return Response.json(
      { error: 'ApiUnreachable', mensaje: 'No se pudo contactar el servicio.' },
      { status: 502 },
    );
  }
}
