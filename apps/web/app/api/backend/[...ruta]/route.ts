import { API_BASE } from '../../../../lib/config';

/**
 * Proxy autenticado hacia la API: /api/backend/<ruta...> → {API_BASE}/<ruta...>.
 * Reenvía la cookie de sesión del navegador a la API y devuelve el Set-Cookie de la API al
 * navegador (login/logout). La sesión viaja en cookie httpOnly, nunca en el cuerpo ni en la URL.
 */
async function proxy(req: Request, ruta: string[], method: 'GET' | 'POST' | 'PATCH' | 'DELETE'): Promise<Response> {
  const cookie = req.headers.get('cookie') ?? '';
  const search = new URL(req.url).search;
  const url = `${API_BASE}/${ruta.map(encodeURIComponent).join('/')}${search}`;
  const init: RequestInit = { method, headers: { 'content-type': 'application/json', cookie }, cache: 'no-store' };
  if (method === 'POST' || method === 'PATCH') init.body = await req.text();
  try {
    const res = await fetch(url, init);
    const data = await res.text();
    const out = new Response(data, { status: res.status, headers: { 'content-type': 'application/json' } });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) out.headers.set('set-cookie', setCookie);
    return out;
  } catch {
    return Response.json({ error: 'ApiUnreachable', message: 'No se pudo contactar el servicio.' }, { status: 502 });
  }
}

export async function GET(req: Request, ctx: { params: Promise<{ ruta: string[] }> }): Promise<Response> {
  return proxy(req, (await ctx.params).ruta ?? [], 'GET');
}
export async function POST(req: Request, ctx: { params: Promise<{ ruta: string[] }> }): Promise<Response> {
  return proxy(req, (await ctx.params).ruta ?? [], 'POST');
}
export async function PATCH(req: Request, ctx: { params: Promise<{ ruta: string[] }> }): Promise<Response> {
  return proxy(req, (await ctx.params).ruta ?? [], 'PATCH');
}
export async function DELETE(req: Request, ctx: { params: Promise<{ ruta: string[] }> }): Promise<Response> {
  return proxy(req, (await ctx.params).ruta ?? [], 'DELETE');
}
