/**
 * apps/api · ATRIBUCIÓN FIRST-PARTY · superficie HTTP.
 *
 * Dos verbos y ninguno toca Google más que para PREGUNTAR:
 *
 *  · `POST /atribucion/intencion` — registra una intención de contacto y resuelve de qué clic de anuncio
 *    venía. Idempotente por `(organización, ref)`. Lo llamará el puente de CP cuando el sitio empiece a
 *    enviar el identificador de clic; hasta entonces sirve para comprobarlo a mano con un caso real.
 *  · `GET /atribucion` — el resumen del piloto: cuántas intenciones hay por estado y a qué campañas se
 *    atribuyeron. Es lo ÚNICO que se puede afirmar con esta medición.
 *
 * Lo que esta superficie NO hace, y conviene que se lea aquí: no envía nada a Google como conversión. Google
 * no se entera de estas intenciones y, por tanto, no puede optimizar por ellas.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import { contextoDe, permisosDe } from '../superficie-auth';
import { RepositorioAtribucion } from './atribucion-pg';
import type { AtribucionDeIntencion } from './atribucion-tipos';

export interface OpcionesAtribucionRoutes {
  /** Resolver inyectado desde la composición: la ruta no sabe nada de Google. */
  readonly atribuir?: (org: string, intencion: { ref: string; gclid: string | null; eventTimestamp: string }) => Promise<AtribucionDeIntencion>;
}

export function registerAtribucionRoutes(app: FastifyInstance, pool: Pool, opciones: OpcionesAtribucionRoutes = {}): void {
  const datos = (req: FastifyRequest): { org: string } => ({ org: String(contextoDe(req).organizationId) });
  const puedeGestionar = (req: FastifyRequest): boolean => permisosDe(req).has('business.manage');

  app.get('/atribucion', async (req, reply: FastifyReply) => {
    const { org } = datos(req);
    const repo = new RepositorioAtribucion(pool);
    const [resumen, pendientes] = await Promise.all([repo.resumen(org), repo.pendientes(org, 20)]);
    return reply.send({
      organizationId: org,
      modo: 'FIRST_PARTY_ATTRIBUTION',
      // Se repite en cada respuesta a propósito: es la frase que impide leer esto como otra cosa.
      advertencia: 'Google no recibe estas intenciones como conversión y no puede optimizar por ellas. Esta medición es interna de SOEC.',
      resumen,
      pendientes: pendientes.length,
    });
  });

  app.post('/atribucion/intencion', async (req, reply: FastifyReply) => {
    const { org } = datos(req);
    if (!puedeGestionar(req)) return reply.code(403).send({ error: 'NO_AUTORIZADO' });
    if (opciones.atribuir === undefined) {
      return reply.code(501).send({ error: 'SIN_ATRIBUCION', message: 'este despliegue no tiene configurada la atribución first-party' });
    }
    const b = (req.body ?? {}) as { ref?: string; gclid?: string | null; eventTimestamp?: string };
    const ref = String(b.ref ?? '').trim();
    if (ref === '' || ref.length > 64) return reply.code(400).send({ error: 'REF_INVALIDA' });
    const ts = String(b.eventTimestamp ?? '').trim();
    if (Number.isNaN(Date.parse(ts))) return reply.code(400).send({ error: 'MARCA_DE_TIEMPO_INVALIDA' });
    const r = await opciones.atribuir(org, { ref, gclid: b.gclid ?? null, eventTimestamp: new Date(ts).toISOString() });
    return reply.code(201).send({ organizationId: org, atribucion: r });
  });
}
