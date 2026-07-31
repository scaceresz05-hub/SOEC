/**
 * Rutas de autenticación. `/auth/register`, `/auth/login` y `/invitations/:token/accept` son
 * públicas (mínimas); el resto exige sesión (401 sin sesión). Nunca expone hash ni token de sesión
 * en el cuerpo. Cookie httpOnly como transporte de sesión.
 */
import type { FastifyInstance } from 'fastify';
import type { IdentityService, User } from '@soec/identity';
import { limpiarCookieSesion, ponerCookieSesion, requireUser, tokenSesionDe } from './auth-context';

function userPublico(u: User) {
  return { id: u.id, email: u.email, displayName: u.displayName, status: u.status };
}
function falta(v: unknown): boolean {
  return typeof v !== 'string' || !v.trim();
}

export function registerAuthRoutes(app: FastifyInstance, svc: IdentityService, secure: boolean): void {
  app.post('/auth/register', async (req, reply) => {
    const b = (req.body ?? {}) as { email?: string; displayName?: string; password?: string };
    if (falta(b.email) || falta(b.displayName) || falta(b.password)) return reply.code(400).send({ error: 'ENTRADA_INVALIDA', message: 'email, displayName y password requeridos' });
    const user = await svc.registrar(b.email!, b.displayName!, b.password!);
    return reply.code(201).send({ user: userPublico(user) });
  });

  app.post('/auth/login', async (req, reply) => {
    const b = (req.body ?? {}) as { email?: string; password?: string };
    if (falta(b.email) || falta(b.password)) return reply.code(400).send({ error: 'ENTRADA_INVALIDA', message: 'email y password requeridos' });
    const { user, token } = await svc.login(b.email!, b.password!);
    ponerCookieSesion(reply, token, secure);
    return reply.send({ user: userPublico(user) });
  });

  app.post('/auth/logout', async (req, reply) => {
    const token = tokenSesionDe(req);
    if (token) await svc.logout(token);
    limpiarCookieSesion(reply, secure);
    return reply.send({ ok: true });
  });

  app.post('/auth/logout-all', async (req, reply) => {
    const token = tokenSesionDe(req);
    if (!token) return reply.code(401).send({ error: 'NO_AUTENTICADO', message: 'no autenticado' });
    const n = await svc.logoutAll(token);
    limpiarCookieSesion(reply, secure);
    return reply.send({ revocadas: n });
  });

  app.get('/auth/me', async (req, reply) => {
    const user = await requireUser(svc, req);
    const orgs = await svc.listarMisOrganizaciones(user.id);
    return reply.send({ user: userPublico(user), organizaciones: orgs.map((o) => ({ slug: o.organization.slug, name: o.organization.name, role: o.role, operationalMode: o.organization.operationalMode })) });
  });

  app.post('/auth/change-password', async (req, reply) => {
    const user = await requireUser(svc, req);
    const b = (req.body ?? {}) as { actual?: string; nueva?: string };
    if (falta(b.actual) || falta(b.nueva)) return reply.code(400).send({ error: 'ENTRADA_INVALIDA', message: 'actual y nueva requeridas' });
    await svc.cambiarPassword(user.id, b.actual!, b.nueva!);
    limpiarCookieSesion(reply, secure); // se invalidan las sesiones; forzar nuevo login
    return reply.send({ ok: true });
  });

  app.post('/invitations/:token/accept', async (req, reply) => {
    const { token } = req.params as { token: string };
    const b = (req.body ?? {}) as { displayName?: string; password?: string };
    const { user, membership } = await svc.aceptarInvitacion(token, b.displayName ?? '', b.password ?? '');
    // Auto-login del usuario recién aceptado.
    const login = await svc.login(user.email, b.password ?? '').catch(() => null);
    if (login) ponerCookieSesion(reply, login.token, secure);
    return reply.code(201).send({ user: userPublico(user), membership: { id: membership.id, role: membership.role } });
  });
}
