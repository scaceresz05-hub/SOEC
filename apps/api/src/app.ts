import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import {
  ActorId,
  type EventInput,
  type EventStore,
  type IntelligenceProvider,
  type IntelligenceRequest,
  OrganizationId,
  type RequestContext,
  AttributionRequiredError,
  ConcurrencyError,
  ScopeMismatchError,
  ScopeRequiredError,
} from '@soec/contracts';

export interface AppDeps {
  store: EventStore;
  intelligence: IntelligenceProvider;
}

function header(req: FastifyRequest, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

/** Todo acceso transporta organización, actor y alcance; rechazo por defecto. */
function contextFrom(req: FastifyRequest): RequestContext {
  const org = header(req, 'x-organization-id');
  const actor = header(req, 'x-actor-id');
  if (!org || !actor) {
    throw new ScopeRequiredError('Faltan encabezados de organización o actor');
  }
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

interface AppendBody {
  streamId: string;
  expectedVersion: number;
  events: EventInput[];
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ScopeRequiredError || err instanceof ScopeMismatchError) {
      return reply.code(403).send({ error: err.name, message: err.message });
    }
    if (err instanceof AttributionRequiredError) {
      return reply.code(422).send({ error: err.name, message: err.message });
    }
    if (err instanceof ConcurrencyError) {
      return reply.code(409).send({ error: err.name, message: err.message });
    }
    // Errores no clasificados → 500 sin filtrar secretos.
    return reply.code(500).send({ error: 'InternalError' });
  });

  app.get('/health', async () => ({ status: 'ok' }));

  app.post('/events', async (req, reply) => {
    const ctx = contextFrom(req);
    const body = req.body as AppendBody;
    const result = await deps.store.append(ctx, body.streamId, body.expectedVersion, body.events);
    return reply.code(201).send({ version: result.version, events: result.events });
  });

  app.get('/streams/:id', async (req, reply) => {
    const ctx = contextFrom(req);
    const { id } = req.params as { id: string };
    const events = await deps.store.readStream(ctx, id);
    return reply.send({ streamId: id, version: events.length, events });
  });

  app.get('/streams/:id/at', async (req, reply) => {
    const ctx = contextFrom(req);
    const { id } = req.params as { id: string };
    const { asOf } = req.query as { asOf?: string };
    if (!asOf) return reply.code(400).send({ error: 'MissingAsOf' });
    const events = await deps.store.reconstructAt(ctx, id, asOf);
    return reply.send({ streamId: id, asOf, events });
  });

  app.post('/intelligence', async (req, reply) => {
    const ctx = contextFrom(req);
    const request = req.body as IntelligenceRequest;
    const product = await deps.intelligence.operate(ctx, request);
    // Un producto se ofrece al juicio humano; nunca es una decisión ejecutada.
    return reply.send({ product, awaitingHumanJudgment: true });
  });

  return app;
}
