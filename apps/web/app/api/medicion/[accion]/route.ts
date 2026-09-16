import { cabecerasDe, proxiar } from '../../../../lib/proxy-medicion';

const GET_ACCIONES = new Set([
  'estado',
  'reales',
  'panel',
  'lectura-director',
  'plan-accion',
  'g2a-bandeja',
  'campaign-operator',
  'diagnosis-evidence',
  'envelope',
  'envelope-audit',
  'execution-plan',
  'canary-attempts',
  'canary-candidate',
  'candidate-final',
  'campaign-live',
  'director',
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
  'envelope',
  'envelope-approve',
  'envelope-revoke',
  'canary-execute',
  'canary-validate',
  'candidate-finalize',
  'canary-reconcile',
  'canary-provider-reconcile',
]);

export async function GET(
  req: Request,
  ctx: { params: Promise<{ accion: string }> },
): Promise<Response> {
  const { accion } = await ctx.params;
  if (!GET_ACCIONES.has(accion)) return Response.json({ error: 'NotFound' }, { status: 404 });
  return proxiar(accion, 'GET', cabecerasDe(req), undefined, new URL(req.url).search);
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
