import { API_BASE } from '../../../../lib/config';

/**
 * Proxy catch-all hacia la configuración de programas del runtime:
 *   /api/programas/<ruta...>  →  {API_BASE}/experience/director-autonomo/organizaciones/<ruta...>
 * Sin credenciales: el contexto es sintético server-side.
 */
function destino(ruta: string[], search: string): string {
  return `${API_BASE}/experience/director-autonomo/organizaciones/${ruta.map(encodeURIComponent).join('/')}${search}`;
}

export async function GET(req: Request, ctx: { params: Promise<{ ruta: string[] }> }): Promise<Response> {
  const { ruta } = await ctx.params;
  const search = new URL(req.url).search;
  try {
    const res = await fetch(destino(ruta ?? [], search), { cache: 'no-store' });
    return Response.json(await res.json(), { status: res.status });
  } catch {
    return Response.json({ error: 'ApiUnreachable', mensaje: 'No se pudo contactar el servicio.' }, { status: 502 });
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ ruta: string[] }> }): Promise<Response> {
  const { ruta } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  try {
    const res = await fetch(destino(ruta ?? [], ''), { method: 'POST', headers: { 'content-type': 'application/json' }, cache: 'no-store', body: JSON.stringify(body ?? {}) });
    return Response.json(await res.json(), { status: res.status });
  } catch {
    return Response.json({ error: 'ApiUnreachable', mensaje: 'No se pudo contactar el servicio.' }, { status: 502 });
  }
}
