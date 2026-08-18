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
import { registerGeneracionRoutes } from './generacion-routes';
import { registerCommercialKnowledgeRoutes } from './commercial-knowledge-routes';
import { registerCiaRoutes } from './cia-routes';
import { EstrategiaCreativaInvalidaError } from '@soec/estrategia-creativa';
import { ComandoCrmInvalidoError, HipotesisNoEncontradaError } from '@soec/crm-comercial';
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
import type { Pool } from 'pg';
import { IdentityError, IdentityService } from '@soec/identity';
import { registerAuthRoutes, type AuthRateLimitConfig } from './auth-routes';
import { RateLimiter } from './rate-limit';
import { registerOrganizationsRoutes } from './organizations-routes';
import { registrarVerticalesAutenticadas } from './vertical-gateway';
import { PlataformaError } from './plataforma';
import { registerPlataformaRoutes } from './plataforma-routes';
import { registerAcquisitionRoutes } from './acquisition-routes';
import { registerMetaOAuthAutenticadas, registerMetaCallbackPublico } from './acquisition/meta-oauth-routes';
import { registerAccionRoutes } from './accion/accion-routes';
import { registerCampanaRoutes } from './campana/campana-routes';
import { crearComposicionMetaOAuth } from './acquisition/meta-runtime';
import { registrarProteccionCsrf } from './csrf';

export interface AppDeps {
  store: EventStore;
  intelligence: IntelligenceProvider;
  /** Reloj inyectable: real en producción, fijo en tests (tiempos de ocurrencia reales). */
  clock?: Clock;
  /** Pool PostgreSQL para el plano de identidad. Sin él, no se registran /auth ni /organizations. */
  pool?: Pool;
  /**
   * Acceso demo LEGACY (rutas /experience/* y verticales sin autenticación). DEFAULT false.
   * Prohibido en producción (el arranque lo bloquea). La ausencia de sesión NUNCA es autorización;
   * este flag solo re-registra la superficie de demostración histórica en test/dev.
   */
  legacyDemoAccess?: boolean;
  /** Cookies `Secure` (producción). */
  secureCookies?: boolean;
  /** Orígenes permitidos para operaciones mutativas (protección CSRF F-01). Vacío = sin navegador. */
  allowedOrigins?: readonly string[];
  /** Configuración de rate limiting de autenticación (F-06). Usa defaults si se omite. */
  rateLimit?: AuthRateLimitConfig;
  /** Limitador de acciones de generación (Tramo J). Inyectable en tests; default generoso si se omite. */
  generationRateLimit?: RateLimiter;
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
  const secure = deps.secureCookies ?? false;

