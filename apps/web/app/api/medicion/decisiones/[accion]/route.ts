import { cabecerasDe, proxiar } from '../../../../../lib/proxy-medicion';

/** Acciones que la API expone bajo /medicion/decisiones/<accion>. Sólo POST; nada más pasa. */
const POST_ACCIONES = new Set(['aprobar', 'rechazar', 'ajustar']);

export async function POST(req: Request, ctx: { params: Promise<{ accion: string }> }): Promise<Response> {
  const { accion } = await ctx.params;
  if (!POST_ACCIONES.has(accion)) return Response.json({ error: 'NotFound' }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  return proxiar(`decisiones/${accion}`, 'POST', cabecerasDe(req), body);
}
