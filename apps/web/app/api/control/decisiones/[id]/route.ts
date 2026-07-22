import { API_BASE } from '../../../../../lib/config';

/** Resuelve una decisión pendiente (aprobar/denegar) por el propietario. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  try {
    const res = await fetch(`${API_BASE}/control/decisiones/${encodeURIComponent(id)}/resolver`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify(body),
    });
    return Response.json(await res.json(), { status: res.status });
  } catch {
    return Response.json({ error: 'ApiUnreachable', mensaje: 'No se pudo contactar el servicio.' }, { status: 502 });
  }
}
