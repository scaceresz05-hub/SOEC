/**
 * Rutas de organizaciones y miembros. TODAS exigen sesión (401 sin sesión). La organización se
 * resuelve por `slug` y se valida contra la membresía activa del usuario (404 si no hay). Los
 * permisos efectivos gobiernan cada acción (403 si faltan). El :org de la URL nunca autoriza.
 */
import type { FastifyInstance } from 'fastify';
import type { IdentityService } from '@soec/identity';
import { requireOrgContext, requireUser } from './auth-context';

function falta(v: unknown): boolean {
  return typeof v !== 'string' || !v.trim();
}

export function registerOrganizationsRoutes(app: FastifyInstance, svc: IdentityService, exposeInviteToken: boolean): void {
  app.get('/organizations', async (req, reply) => {
    const user = await requireUser(svc, req);
    const orgs = await svc.listarMisOrganizaciones(user.id);
    return reply.send({ organizaciones: orgs.map((o) => ({ slug: o.organization.slug, name: o.organization.name, role: o.role, operationalMode: o.organization.operationalMode })) });
  });

  app.post('/organizations', async (req, reply) => {
    const user = await requireUser(svc, req);
    const b = (req.body ?? {}) as { slug?: string; name?: string };
    if (falta(b.slug) || falta(b.name)) return reply.code(400).send({ error: 'ENTRADA_INVALIDA', message: 'slug y name requeridos' });
    const org = await svc.crearOrganizacion(user.id, b.slug!, b.name!);
    return reply.code(201).send({ slug: org.slug, name: org.name, operationalMode: org.operationalMode });
  });

  app.get('/organizations/:slug', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const ctx = await requireOrgContext(svc, req, slug);
    return reply.send({ slug: ctx.organization.slug, name: ctx.organization.name, operationalMode: ctx.organization.operationalMode, role: ctx.membership.role, permisos: [...ctx.permisos] });
  });

  app.patch('/organizations/:slug', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const ctx = await requireOrgContext(svc, req, slug);
    const b = (req.body ?? {}) as { name?: string };
    if (falta(b.name)) return reply.code(400).send({ error: 'ENTRADA_INVALIDA', message: 'name requerido' });
    const org = await svc.actualizarOrganizacion(ctx, b.name!);
    return reply.send({ slug: org.slug, name: org.name });
  });

  app.get('/organizations/:slug/members', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const ctx = await requireOrgContext(svc, req, slug);
    const miembros = await svc.listarMiembros(ctx);
    return reply.send({ miembros: miembros.map((m) => ({ membershipId: m.membership.id, email: m.email, displayName: m.displayName, role: m.membership.role, status: m.membership.status })) });
  });

  app.post('/organizations/:slug/invitations', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const ctx = await requireOrgContext(svc, req, slug);
    const b = (req.body ?? {}) as { email?: string; role?: string };
    if (falta(b.email) || falta(b.role)) return reply.code(400).send({ error: 'ENTRADA_INVALIDA', message: 'email y role requeridos' });
    const { token } = await svc.invitarMiembro(ctx, b.email!, b.role!);
    // El token solo se devuelve fuera de producción (no hay transporte de correo aún).
    return reply.code(201).send({ invitada: true, ...(exposeInviteToken ? { devToken: token } : {}) });
  });

  app.patch('/organizations/:slug/members/:membershipId', async (req, reply) => {
    const { slug, membershipId } = req.params as { slug: string; membershipId: string };
    const ctx = await requireOrgContext(svc, req, slug);
    const b = (req.body ?? {}) as { role?: string };
    if (falta(b.role)) return reply.code(400).send({ error: 'ENTRADA_INVALIDA', message: 'role requerido' });
    const m = await svc.cambiarRolMiembro(ctx, membershipId, b.role!);
    return reply.send({ membershipId: m.id, role: m.role });
  });

  app.delete('/organizations/:slug/members/:membershipId', async (req, reply) => {
    const { slug, membershipId } = req.params as { slug: string; membershipId: string };
    const ctx = await requireOrgContext(svc, req, slug);
    const m = await svc.cambiarEstadoMiembro(ctx, membershipId, 'REVOKED');
    return reply.send({ membershipId: m.id, status: m.status });
  });

  app.get('/organizations/:slug/audit', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const ctx = await requireOrgContext(svc, req, slug);
    const q = (req.query ?? {}) as { limit?: string; offset?: string };
    const eventos = await svc.listarAuditoria(ctx, Number(q.limit ?? 50), Number(q.offset ?? 0));
    return reply.send({ eventos });
  });

  app.patch('/organizations/:slug/operational-mode', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const ctx = await requireOrgContext(svc, req, slug);
    const b = (req.body ?? {}) as { mode?: string };
    if (falta(b.mode)) return reply.code(400).send({ error: 'ENTRADA_INVALIDA', message: 'mode requerido' });
    const org = await svc.cambiarModoOperativo(ctx, b.mode!);
    return reply.send({ slug: org.slug, operationalMode: org.operationalMode });
  });
}