  // ── Cabeceras de seguridad (todas las respuestas) ─────────────────────────────────────────────
  // La API sirve JSON: CSP restrictiva, sin marcos, sin sniffing, sin referrer. HSTS sólo cuando las
  // cookies son `Secure` (producción tras TLS), para no forzar HTTPS en dev local.
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header(
      'Content-Security-Policy',
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    );
    if (secure) reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    return payload;
  });

  // ── Protección CSRF (F-01): valida Origin/Referer en métodos mutativos, global ────────────────
  registrarProteccionCsrf(app, deps.allowedOrigins ?? []);

  app.setErrorHandler((err, _req, reply) => {
    // Errores de identidad: llevan su propio código HTTP (401/403/404/409/400).
    if (err instanceof IdentityError) {
      return reply.code(err.httpStatus).send({ error: err.code, message: err.message });
    }
    // Plataforma multiempresa: organización/perfil/fuente no configurados y binding denegado.
    // FAIL-CLOSED explícito — nunca se degrada a la configuración de otra organización.
    if (err instanceof PlataformaError) {
      return reply.code(err.httpStatus).send({ error: err.code, message: err.message });
    }
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
    if (
      err instanceof NegocioInvalidoError ||
      err instanceof ProgramaInvalidoError ||
      err instanceof ProgramaNoEjecutableError
    ) {
      return reply.code(422).send({ error: err.name, message: err.message });
    }
    if (err instanceof EstrategiaCreativaInvalidaError) {
      return reply.code(422).send({ error: err.name, message: err.message });
    }
    if (err instanceof ComandoCrmInvalidoError) {
      return reply.code(400).send({ error: err.name, message: err.message });
    }
    if (err instanceof HipotesisNoEncontradaError) {
      return reply.code(404).send({ error: err.name, message: err.message });
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

  // Registra TODA la superficie vertical/experiencia sobre un destino (app raíz o ámbito del
  // gateway). El contexto lo derivan las rutas de las cabeceras `x-organization-id/-actor-id/-scope`,
  // que el gateway autenticado sobreescribe con valores autoritativos server-side.
  // Composición productiva del OAuth de Meta (PG + AWS KMS + HTTP), construida UNA vez y compartida por el
  // callback público y las rutas autenticadas. Null si falta pool/config ⇒ fail-closed sin romper la API.
  const composicionMeta = deps.pool ? crearComposicionMetaOAuth(deps.pool, process.env) : null;

  const registrarSuperficieVertical = (target: FastifyInstance): void => {
    registerModelRoutes(target, deps.store);
    registerEceRoutes(target, deps.store);
    registerOperationsRoutes(target, deps.store);
    registerCapabilityRoutes(target, deps.store);
    registerExperienceRoutes(target, deps.store);
    registerOperationalRoutes(target, deps.store);
    registerMarketingRoutes(target, deps.store);
    registerContentRoutes(target, deps.store);
    registerChannelRoutes(target, deps.store);
    registerMeasurementRoutes(target, deps.store);
    registerControlRoutes(target, deps.store);
    registerPilotRoutes(target, deps.store);
    registerDirectorWorkspaceRoutes(target, deps.store, clock);
    registerDirectorAutonomoRoutes(target, deps.store, clock);
    registerDirectorAutonomoProgramasRoutes(target, deps.store, clock);
    registerEvaluacionRoutes(target, deps.store, clock);
    registerGeneracionRoutes(target, deps.store, clock, deps.generationRateLimit); // Motor de Generación (M3, Tramo J)
    registerCommercialKnowledgeRoutes(target, deps.store, clock); // Conocimiento comercial / CRM (M3, A-1)
    registerCiaRoutes(target, deps.store); // Centro de Integraciones Autónomas (CIA, preparación cerrada)
    registerPlataformaRoutes(target, deps.store); // Estado, fundamentos y catálogo del negocio
    registerAcquisitionRoutes(target, deps.store); // Acquisition Engine (sólo lectura / shadow)
    // OAuth READ-ONLY de Meta — rutas AUTENTICADAS (start/connection/assets/binding). El CALLBACK va aparte,
    // PÚBLICO (fuera del gateway), porque el redirect de Meta llega sin sesión y se autentica por el state.
    registerMetaOAuthAutenticadas(target, { composicion: composicionMeta });
    registerAccionRoutes(target, deps.pool); // Safe Action Plane (V2-A): mandatos + budget guard + ledger
    registerCampanaRoutes(target, deps.pool); // V2-B/C: campaña + autonomía en dry-run/shadow (dormante)

    target.post('/events', async (req, reply) => {
      const ctx = contextFrom(req);
      const body = req.body as AppendBody;
      const result = await deps.store.append(ctx, body.streamId, body.expectedVersion, body.events);
      return reply.code(201).send({ version: result.version, events: result.events });
    });

    target.get('/streams/:id', async (req, reply) => {
      const ctx = contextFrom(req);
      const { id } = req.params as { id: string };
      const events = await deps.store.readStream(ctx, id);
      return reply.send({ streamId: id, version: events.length, events });
    });

    target.get('/streams/:id/at', async (req, reply) => {
      const ctx = contextFrom(req);
      const { id } = req.params as { id: string };
      const { asOf } = req.query as { asOf?: string };
      if (!asOf) return reply.code(400).send({ error: 'MissingAsOf' });
      const events = await deps.store.reconstructAt(ctx, id, asOf);
      return reply.send({ streamId: id, asOf, events });
    });

    target.post('/intelligence', async (req, reply) => {
      const ctx = contextFrom(req);
      const request = req.body as IntelligenceRequest;
      const product = await deps.intelligence.operate(ctx, request);
      // Un producto se ofrece al juicio humano; nunca es una decisión ejecutada.
      return reply.send({ product, awaitingHumanJudgment: true });
    });
  };

  // ── Plano PRODUCTIVO: autenticación y organizaciones (siempre; exige sesión) ──────────────────
  if (deps.pool) {
    const identity = new IdentityService(deps.pool);
    registerAuthRoutes(app, identity, secure, {
      exposeResetToken: !secure,
      ...(deps.rateLimit ? { rateLimit: deps.rateLimit } : {}),
    });
    registerOrganizationsRoutes(app, identity, !secure); // devToken de invitación solo fuera de prod

    // Callback OAuth de Meta: PÚBLICO (fuera del gateway vertical) porque el redirect del navegador de Meta
    // llega sin sesión ni Authorization. La autoridad viene del `state` persistido (org+actor, one-time, TTL,
    // consumo atómico); no acepta org/actor externos, no expone token y jamás deja CONNECTED (binding humano
    // posterior y autenticado). Fail-closed si no hay composición.
    registerMetaCallbackPublico(app, { composicion: composicionMeta, webBaseUrl: (deps.allowedOrigins ?? [])[0] });

    // CUTOVER (Macrobloque 1, incremento final): en condiciones normales (sin demo legacy), la
    // superficie vertical se registra DENTRO del gateway autenticado ⇒ sin sesión 401, sin
    // membresía 404. Ya no es alcanzable sin autenticación.
    if (deps.legacyDemoAccess !== true) {
      registrarVerticalesAutenticadas(app, identity, registrarSuperficieVertical);
    }
  }

  // ── Superficie DEMO LEGACY (sin autenticación): SOLO bajo flag explícito, test/dev ────────────
  // La ausencia de sesión NUNCA autoriza; estas rutas se re-exponen sin auth únicamente cuando
  // `legacyDemoAccess` es true (prohibido en producción; el arranque lo bloquea).
  if (deps.legacyDemoAccess === true) {
    registrarSuperficieVertical(app);
  }

  return app;
}
