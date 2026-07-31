/**
 * Contexto de autenticación para la API. Resuelve la sesión desde la cookie httpOnly y expone
 * guardas explícitas: `requireUser` (401 sin sesión) y `requireOrgContext` (404 si no hay
 * membresía activa; la organización se deriva de la sesión, NUNCA se autoriza por el :org de la
 * URL). Sin sesión ⇒ 401 SIEMPRE (la ausencia de sesión no es autorización).
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { type ContextoOrg, type IdentityService, NoAutenticadoError, type Permission, type User } from '@soec/identity';

export const COOKIE_SESION = 'soec_session';

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const parte of header.split(';')) {
    const i = parte.indexOf('=');
    if (i < 0) continue;
    const k = parte.slice(0, i).trim();
    const v = parte.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function tokenSesionDe(req: FastifyRequest): string | undefined {
  const cookie = req.headers.cookie;
  return parseCookies(Array.isArray(cookie) ? cookie[0] : cookie)[COOKIE_SESION];
}

export function ponerCookieSesion(reply: FastifyReply, token: string, secure: boolean, maxAgeSeg = 60 * 60 * 24 * 7): void {
  const attrs = [`${COOKIE_SESION}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSeg}`];
  if (secure) attrs.push('Secure');
  reply.header('set-cookie', attrs.join('; '));
}

export function limpiarCookieSesion(reply: FastifyReply, secure: boolean): void {
  const attrs = [`${COOKIE_SESION}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) attrs.push('Secure');
  reply.header('set-cookie', attrs.join('; '));
}

/** Exige una sesión válida. Lanza 401 si no hay. La autenticación determina QUIÉN es el usuario. */
export async function requireUser(svc: IdentityService, req: FastifyRequest): Promise<User> {
  const r = await svc.resolverSesion(tokenSesionDe(req));
  if (!r) throw new NoAutenticadoError('no autenticado');
  return r.user;
}

/**
 * Exige sesión + membresía activa en la organización `slug`. La autoridad viene de la sesión;
 * el `slug` de la URL solo localiza el recurso y se valida contra la membresía (404 si no hay).
 */
export async function requireOrgContext(svc: IdentityService, req: FastifyRequest, slug: string): Promise<ContextoOrg> {
  const user = await requireUser(svc, req);
  return svc.resolverContextoOrganizacion(user, slug);
}

/** Exige un permiso efectivo en el contexto (403 si falta). */
export function requirePermission(svc: IdentityService, ctx: ContextoOrg, permiso: Permission): void {
  svc.exigirPermiso(ctx, permiso);
}
