import { API_BASE } from '../../../../lib/config';

const GET_ACCIONES = new Set([
  'estado',
  'reales',
  'panel',
  'lectura-director',
  'plan-accion',
  'g2a-bandeja',
  'campaign-operator',
  'diagnosis-evidence',
]);
const POST_ACCIONES = new Set([
  'preparar',
  'sincronizar',
  'optimizar',
  'g2a-aprobar',
  'g2a-rechazar',
  'refresh-ads',
  'campaign-operator-plan',
  'diagnosis-evidence',
]);

/**
 * Reenvía la ORGANIZACIÓN que declara el navegador. El proxy NO inventa una organización por
 * defecto: si el cliente no la envía, la API responde con un rechazo explícito en vez de devolver
 * los datos de otra empresa.
 */
function cabecerasDe(req: Request): Record<string, string> {
  // Reenviar la COOKIE de sesión: el gateway autenticado la exige (si no, 401). La cabecera de organización
  // no autoriza por sí sola; el gateway la valida contra la membresía de la sesión y inyecta el scope real.
  const h: Record<string, string> = { 'content-type': 'application/json', cookie: req.headers.get('cookie') ?? '' };
  const slug = req.headers.get('x-organization-slug') ?? req.headers.get('x-organization-id');
  if (slug) h['x-organization-slug'] = slug;
  return h;
}

async function proxiar(
  path: string,
  method: 'GET' | 'POST',
  headers: Record<string, string>,
  body?: unknown,
): Promise<Response> {
  try {
    const res = await fetch(`${API_BASE}/medicion/${path}`, {
      method,
      headers,
      cache: 'no-store',
      ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}),
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
  const body = await req.json().catch(() => ({}));
  return proxiar(accion, 'POST', cabecerasDe(req), body);
}
