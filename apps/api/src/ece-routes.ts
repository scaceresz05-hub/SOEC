/**
 * Rutas técnicas mínimas del ECE (§18). No es una API pública ni una interfaz
 * comercial, y NO expone operaciones intelectuales (explicar/orientar/predecir/
 * recomendar quedan fuera de alcance). Solo construye y consulta representación.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import {
  ActorId,
  type EventStore,
  OrganizationId,
  type RequestContext,
  ScopeRequiredError,
} from '@soec/contracts';
import { MedService, MdmService } from '@soec/models';
import { EceBuildService, EceQueryService } from '@soec/ece';

function header(req: FastifyRequest, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

function contextFrom(req: FastifyRequest): RequestContext {
  const org = header(req, 'x-organization-id');
  const actor = header(req, 'x-actor-id');
  if (!org || !actor) throw new ScopeRequiredError('Faltan encabezados de organización o actor');
  const organizationId = OrganizationId(org);
  const permissions = (header(req, 'x-scope') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    organizationId,
    actor: ActorId(actor),
    scope: { organizationId, permissions },
    correlationId: header(req, 'x-correlation-id') ?? randomUUID(),
  };
}

export function registerEceRoutes(app: FastifyInstance, store: EventStore): void {
  const med = new MedService(store);
  const mdm = new MdmService(store);
  const build = new EceBuildService(store, med, mdm);
  const query = new EceQueryService(store, med, mdm);
  const id = (req: FastifyRequest): string => (req.params as { id: string }).id;

  app.post('/ece/:id/construir', async (req, reply) => {
    const r = await build.construir(contextFrom(req), {
      eceId: id(req),
      ...(req.body as object),
    } as never);
    return reply.code(201).send({ version: r.version });
  });
  app.post('/ece/:id/elementos', async (req, reply) => {
    const r = await build.registrarElemento(contextFrom(req), {
      eceId: id(req),
      ...(req.body as object),
    } as never);
    return reply.code(201).send({ version: r.version });
  });
  app.post('/ece/:id/revision', async (req, reply) => {
    const r = await build.revisarElemento(contextFrom(req), {
      eceId: id(req),
      ...(req.body as object),
    } as never);
    return reply.code(201).send({ version: r.version });
  });
  app.post('/ece/:id/invalidar', async (req, reply) => {
    const r = await build.invalidar(contextFrom(req), {
      eceId: id(req),
      ...(req.body as object),
    } as never);
    return reply.code(201).send({ version: r.version });
  });

  app.get('/ece/:id', async (req, reply) => {
    return reply.send({ estado: await query.estadoActual(contextFrom(req), id(req)) });
  });
  app.get('/ece/:id/historico', async (req, reply) => {
    const { asOf } = req.query as { asOf?: string };
    if (!asOf) return reply.code(400).send({ error: 'MissingAsOf' });
    return reply.send({ estado: await query.estadoEnFecha(contextFrom(req), id(req), asOf) });
  });
  app.get('/ece/:id/coherencias', async (req, reply) => {
    return reply.send({ elementos: await query.coherencias(contextFrom(req), id(req)) });
  });
  app.get('/ece/:id/contradicciones', async (req, reply) => {
    return reply.send({ elementos: await query.contradicciones(contextFrom(req), id(req)) });
  });
  app.get('/ece/:id/ausencias', async (req, reply) => {
    return reply.send({ elementos: await query.ausencias(contextFrom(req), id(req)) });
  });
  app.get('/ece/:id/dependencias', async (req, reply) => {
    return reply.send({ elementos: await query.dependencias(contextFrom(req), id(req)) });
  });
  app.get('/ece/:id/brechas', async (req, reply) => {
    return reply.send({ elementos: await query.brechas(contextFrom(req), id(req)) });
  });
  app.get('/ece/:id/no-evaluables', async (req, reply) => {
    return reply.send({ elementos: await query.noEvaluables(contextFrom(req), id(req)) });
  });
  app.get('/ece/:id/procedencia', async (req, reply) => {
    return reply.send({ procedencia: await query.procedencia(contextFrom(req), id(req)) });
  });
  app.get('/ece/:id/vigencia', async (req, reply) => {
    return reply.send({ vigencia: await query.vigencia(contextFrom(req), id(req)) });
  });
}
