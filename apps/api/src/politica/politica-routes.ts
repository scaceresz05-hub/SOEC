/**
 * apps/api · POLÍTICA DE EVALUACIÓN COMO DATO · superficie HTTP.
 *
 * Dentro del gateway vertical: la organización del CONTEXTO es la autoridad (nunca la URL ni el cuerpo).
 * Leer exige contexto; editar exige además `business.manage`.
 *
 * `PATCH /politica` aplica un documento PARCIAL en una transacción y devuelve la vista completa con la
 * completitud recalculada: la interfaz sabe, en la misma respuesta, si el negocio ya es evaluable y qué falta.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { contextoDe, permisosDe } from '../superficie-auth';
import { PoliticaInvalidaError } from './politica-tipos';
import { NegocioSinPerfilError, PoliticaService, type DocumentoPolitica, type DepsPoliticaService } from './politica-service';

function manejarError(e: unknown, reply: FastifyReply): FastifyReply {
  if (e instanceof PoliticaInvalidaError) return reply.code(400).send({ error: 'ENTRADA_INVALIDA', message: e.message });
  if (e instanceof NegocioSinPerfilError) return reply.code(404).send({ error: 'NEGOCIO_NO_ENCONTRADO', message: e.message });
  throw e;
}

export function registerPoliticaRoutes(app: FastifyInstance, pool: Pool, deps: DepsPoliticaService = {}): void {
  const svc = new PoliticaService(pool, deps);

  const ctxDe = (req: FastifyRequest): { org: string; actor: string } => {
    const ctx = contextoDe(req);
    return { org: String(ctx.organizationId), actor: String(ctx.actor) };
  };

  // ── LEER: política + completitud + referencias canónicas (oferta, territorio, restricciones) ──
  app.get('/politica', async (req, reply) => {
    const { org } = ctxDe(req);
    try {
      return reply.send(await svc.leer(org));
    } catch (e) {
      return manejarError(e, reply);
    }
  });

  // ── COMPLETITUD sola: respuesta pequeña para paneles y comprobaciones ──
  app.get('/politica/completitud', async (req, reply) => {
    const { org } = ctxDe(req);
    try {
      return reply.send(await svc.completitud(org));
    } catch (e) {
      return manejarError(e, reply);
    }
  });

  // ── EDITAR: documento parcial, una transacción, auditoría y refresco del runtime ──
  app.patch('/politica', async (req, reply) => {
    const { org, actor } = ctxDe(req);
    if (!permisosDe(req).has('business.manage')) return reply.code(403).send({ error: 'NO_AUTORIZADO' });
    try {
      return reply.send(await svc.guardar(org, actor, (req.body ?? {}) as DocumentoPolitica));
    } catch (e) {
      return manejarError(e, reply);
    }
  });
}
