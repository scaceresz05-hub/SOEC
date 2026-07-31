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
import {
  AdaptadorCanalNoDisponibleError,
  ComandoCanalInvalidoError,
  ModoRealDesactivadoError,
  PublicacionNoEncontradaError,
  PublicacionNoOperableError,
  WebhookInvalidoError,
} from '@soec/canales';
import {
  ComandoMedicionInvalidoError,
  MedicionNoEncontradaError,
  OptimizacionNoEncontradaError,
  OptimizacionNoOperableError,
} from '@soec/medicion';
import {
  ComandoControlInvalidoError,
  DecisionNoEncontradaError,
  DecisionYaResueltaError,
  DepartamentoPausadoError,
  PermisoInsuficienteError,
} from '@soec/control';
import {
  ActivacionRealProhibidaError,
  ComandoPilotoInvalidoError,
  EntornoRealBloqueadoError,
  ExpedienteNoEncontradoError,
  OrganizacionNoEncontradaError,
} from '@soec/piloto';
import { registerModelRoutes } from './model-routes';
import { registerEceRoutes } from './ece-routes';
import { registerOperationsRoutes } from './operations-routes';
import { registerCapabilityRoutes } from './capabilities-routes';
import { registerExperienceRoutes } from './experience-routes';
import { registerOperationalRoutes } from './operational-routes';
import { registerMarketingRoutes } from './marketing-routes';
import { registerContentRoutes } from './content-routes';
import { registerChannelRoutes } from './channel-routes';
import { registerMeasurementRoutes } from './measurement-routes';
import { registerControlRoutes } from './control-routes';
import { registerPilotRoutes } from './pilot-routes';
import { registerDirectorWorkspaceRoutes } from './director-workspace-routes';
import { registerDirectorAutonomoRoutes } from './director-autonomo-routes';
import { registerDirectorAutonomoProgramasRoutes } from './director-autonomo-programas-routes';
import { registerEvaluacionRoutes } from './evaluacion-routes';
import {
  NegocioInvalidoError,
  ProgramaInvalidoError,
  ProgramaNoEjecutableError,
  SeparacionProgramaVioladaError,
} from '@soec/programas';
import {
  AutonomiaInvalidaError,
  AutonomiaNoAutoElevableError,
  ReanudacionSinActorHumanoError,
} from '@soec/autonomia';
import {
  DecisionMktInvalidaError,
  TransicionInvalidaError as TransicionDecMktInvalidaError,
  CampaniaInvalidaError,
  SeparacionCampaniaVioladaError,
  TransicionCampaniaInvalidaError,
  ContenidoGobernadoInvalidoError,
  SeparacionContenidoVioladaError,
  TransicionContenidoInvalidaError,
  EjecucionInvalidaError,
  SeparacionEjecucionVioladaError,
  AprendizajeInvalidoError,
  AplicacionSinDecisionHumanaError,
} from '@soec/piloto-director-v1';
import { MetricaCruzadaError } from '@soec/medicion';
import { PreguntaFueraDelRubroError } from './evaluacion-experience';
import { SeleccionInvalidaError } from './catalogo';
import { AutorizacionDenegadaError, DecisionInvalidaError } from '@soec/decision';
import { EvaluacionInvalidaError, EsquemaEvaluacionDesconocidoError } from '@soec/evaluacion';
import { type Clock, systemClock } from '@soec/event-store';

export interface AppDeps {
  store: EventStore;
  intelligence: IntelligenceProvider;
  /** Reloj inyectable: real en producción, fijo en tests (tiempos de ocurrencia reales). */
  clock?: Clock;
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
  const clock = deps.clock ?? systemClock;

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
      err instanceof PaqueteNoEncontradoError ||
      err instanceof PublicacionNoEncontradaError ||
      err instanceof MedicionNoEncontradaError ||
      err instanceof OptimizacionNoEncontradaError ||
      err instanceof DecisionNoEncontradaError ||
      err instanceof OrganizacionNoEncontradaError ||
      err instanceof ExpedienteNoEncontradoError
    ) {
      return reply.code(404).send({ error: err.name, message: err.message });
    }
    if (
      err instanceof PermisoInsuficienteError ||
      err instanceof AutorizacionDenegadaError ||
      err instanceof AutonomiaNoAutoElevableError
    ) {
      return reply.code(403).send({ error: err.name, message: err.message });
    }
    if (err instanceof AutonomiaInvalidaError || err instanceof ReanudacionSinActorHumanoError) {
      return reply.code(422).send({ error: err.name, message: err.message });
    }
    // Ciclo del Director Autónomo: separación de organización → 403; el resto (entrada/estado
    // inválidos, transición no permitida, cruce de aprendizaje sin decisión humana) → 422.
    if (
      err instanceof SeparacionCampaniaVioladaError ||
      err instanceof SeparacionContenidoVioladaError ||
      err instanceof SeparacionEjecucionVioladaError ||
      err instanceof SeparacionProgramaVioladaError
    ) {
      return reply.code(403).send({ error: err.name, message: err.message });
    }
    if (err instanceof NegocioInvalidoError || err instanceof ProgramaInvalidoError || err instanceof ProgramaNoEjecutableError) {
      return reply.code(422).send({ error: err.name, message: err.message });
    }
    if (
      err instanceof DecisionMktInvalidaError ||
      err instanceof TransicionDecMktInvalidaError ||
      err instanceof CampaniaInvalidaError ||
      err instanceof TransicionCampaniaInvalidaError ||
      err instanceof ContenidoGobernadoInvalidoError ||
      err instanceof TransicionContenidoInvalidaError ||
      err instanceof EjecucionInvalidaError ||
      err instanceof AprendizajeInvalidoError ||
      err instanceof AplicacionSinDecisionHumanaError ||
      err instanceof MetricaCruzadaError
    ) {
      return reply.code(422).send({ error: err.name, message: err.message });
    }
    if (
      err instanceof DecisionInvalidaError ||
      err instanceof EvaluacionInvalidaError ||
      err instanceof EsquemaEvaluacionDesconocidoError
    ) {
      return reply.code(422).send({ error: err.name, message: err.message });
    }
    if (err instanceof PreguntaFueraDelRubroError || err instanceof SeleccionInvalidaError) {
      return reply.code(400).send({ error: err.name, message: err.message });
    }
    if (
      err instanceof DecisionYaResueltaError ||
      err instanceof DepartamentoPausadoError ||
      err instanceof ActivacionRealProhibidaError ||
      err instanceof EntornoRealBloqueadoError
    ) {
      return reply.code(409).send({ error: err.name, message: err.message });
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
      err instanceof PaqueteNoEjecutableError ||
      err instanceof ComandoCanalInvalidoError ||
      err instanceof AdaptadorCanalNoDisponibleError ||
      err instanceof PublicacionNoOperableError ||
      err instanceof ModoRealDesactivadoError ||
      err instanceof WebhookInvalidoError ||
      err instanceof ComandoMedicionInvalidoError ||
      err instanceof OptimizacionNoOperableError ||
      err instanceof ComandoControlInvalidoError ||
      err instanceof ComandoPilotoInvalidoError
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
  registerChannelRoutes(app, deps.store);
  registerMeasurementRoutes(app, deps.store);
  registerControlRoutes(app, deps.store);
  registerPilotRoutes(app, deps.store);
  registerDirectorWorkspaceRoutes(app, deps.store, clock);
  registerDirectorAutonomoRoutes(app, deps.store, clock);
  registerDirectorAutonomoProgramasRoutes(app, deps.store, clock);
  registerEvaluacionRoutes(app, deps.store, clock);

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
