/**
 * Rutas técnicas mínimas para demostrar las verticales MED y MDM (§12).
 * No es una API pública ni una interfaz comercial: existe para ejercitar los
 * comandos y consultas del dominio, incluida la separación MED ╪ MDM.
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
import { MedService, MdmService, ModelLinkService } from '@soec/models';

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

// El cuerpo transporta los datos del comando; el contexto viaja por cabeceras.
type Body = Record<string, unknown>;

export function registerModelRoutes(app: FastifyInstance, store: EventStore): void {
  const med = new MedService(store);
  const mdm = new MdmService(store);
  const links = new ModelLinkService(store);

  const paramsId = (req: FastifyRequest): string => (req.params as { id: string }).id;

  // ── MED ──────────────────────────────────────────────────────────────────
  app.post('/med/:id', async (req, reply) => {
    const ctx = contextFrom(req);
    const b = req.body as Body;
    const r = await med.crear(ctx, { instanceId: paramsId(req), ...(b as object) } as never);
    return reply.code(201).send({ version: r.version });
  });
  app.post('/med/:id/entidades', async (req, reply) => {
    const ctx = contextFrom(req);
    const r = await med.registrarEntidad(ctx, {
      instanceId: paramsId(req),
      ...(req.body as object),
    } as never);
    return reply.code(201).send({ version: r.version });
  });
  app.post('/med/:id/afirmaciones', async (req, reply) => {
    const ctx = contextFrom(req);
    const r = await med.emitirAfirmacion(ctx, {
      instanceId: paramsId(req),
      ...(req.body as object),
    } as never);
    return reply.code(201).send({ version: r.version });
  });
  app.post('/med/:id/evidencias', async (req, reply) => {
    const ctx = contextFrom(req);
    const r = await med.incorporarEvidencia(ctx, {
      instanceId: paramsId(req),
      ...(req.body as object),
    } as never);
    return reply.code(201).send({ version: r.version });
  });
  app.post('/med/:id/revision', async (req, reply) => {
    const ctx = contextFrom(req);
    const r = await med.revisarAfirmacion(ctx, {
      instanceId: paramsId(req),
      ...(req.body as object),
    } as never);
    return reply.code(201).send({ version: r.version });
  });
  app.get('/med/:id', async (req, reply) => {
    const ctx = contextFrom(req);
    return reply.send({ estado: await med.estadoActual(ctx, paramsId(req)) });
  });
  app.get('/med/:id/historico', async (req, reply) => {
    const ctx = contextFrom(req);
    const { asOf } = req.query as { asOf?: string };
    if (!asOf) return reply.code(400).send({ error: 'MissingAsOf' });
    return reply.send({ estado: await med.estadoHistorico(ctx, paramsId(req), asOf) });
  });

  // ── MDM ──────────────────────────────────────────────────────────────────
  app.post('/mdm/:id', async (req, reply) => {
    const ctx = contextFrom(req);
    const r = await mdm.crear(ctx, { instanceId: paramsId(req), ...(req.body as object) } as never);
    return reply.code(201).send({ version: r.version });
  });
  app.post('/mdm/:id/entidades', async (req, reply) => {
    const ctx = contextFrom(req);
    const r = await mdm.registrarEntidad(ctx, {
      instanceId: paramsId(req),
      ...(req.body as object),
    } as never);
    return reply.code(201).send({ version: r.version });
  });
  app.post('/mdm/:id/observaciones', async (req, reply) => {
    const ctx = contextFrom(req);
    const r = await mdm.registrarObservacion(ctx, {
      instanceId: paramsId(req),
      ...(req.body as object),
    } as never);
    return reply.code(201).send({ version: r.version });
  });
  app.post('/mdm/:id/cambios', async (req, reply) => {
    const ctx = contextFrom(req);
    const r = await mdm.registrarCambioExterno(ctx, {
      instanceId: paramsId(req),
      ...(req.body as object),
    } as never);
    return reply.code(201).send({ version: r.version });
  });
  app.post('/mdm/:id/afirmaciones', async (req, reply) => {
    const ctx = contextFrom(req);
    const r = await mdm.emitirAfirmacion(ctx, {
      instanceId: paramsId(req),
      ...(req.body as object),
    } as never);
    return reply.code(201).send({ version: r.version });
  });
  app.post('/mdm/:id/evidencias', async (req, reply) => {
    const ctx = contextFrom(req);
    const r = await mdm.incorporarEvidencia(ctx, {
      instanceId: paramsId(req),
      ...(req.body as object),
    } as never);
    return reply.code(201).send({ version: r.version });
  });
  app.post('/mdm/:id/revision', async (req, reply) => {
    const ctx = contextFrom(req);
    const r = await mdm.revisarAfirmacion(ctx, {
      instanceId: paramsId(req),
      ...(req.body as object),
    } as never);
    return reply.code(201).send({ version: r.version });
  });
  app.get('/mdm/:id', async (req, reply) => {
    const ctx = contextFrom(req);
    return reply.send({ estado: await mdm.estadoActual(ctx, paramsId(req)) });
  });
  app.get('/mdm/:id/historico', async (req, reply) => {
    const ctx = contextFrom(req);
    const { asOf } = req.query as { asOf?: string };
    if (!asOf) return reply.code(400).send({ error: 'MissingAsOf' });
    return reply.send({ estado: await mdm.estadoHistorico(ctx, paramsId(req), asOf) });
  });

  // ── Enlaces MED↔MDM ────────────────────────────────────────────────────────
  app.post('/links/:id', async (req, reply) => {
    const ctx = contextFrom(req);
    const r = await links.registrar(ctx, {
      linkId: paramsId(req),
      ...(req.body as object),
    } as never);
    return reply.code(201).send({ version: r.version });
  });
  app.get('/links/:id', async (req, reply) => {
    const ctx = contextFrom(req);
    return reply.send({ enlace: await links.estado(ctx, paramsId(req)) });
  });
}
