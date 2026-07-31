/**
 * Rutas de autenticación. `/auth/register`, `/auth/login`, `/auth/password-reset/*` y
 * `/invitations/:token/accept` son públicas (mínimas); el resto exige sesión (401 sin sesión).
 * Nunca expone hash ni token de sesión en el cuerpo. Cookie httpOnly como transporte de sesión.
 * Login y solicitud de reset están protegidos por rate limiting (fuerza bruta).
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { IdentityService, User } from '@soec/identity';
import { limpiarCookieSesion, ponerCookieSesion, requireUser, tokenSesionDe } from './auth-context';
import { RateLimiter } from './rate-limit';

function userPublico(u: User) {
  return { id: u.id, email: u.email, displayName: u.displayName, status: u.status };
}
function falta(v: unknown): boolean {
  return typeof v !== 'string' || !v.trim();
}
function ipDe(req: FastifyRequest): string {
  return req.ip || 'desconocida';
}

export interface AuthRoutesOpts {
  /** Expone el token de reset/invitación en la respuesta (solo fuera de producción). */
  readonly exposeResetToken?: boolean;
  /** Reloj inyectable para los limitadores (tests deterministas). */
  readonly now?: () => number;
}

export function registerAuthRoutes(app: FastifyInstance, svc: IdentityService, secure: boolean, opts: AuthRoutesOpts = {}): void {
  const exposeResetToken = opts.exposeResetToken ?? !secure;
  // 5 intentos por 15 min → bloqueo de 15 min. Clave: email+IP para login, IP para reset.
  const now = opts.now;
  const loginLimiter = new RateLimiter({ maxIntentos: 5, ventanaMs: 15 * 60_000, bloqueoMs: 15 * 60_000, ...(now ? { now } : {}) });
  const resetLimiter = new RateLimiter({ maxIntentos: 5, ventanaMs: 15 * 60_000, bloqueoMs: 15 * 60_000, ...(now ? { now } : {}) });

  app.post('/auth/register', async (req, reply) => {
    const b = (req.body ?? {}) as { email?: string; displayName?: string; password?: string };
    if (falta(b.email) || falta(b.displayName) || falta(b.password)) return reply.code(400).send({ error: 'ENTRADA_INVALIDA', message: 'email, displayName y password requeridos' });
    const user = await svc.registrar(b.email!, b.displayName!, b.password!);
    return reply.code(201).send({ user: userPublico(user) });
  });

  app.post('/auth/login', async (req, reply) => {
    const b = (req.body ?? {}) as { email?: string; password?: string };
    if (falta(b.email) || falta(b.password)) return reply.code(400).send({ error: 'ENTRADA_INVALIDA', message: 'email y password requeridos' });
    const clave = `${b.email!.trim().toLowerCase()}|${ipDe(req)}`;
    const estado = loginLimiter.revisar(clave);
    if (!estado.permitido) return reply.code(429).header('retry-after', String(estado.retryAfterSeg)).send({ error: 'DEMASIADOS_INTENTOS', message: 'demasiados intentos; intente más tarde' });
    try {
      // Rotación: si llega una cookie de sesión previa, se revoca al emitir la nueva.
      const { user, token } = await svc.login(b.email!, b.password!, { tokenSesionPrevio: tokenSesionDe(req) ?? '' });
      loginLimiter.registrarExito(clave);
      ponerCookieSesion(reply, token, secure);
      return reply.send({ user: userPublico(user) });
    } catch (err) {
      loginLimiter.registrarFallo(clave);
      throw err;
    }
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

  // ── Restablecimiento de contraseña ──────────────────────────────────────────────────────────
  // Respuesta uniforme (no enumera cuentas). El token se entrega fuera de banda; en dev se expone
  // en `devToken` para pruebas (nunca en producción). Canal de correo = integración futura.
  app.post('/auth/password-reset/request', async (req, reply) => {
    const b = (req.body ?? {}) as { email?: string };
    if (falta(b.email)) return reply.code(400).send({ error: 'ENTRADA_INVALIDA', message: 'email requerido' });
    const clave = ipDe(req);
    const estado = resetLimiter.revisar(clave);
    if (!estado.permitido) return reply.code(429).header('retry-after', String(estado.retryAfterSeg)).send({ error: 'DEMASIADOS_INTENTOS', message: 'demasiados intentos; intente más tarde' });
    resetLimiter.registrarFallo(clave); // cada solicitud cuenta para el límite por IP
    const r = await svc.solicitarResetPassword(b.email!);
    const cuerpo: { ok: true; devToken?: string } = { ok: true };
    if (exposeResetToken && r) cuerpo.devToken = r.token;
    return reply.send(cuerpo);
  });

  app.post('/auth/password-reset/confirm', async (req, reply) => {
    const b = (req.body ?? {}) as { token?: string; nueva?: string };
    if (falta(b.token) || falta(b.nueva)) return reply.code(400).send({ error: 'ENTRADA_INVALIDA', message: 'token y nueva requeridos' });
    await svc.confirmarResetPassword(b.token!, b.nueva!);
    limpiarCookieSesion(reply, secure);
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
