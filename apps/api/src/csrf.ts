/**
 * Protección CSRF del lado servidor (F-01). Defensa en profundidad además de `SameSite=Lax`.
 *
 * Para métodos MUTATIVOS (POST/PUT/PATCH/DELETE) valida el `Origin` (y, en su defecto, el `Referer`)
 * contra una allowlist EXPLÍCITA provista por configuración. Reglas:
 *   - Origin/Referer presente y en la allowlist → continúa.
 *   - Origin/Referer presente y ajeno            → 403.
 *   - Origin y Referer AUSENTES                  → continúa (cliente no-navegador: server-to-server,
 *     curl, tests). Los navegadores SIEMPRE envían `Origin` en peticiones mutativas cross-site, por
 *     lo que su ausencia no es un vector CSRF.
 *
 * No se confía en `Host` ni en `X-Forwarded-Host`; el origen permitido JAMÁS se deriva del request.
 * No se usan comodines. El hook es GLOBAL (cubre /auth, /organizations y la superficie /experience
 * del gateway). Los métodos seguros (GET/HEAD/OPTIONS) no se filtran por CSRF.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';

const METODOS_MUTATIVOS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function encabezado(req: FastifyRequest, nombre: string): string | undefined {
  const v = req.headers[nombre];
  return Array.isArray(v) ? v[0] : v;
}

/** Normaliza un origen a `esquema://host[:puerto]` sin barra final, o null si es inválido. */
function normalizarOrigen(valor: string): string | null {
  try {
    return new URL(valor).origin;
  } catch {
    return null;
  }
}

export function registrarProteccionCsrf(app: FastifyInstance, origenesPermitidos: readonly string[]): void {
  const permitidos = new Set(
    origenesPermitidos.map((o) => normalizarOrigen(o.trim())).filter((o): o is string => !!o),
  );

  app.addHook('onRequest', async (req, reply) => {
    if (!METODOS_MUTATIVOS.has(req.method)) return;

    const origin = encabezado(req, 'origin');
    const referer = encabezado(req, 'referer');
    // Origen candidato: Origin directo o el origen del Referer. Sin ninguno ⇒ cliente no-navegador.
    let candidato: string | null = null;
    if (origin) candidato = normalizarOrigen(origin) ?? 'invalido';
    else if (referer) candidato = normalizarOrigen(referer) ?? 'invalido';
    if (candidato === null) return; // ni Origin ni Referer: no es un navegador → no hay vector CSRF

    if (!permitidos.has(candidato)) {
      return reply.code(403).send({ error: 'ORIGEN_NO_PERMITIDO', message: 'origen no permitido para una operación mutativa' });
    }
  });
}
