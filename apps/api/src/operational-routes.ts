/**
 * Rutas técnicas del plano operativo (F2-AUT-01). Gestión de políticas y ejecución
 * de acciones AUTORIZADAS POR POLÍTICA. Efectos SIMULADOS: ningún efecto externo
 * real. No hay endpoint para «ejecutar en real» ni para saltar la autorización.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { ActorId, type EventStore, OrganizationId, type RequestContext, ScopeRequiredError } from '@soec/contracts';
import { OperationalService, PolicyService, AdaptadorSimulado } from '@soec/operacional';

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

export function registerOperationalRoutes(app: FastifyInstance, store: EventStore): void {
  const policies = new PolicyService(store);
  const op = new OperationalService(store, [new AdaptadorSimulado()]);
  const nowIso = (): string => new Date().toISOString();
  const attr = (req: FastifyRequest) => ({
    source: 'api-operativa',
    purpose: 'gestión operativa autorizada por política',
    assumptions: ['efectos simulados'],
    claimType: 'observational' as const,
    regime: 'institutional' as const,
    uncertainty: 'baja',
    ...(((req.body as { attribution?: object }) ?? {}).attribution ?? {}),
  });
  const pid = (req: FastifyRequest): string => (req.params as { id: string }).id;
  const eid = (req: FastifyRequest): string => (req.params as { execId: string }).execId;

  app.post('/operativo/politicas/:id', async (req, reply) => {
    const b = req.body as { contenido: Parameters<PolicyService['registrarVersion']>[2] };
    const r = await policies.registrarVersion(contextFrom(req), pid(req), b.contenido, attr(req), nowIso());
    return reply.code(201).send({ version: r.version });
  });
  app.post('/operativo/politicas/:id/publicar', async (req, reply) => {
    const { version } = req.body as { version: number };
    await policies.publicar(contextFrom(req), pid(req), version, attr(req), nowIso());
    return reply.code(201).send({ ok: true });
  });
  app.post('/operativo/politicas/:id/suspender', async (req, reply) => {
    const { motivo } = (req.body ?? {}) as { motivo?: string };
    await policies.suspender(contextFrom(req), pid(req), motivo ?? 'suspensión', attr(req), nowIso());
    return reply.code(201).send({ ok: true });
  });
  app.get('/operativo/politicas/:id', async (req, reply) => {
    return reply.send({ politica: await policies.cargar(contextFrom(req), pid(req)) });
  });

  app.post('/operativo/acciones/:execId', async (req, reply) => {
    const b = req.body as { policyId: string; accion: Parameters<OperationalService['ejecutar']>[1]['accion'] };
    const r = await op.ejecutar(contextFrom(req), { executionId: eid(req), policyId: b.policyId, accion: b.accion, attribution: attr(req), occurredAt: nowIso() });
    // El resultado se ejecuta solo si la política lo autoriza; el efecto es simulado.
    return reply.code(201).send({ estado: r.state.estado, permitida: r.decision.permitida, motivo: r.decision.motivo, efectoSimulado: r.state.efecto?.simulado ?? null });
  });
  app.get('/operativo/acciones/:execId', async (req, reply) => {
    return reply.send({ accion: await op.accion(contextFrom(req), eid(req)) });
  });
}
