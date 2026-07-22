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
import {
  ComandoInvalidoError,
  ModelAlreadyExistsError,
  ModelNotFoundError,
  ModelSeparationError,
  ReferenteInexistenteError,
  TransicionInvalidaError,
} from '@soec/models';
import { ComandoEceInvalidoError, EceNotFoundError, ElementoInexistenteError } from '@soec/ece';
import {
  EjecucionNoEncontradaError,
  MecanismoNoDisponibleError,
  SolicitudInvalidaError,
} from '@soec/operaciones';
import {
  CicloDetectadoError,
  DefinicionInvalidaError,
  DefinicionNoEncontradaError,
  EjecucionCapacidadNoEncontradaError,
  OperacionDesconocidaError,
  VersionNoDisponibleError,
} from '@soec/capacidades';
import {
  AccionNoEncontradaError,
  AdaptadorNoDisponibleError,
  PoliticaNoEncontradaError,
  SinPoliticaVigenteError,
  SolicitudOperativaInvalidaError,
} from '@soec/operacional';
import {
  ActividadNoPreparableError,
  ComandoMarketingInvalidoError,
  ObjetivoNoEncontradoError,
  ObjetivoNoEvaluableError,
  PlanNoEncontradoError,
  SinAccionDisponibleError,
} from '@soec/marketing';
import {
  BriefNoEncontradoError,
  ComandoContenidoInvalidoError,
  MarcaNoEncontradaError,
  PaqueteNoEjecutableError,
  PaqueteNoEncontradoError,
} from '@soec/contenido';
import { registerModelRoutes } from './model-routes';
import { registerEceRoutes } from './ece-routes';
import { registerOperationsRoutes } from './operations-routes';
import { registerCapabilityRoutes } from './capabilities-routes';
import { registerExperienceRoutes } from './experience-routes';
import { registerOperationalRoutes } from './operational-routes';
import { registerMarketingRoutes } from './marketing-routes';
import { registerContentRoutes } from './content-routes';

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
    if (
      err instanceof ConcurrencyError ||
      err instanceof ModelAlreadyExistsError ||
      err instanceof ModelSeparationError ||
      err instanceof CicloDetectadoError
    ) {
      return reply.code(409).send({ error: err.name, message: err.message });
    }
    if (
      err instanceof ModelNotFoundError ||
      err instanceof EceNotFoundError ||
      err instanceof EjecucionNoEncontradaError ||
      err instanceof DefinicionNoEncontradaError ||
      err instanceof EjecucionCapacidadNoEncontradaError ||
      err instanceof AccionNoEncontradaError ||
      err instanceof PoliticaNoEncontradaError ||
      err instanceof ObjetivoNoEncontradoError ||
      err instanceof PlanNoEncontradoError ||
      err instanceof BriefNoEncontradoError ||
      err instanceof MarcaNoEncontradaError ||
      err instanceof PaqueteNoEncontradoError
    ) {
      return reply.code(404).send({ error: err.name, message: err.message });
    }
    if (
      err instanceof SinPoliticaVigenteError ||
      err instanceof SolicitudOperativaInvalidaError ||
      err instanceof AdaptadorNoDisponibleError ||
      err instanceof ObjetivoNoEvaluableError ||
      err instanceof SinAccionDisponibleError ||
      err instanceof ComandoMarketingInvalidoError ||
      err instanceof ActividadNoPreparableError ||
      err instanceof ComandoContenidoInvalidoError ||
      err instanceof PaqueteNoEjecutableError
    ) {
      return reply.code(422).send({ error: err.name, message: err.message });
    }
    if (
      err instanceof ReferenteInexistenteError ||
      err instanceof TransicionInvalidaError ||
      err instanceof ComandoInvalidoError ||
      err instanceof ElementoInexistenteError ||
      err instanceof ComandoEceInvalidoError ||
      err instanceof SolicitudInvalidaError ||
      err instanceof MecanismoNoDisponibleError ||
      err instanceof DefinicionInvalidaError ||
      err instanceof OperacionDesconocidaError ||
      err instanceof VersionNoDisponibleError
    ) {
      return reply.code(422).send({ error: err.name, message: err.message });
    }
    // Errores no clasificados → 500 sin filtrar secretos.
    return reply.code(500).send({ error: 'InternalError' });
  });

  app.get('/health', async () => ({ status: 'ok' }));

  // Verticales de dominio MED y MDM (§12) y Estado Cognitivo Empresarial.
  registerModelRoutes(app, deps.store);
  registerEceRoutes(app, deps.store);
  registerOperationsRoutes(app, deps.store);
  registerCapabilityRoutes(app, deps.store);
  registerExperienceRoutes(app, deps.store);
  registerOperationalRoutes(app, deps.store);
  registerMarketingRoutes(app, deps.store);
  registerContentRoutes(app, deps.store);

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
