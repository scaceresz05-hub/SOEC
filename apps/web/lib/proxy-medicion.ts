import { API_BASE } from './config';

/**
 * Proxy BFF común de `/api/medicion/*` hacia la API. Vive aquí, y no dentro de un `route.ts`, porque
 * más de un handler lo necesita (`[accion]` y `decisiones`) y un archivo de ruta de Next sólo puede
 * exportar sus handlers. Mismo comportamiento que tenía `[accion]/route.ts`: nada cambia para las
 * rutas que ya funcionaban.
 */

/**
 * Reenvía la ORGANIZACIÓN que declara el navegador. El proxy NO inventa una organización por
 * defecto: si el cliente no la envía, la API responde con un rechazo explícito en vez de devolver
 * los datos de otra empresa.
 */
export function cabecerasDe(req: Request): Record<string, string> {
  // Reenviar la COOKIE de sesión: el gateway autenticado la exige (si no, 401). La cabecera de organización
  // no autoriza por sí sola; el gateway la valida contra la membresía de la sesión y inyecta el scope real.
  const h: Record<string, string> = { 'content-type': 'application/json', cookie: req.headers.get('cookie') ?? '' };
  const slug = req.headers.get('x-organization-slug') ?? req.headers.get('x-organization-id');
  if (slug) h['x-organization-slug'] = slug;
  return h;
}

export async function proxiar(
  path: string,
  method: 'GET' | 'POST',
  headers: Record<string, string>,
  body?: unknown,
  search = '',
): Promise<Response> {
  try {
    // Se PRESERVA el query string (p.ej. ?detail=intents): sin esto la API recibe la ruta sin parámetros y
    // la rama de detalle nunca se ejecuta (bug productivo de Fase 2A inspeccionable).
    const res = await fetch(`${API_BASE}/medicion/${path}${search}`, {
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
