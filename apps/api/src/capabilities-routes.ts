/**
 * Rutas técnicas mínimas del Sistema de Capacidades (§21).
 * No es interfaz comercial, no hay editor visual, no hay endpoints de efectos
 * externos ni para aprobar/ejecutar el producto de capacidad.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { ActorId, type EventStore, OrganizationId, type RequestContext, ScopeRequiredError } from '@soec/contracts';
import { MedService, MdmService } from '@soec/models';
import { EceQueryService } from '@soec/ece';
import { MecanismoDeterministico, MecanismoSimuladoIA, OperacionesService } from '@soec/operaciones';
import { CapabilitiesOrchestrator, CapabilityQueryService, CapabilityRegistry } from '@soec/capacidades';

function header(req: FastifyRequest, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}
function contextFrom(req: FastifyRequest): RequestContext {
  const org = header(req, 'x-organization-id');
  const actor = header(req, 'x-actor-id');
  if (!org || !actor) throw new ScopeRequiredError('Faltan encabezados de organización o actor');
  const organizationId = OrganizationId(org);
  const permissions = (header(req, 'x-scope') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return { organizationId, actor: ActorId(actor), scope: { organizationId, permissions }, correlationId: header(req, 'x-correlation-id') ?? randomUUID() };
}

export function registerCapabilityRoutes(app: FastifyInstance, store: EventStore): void {
  const med = new MedService(store);
  const mdm = new MdmService(store);
  const ece = new EceQueryService(store, med, mdm);
  const operaciones = new OperacionesService(store, ece, [new MecanismoDeterministico(), new MecanismoSimuladoIA()]);
  const registry = new CapabilityRegistry(store);
  const orchestrator = new CapabilitiesOrchestrator(store, registry, operaciones);
  const query = new CapabilityQueryService(store);
  const id = (req: FastifyRequest): string => (req.params as { id: string }).id;
  const exec = (req: FastifyRequest): string => (req.params as { execId: string }).execId;

  app.post('/cap/:id/definiciones', async (req, reply) => {
    const r = await registry.registrarVersion(contextFrom(req), id(req), req.body as never);
    return reply.code(201).send({ version: r.version });
  });
  app.post('/cap/:id/publicar', async (req, reply) => {
    const { version } = req.body as { version: number };
    await registry.publicar(contextFrom(req), id(req), version);
    return reply.code(201).send({ ok: true });
  });
  app.get('/cap/:id', async (req, reply) => reply.send({ definicion: await query.definicion(contextFrom(req), id(req)) }));

  app.post('/cap/:id/ejecutar/:execId', async (req, reply) => {
    const r = await orchestrator.ejecutar(contextFrom(req), exec(req), { capabilityId: id(req), ...(req.body as object) } as never);
    return reply.code(201).send({ producto: r.producto, awaitingHumanJudgment: true, bindingDecision: r.producto.bindingDecision });
  });

  app.get('/cap-exec/:execId', async (req, reply) => reply.send({ ejecucion: await query.ejecucion(contextFrom(req), exec(req)) }));
  app.get('/cap-exec/:execId/producto', async (req, reply) => reply.send({ producto: await query.producto(contextFrom(req), exec(req)) }));
  app.get('/cap-exec/:execId/historico', async (req, reply) => {
    const { asOf } = req.query as { asOf?: string };
    if (!asOf) return reply.code(400).send({ error: 'MissingAsOf' });
    return reply.send({ ejecucion: await query.ejecucionEnFecha(contextFrom(req), exec(req), asOf) });
  });
}
