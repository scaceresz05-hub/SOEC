import { API_BASE } from '../../../../lib/config';

const GET_RECURSOS = new Set(['negocio', 'negocios', 'catalogo', 'fundamentos']);

/** Reenvía la organización declarada por el navegador. Sin organización no hay negocio: hay rechazo. */
function cabecerasDe(req: Request): Record<string, string> {
  const h: Record<string, string> = { 'content-type': 'application/json' };
  const slug = req.headers.get('x-organization-slug') ?? req.headers.get('x-organization-id');
  if (slug) {
    h['x-organization-slug'] = slug;
    h['x-organization-id'] = slug;
    h['x-actor-id'] = req.headers.get('x-actor-id') ?? 'panel-web';
    h['x-scope'] = 'events:read';
  }
  return h;
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ recurso: string }> },
): Promise<Response> {
  const { recurso } = await ctx.params;
  if (!GET_RECURSOS.has(recurso)) return Response.json({ error: 'NotFound' }, { status: 404 });
  try {
    const res = await fetch(`${API_BASE}/plataforma/${recurso}`, {
      method: 'GET',
      headers: cabecerasDe(req),
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
