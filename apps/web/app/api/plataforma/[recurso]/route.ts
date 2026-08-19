import { API_BASE } from '../../../../lib/config';

const GET_RECURSOS = new Set([
  'negocio',
  'negocios',
  'catalogo',
  'fundamentos',
  'ventas',
  'credenciales',
]);

/** Reenvía la organización declarada por el navegador. Sin organización no hay negocio: hay rechazo. */
function cabecerasDe(req: Request): Record<string, string> {
  // Reenviar la COOKIE de sesión es imprescindible: el gateway autenticado exige la sesión (si no, 401
  // NO_AUTENTICADO). La cabecera de organización por sí sola no autoriza; el gateway la valida contra la
  // membresía de la sesión. Sin la cookie, /plataforma devolvía 401 y el panel quedaba con negocio=null.
  const h: Record<string, string> = { 'content-type': 'application/json', cookie: req.headers.get('cookie') ?? '' };
  const slug = req.headers.get('x-organization-slug') ?? req.headers.get('x-organization-id');
  if (slug) h['x-organization-slug'] = slug;
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
