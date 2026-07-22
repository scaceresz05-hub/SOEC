import { API_BASE } from '../../../../../lib/config';

/** Prepara el contenido de una actividad concreta (por id) — endpoint de orquestación seguro. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  try {
    const res = await fetch(`${API_BASE}/contenido/actividades/${encodeURIComponent(id)}/preparar-contenido`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      cache: 'no-store',
      body: '{}',
    });
    return Response.json(await res.json(), { status: res.status });
  } catch {
    return Response.json({ error: 'ApiUnreachable', mensaje: 'No se pudo contactar el servicio.' }, { status: 502 });
  }
}
