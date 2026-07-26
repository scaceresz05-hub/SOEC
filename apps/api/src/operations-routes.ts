/**
 * Rutas técnicas mínimas de las operaciones intelectuales (§22).
 * No es API comercial, no hay UI, no hay endpoints para EJECUTAR orientaciones,
 * y no hay endpoints de capacidades. Solo solicitar operaciones y consultar sus
 * productos no vinculantes.
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
import { EceQueryService } from '@soec/ece';
import {
  MecanismoDeterministico,
  MecanismoSimuladoIA,
  OperacionesQueryService,
  OperacionesService,
  type TipoOperacion,
} from '@soec/operaciones';

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

export function registerOperationsRoutes(app: FastifyInstance, store: EventStore): void {
  const med = new MedService(store);
  const mdm = new MdmService(store);
  const ece = new EceQueryService(store, med, mdm);
  const service = new OperacionesService(store, ece, [
    new MecanismoDeterministico(),
    new MecanismoSimuladoIA(),
  ]);
  const query = new OperacionesQueryService(store);
  const id = (req: FastifyRequest): string => (req.params as { id: string }).id;

  const solicitar =
    (operacion: TipoOperacion) =>
    async (req: FastifyRequest, reply: import('fastify').FastifyReply) => {
      const r = await service.ejecutar(contextFrom(req), id(req), {
        operacion,
        ...(req.body as object),
      } as never);
      // El producto se ofrece al juicio humano; nunca es una decisión ejecutada.
      return reply
        .code(201)
        .send({
          producto: r.producto,
          awaitingHumanJudgment: true,
          bindingDecision: r.producto.bindingDecision,
        });
    };

  app.post('/oi/:id/esclarecer', solicitar('esclarecer'));
  app.post('/oi/:id/detectar', solicitar('detectar'));
  app.post('/oi/:id/proyectar', solicitar('proyectar'));
  app.post('/oi/:id/orientar', solicitar('orientar'));

  app.get('/oi/:id', async (req, reply) =>
    reply.send({ ejecucion: await query.ejecucion(contextFrom(req), id(req)) }),
  );
  app.get('/oi/:id/producto', async (req, reply) =>
    reply.send({ producto: await query.producto(contextFrom(req), id(req)) }),
  );
  app.get('/oi/:id/historico', async (req, reply) => {
    const { asOf } = req.query as { asOf?: string };
    if (!asOf) return reply.code(400).send({ error: 'MissingAsOf' });
    return reply.send({ ejecucion: await query.ejecucionEnFecha(contextFrom(req), id(req), asOf) });
  });
}
