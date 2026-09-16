import { cabecerasDe, proxiar } from '../../../../lib/proxy-medicion';

/**
 * GET /api/medicion/decisiones → API /medicion/decisiones (bucle de decisión, sólo lectura).
 * Ruta estática propia: el segmento `[accion]` de `/api/medicion` no la cubría y la pantalla Decisiones
 * recibía 404 del proxy aunque la API sí la sirve. Misma cookie, misma organización, mismo manejo de error.
 */
export async function GET(req: Request): Promise<Response> {
  return proxiar('decisiones', 'GET', cabecerasDe(req), undefined, new URL(req.url).search);
}
