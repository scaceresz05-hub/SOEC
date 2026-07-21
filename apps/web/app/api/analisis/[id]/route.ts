import { API_BASE } from '../../../../lib/config';

/** Proxy server-side: detalle de una ejecución (recupera el resultado persistido). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  try {
    const res = await fetch(`${API_BASE}/experiencia/comprender-estado/${encodeURIComponent(id)}`, { cache: 'no-store' });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: 'ApiUnreachable', mensaje: 'No se pudo contactar el servicio.' }, { status: 502 });
  }
}
