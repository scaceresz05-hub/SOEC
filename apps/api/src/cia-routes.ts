/**
 * apps/api · RUTAS del Centro de Integraciones Autónomas (CIA) — capa de producto sobre la PCE.
 *
 * Expone, sobre el EventStore REAL (PgEventStore en producción), las operaciones capability-framed que la web
 * consume como Inicio / Decisiones / Por qué / Autonomía. El usuario autoriza CAPACIDADES (resultados), nunca
 * herramientas: estas rutas no exponen proveedores en las vistas de usuario (sólo la ruta de auditoría lo hace).
 * Todo SIMULADO; `AUTONOMOUS_REAL` bloqueado; sin credenciales/red/gasto reales.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { ActorId, type Attribution, type EventStore, OrganizationId, type RequestContext, ScopeRequiredError } from '@soec/contracts';
import {
  AutorizacionesService, KillSwitchService, PresupuestoService, PlanificadorService, LecturaIntegracionesService,
  CatalogoService, CiaError, type NivelAutonomia, type CondicionesAutorizacion,
} from '@soec/cia';

function header(req: FastifyRequest, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}
function contextFrom(req: FastifyRequest): RequestContext {
  const org = header(req, 'x-organization-id');
  const actor = header(req, 'x-actor-id');
  if (!org || !actor) throw new ScopeRequiredError('Faltan encabezados de organización o actor');
  const organizationId = OrganizationId(org);
  const permissions = (header(req, 'x-scope') ?? 'events:append,events:read').split(',').map((s) => s.trim()).filter(Boolean);
  return { organizationId, actor: ActorId(actor), scope: { organizationId, permissions }, correlationId: header(req, 'x-correlation-id') ?? randomUUID() };
}
const A = (purpose: string): Attribution => ({ source: 'cia-api', purpose, assumptions: [], claimType: 'observational', regime: 'empirical', uncertainty: 'media' });
const ahora = (): string => new Date().toISOString();

export function registerCiaRoutes(app: FastifyInstance, store: EventStore): void {
  const autorizaciones = new AutorizacionesService(store);
  const kill = new KillSwitchService(store);
  const presupuesto = new PresupuestoService(store, autorizaciones);
  const planificador = new PlanificadorService(store, autorizaciones, kill, undefined, presupuesto);
  const lectura = new LecturaIntegracionesService(autorizaciones, planificador);
  const catalogo = new CatalogoService();

  const capId = (req: FastifyRequest): string => (req.params as { capId: string }).capId;
  const planId = (req: FastifyRequest): string => (req.params as { planId: string }).planId;

  // Envuelve un handler: éxito → {ok,datos}; error de dominio → 400 {ok:false,error,mensaje}.
  const wrap = (fn: (req: FastifyRequest, ctx: RequestContext) => Promise<unknown>) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        const ctx = contextFrom(req);
        return { ok: true, datos: await fn(req, ctx) };
      } catch (e) {
        if (e instanceof ScopeRequiredError) { reply.code(401); return { ok: false, error: 'NO_AUTORIZADO', mensaje: e.message }; }
        if (e instanceof CiaError) { reply.code(400); return { ok: false, error: e.name, mensaje: e.message }; }
        throw e;
      }
    };

  // Catálogo de capacidades (resultados). Nunca proveedores.
  app.get('/api/cia/catalogo', wrap(async () => catalogo.listar()));

  // Inicio / Decisiones / Por qué (capability-framed, sin proveedor).
  app.get('/api/cia/inicio', wrap(async (_req, ctx) => ({ capacidades: await lectura.home(ctx), decisiones: await lectura.decisiones(ctx) })));
  app.get('/api/cia/decisiones', wrap(async (_req, ctx) => lectura.decisiones(ctx)));
  app.get('/api/cia/planes/:planId/explicacion', wrap(async (req, ctx) => lectura.explicacion(ctx, planId(req))));
  // Auditoría técnica (única vista que revela el proveedor detrás de la frontera).
  app.get('/api/cia/planes/:planId/auditoria', wrap(async (req, ctx) => lectura.auditoria(ctx, planId(req))));

  // Autorizaciones (el usuario autoriza capacidades).
  app.post('/api/cia/autorizaciones/:capId', wrap(async (req, ctx) => {
    const b = (req.body ?? {}) as { limite: number; nivelAutonomia: NivelAutonomia; actorHumano: string; riesgo?: CondicionesAutorizacion['riesgo']; periodo?: string; alcance?: string };
    return autorizaciones.autorizar(ctx, capId(req), b, A('autorizar capacidad'), ahora());
  }));
  app.post('/api/cia/autorizaciones/:capId/modificar', wrap(async (req, ctx) => autorizaciones.modificar(ctx, capId(req), (req.body ?? {}) as Partial<CondicionesAutorizacion>, A('modificar límites'), ahora())));
  app.post('/api/cia/autorizaciones/:capId/pausar', wrap(async (req, ctx) => autorizaciones.pausar(ctx, capId(req), A('pausar'), ahora())));
  app.post('/api/cia/autorizaciones/:capId/reanudar', wrap(async (req, ctx) => autorizaciones.reanudar(ctx, capId(req), A('reanudar'), ahora())));
  app.post('/api/cia/autorizaciones/:capId/revocar', wrap(async (req, ctx) => autorizaciones.revocar(ctx, capId(req), A('revocar'), ahora())));
  app.get('/api/cia/autorizaciones/:capId/presupuesto', wrap(async (req, ctx) => ({
    disponible: await presupuesto.disponible(ctx, capId(req)),
    confirmado: await presupuesto.confirmado(ctx, capId(req)),
    pendiente: await presupuesto.reservadoPendiente(ctx, capId(req)),
  })));

  // Planes de acción externa (simulados).
  app.post('/api/cia/planes', wrap(async (req, ctx) => {
    const b = (req.body ?? {}) as { planId?: string; capacidadId: string; objetivo: string; costoEstimado: number };
    return planificador.planificar(ctx, b.planId ?? randomUUID(), { capacidadId: b.capacidadId, objetivo: b.objetivo, costoEstimado: b.costoEstimado }, A('planificar acción'), ahora());
  }));
  app.post('/api/cia/planes/:planId/aprobar', wrap(async (req, ctx) => planificador.aprobar(ctx, planId(req), ((req.body ?? {}) as { actorHumano: string }).actorHumano, A('aprobar plan'), ahora())));
  app.post('/api/cia/planes/:planId/rechazar', wrap(async (req, ctx) => planificador.rechazar(ctx, planId(req), A('rechazar plan'), ahora())));

  // Autonomía / kill-switch por organización o capacidad.
  app.post('/api/cia/autonomia/kill/:alcance', wrap(async (req, ctx) => kill.activar(ctx, (req.params as { alcance: string }).alcance, A('kill-switch'), ahora())));
  app.delete('/api/cia/autonomia/kill/:alcance', wrap(async (req, ctx) => kill.desactivar(ctx, (req.params as { alcance: string }).alcance, A('reactivar'), ahora())));
}
