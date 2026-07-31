/**
 * @soec/identity · aplicación · Casos de uso. Contienen las reglas de seguridad; los handlers HTTP
 * no deben reimplementarlas. La autoridad de organización proviene SIEMPRE de la sesión + membresía
 * activa, nunca del identificador de URL. Operaciones multi-tabla son transaccionales.
 */
import type { Pool, PoolClient } from 'pg';
import * as repo from '../pg/repositories';
import type { AuditEvent, Membership, Organization, Session, User } from '../domain/entities';
import { generarTokenSesion, hashToken, normalizarEmail, slugValido } from '../domain/entities';
import { hashPassword, verifyPassword } from '../domain/password';
import { type Permission, type Role, esRol, permisosDeRol, rolTienePermiso } from '../domain/roles';
import { esModo, modoActivable } from '../domain/modo';
import { ConflictoError, EntradaInvalidaError, NoAutenticadoError, NoEncontradoError, PoliticaError, SinPermisoError } from '../domain/errors';

/** Contexto de organización resuelto desde una sesión: autoridad de autorización. */
export interface ContextoOrg {
  readonly user: User;
  readonly organization: Organization;
  readonly membership: Membership;
  readonly permisos: ReadonlySet<Permission>;
}

async function enTransaccion<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const r = await fn(client);
    await client.query('commit');
    return r;
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

export class IdentityService {
  constructor(private readonly pool: Pool) {}

  private async audit(e: Omit<AuditEvent, 'id' | 'createdAt'>): Promise<void> {
    try {
      await repo.registrarAuditoria(this.pool, e);
    } catch {
      /* la auditoría no debe tumbar la operación principal */
    }
  }

  // ── Cuenta / sesión ─────────────────────────────────────────────────────────────────────────
  async registrar(email: string, displayName: string, password: string): Promise<User> {
    const e = normalizarEmail(email);
    if (!e.includes('@')) throw new EntradaInvalidaError('email inválido');
    if (!displayName.trim()) throw new EntradaInvalidaError('nombre requerido');
    const existente = await repo.usuarioPorEmail(this.pool, e);
    if (existente) throw new ConflictoError('ya existe una cuenta con ese email');
    return repo.crearUsuario(this.pool, e, displayName.trim(), hashPassword(password), 'ACTIVE');
  }

  /** Login: mensaje genérico para no permitir enumeración de correos. Crea sesión. */
  async login(email: string, password: string): Promise<{ user: User; token: string; session: Session }> {
    const e = normalizarEmail(email);
    const user = await repo.usuarioPorEmail(this.pool, e);
    const ok = user && user.status === 'ACTIVE' && verifyPassword(password, user.passwordHash);
    if (!user || !ok) {
      await this.audit({ organizationId: null, actorUserId: user?.id ?? null, action: 'auth.login.failed', resourceType: 'user', resourceId: null, result: 'FAILED', metadata: {} });
      throw new NoAutenticadoError();
    }
    const { token, tokenHash } = generarTokenSesion();
    const session = await repo.crearSesion(this.pool, user.id, tokenHash);
    await this.audit({ organizationId: null, actorUserId: user.id, action: 'auth.login.succeeded', resourceType: 'session', resourceId: session.id, result: 'SUCCESS', metadata: {} });
    return { user, token, session };
  }

  async logout(token: string): Promise<void> {
    const r = await repo.sesionVigentePorHash(this.pool, hashToken(token));
    if (r) {
      await repo.revocarSesion(this.pool, r.session.id);
      await this.audit({ organizationId: null, actorUserId: r.user.id, action: 'auth.logout', resourceType: 'session', resourceId: r.session.id, result: 'SUCCESS', metadata: {} });
    }
  }

  async logoutAll(token: string): Promise<number> {
    const r = await repo.sesionVigentePorHash(this.pool, hashToken(token));
    if (!r) throw new NoAutenticadoError('sesión inválida');
    const n = await repo.revocarSesionesDeUsuario(this.pool, r.user.id);
    await this.audit({ organizationId: null, actorUserId: r.user.id, action: 'auth.session.revoked', resourceType: 'user', resourceId: r.user.id, result: 'SUCCESS', metadata: { revocadas: n } });
    return n;
  }

  /** Resuelve una sesión válida desde el token de cookie. Autoridad de identidad. */
  async resolverSesion(token: string | undefined): Promise<{ user: User; session: Session } | null> {
    if (!token) return null;
    const r = await repo.sesionVigentePorHash(this.pool, hashToken(token));
    if (!r || r.user.status !== 'ACTIVE') return null;
    await repo.tocarSesion(this.pool, r.session.id);
    return r;
  }

  async cambiarPassword(userId: string, actual: string, nueva: string): Promise<void> {
    const user = await repo.usuarioPorId(this.pool, userId);
    if (!user) throw new NoAutenticadoError();
    if (!verifyPassword(actual, user.passwordHash)) throw new NoAutenticadoError('contraseña actual incorrecta');
    await repo.actualizarPasswordUsuario(this.pool, userId, hashPassword(nueva));
    await repo.revocarSesionesDeUsuario(this.pool, userId);
    await this.audit({ organizationId: null, actorUserId: userId, action: 'auth.password.changed', resourceType: 'user', resourceId: userId, result: 'SUCCESS', metadata: {} });
  }

  // ── Organizaciones y contexto ───────────────────────────────────────────────────────────────
  async listarMisOrganizaciones(userId: string): Promise<Array<{ organization: Organization; role: string }>> {
    return repo.organizacionesDeUsuario(this.pool, userId);
  }

  /** Crea una organización y hace al usuario OWNER (transaccional). El slug es la clave de tenant. */
  async crearOrganizacion(userId: string, slug: string, name: string): Promise<Organization> {
    const s = slug.trim().toLowerCase();
    if (!slugValido(s)) throw new EntradaInvalidaError('slug inválido (minúsculas, números y guiones)');
    if (!name.trim()) throw new EntradaInvalidaError('nombre requerido');
    if (await repo.organizacionPorSlug(this.pool, s)) throw new ConflictoError('el slug ya está en uso');
    return enTransaccion(this.pool, async (c) => {
      const org = await repo.crearOrganizacion(c, s, name.trim(), 'PILOT');
      await repo.crearMembresia(c, userId, org.id, 'OWNER', 'ACTIVE');
      await repo.registrarAuditoria(c, { organizationId: org.id, actorUserId: userId, action: 'organization.created', resourceType: 'organization', resourceId: org.id, result: 'SUCCESS', metadata: { slug: s } });
      return org;
    });
  }

  /**
   * AUTORIDAD MULTI-TENANT: resuelve el contexto de una organización identificada por `slug` para
   * un usuario. Si el usuario no tiene membresía ACTIVA en esa org, responde NoEncontrado (404) —
   * no revela la existencia de la organización.
   */
  async resolverContextoOrganizacion(user: User, slug: string): Promise<ContextoOrg> {
    const org = await repo.organizacionPorSlug(this.pool, slug);
    if (!org || org.status !== 'ACTIVE') throw new NoEncontradoError();
    const membership = await repo.membresiaActiva(this.pool, user.id, org.id);
    if (!membership) throw new NoEncontradoError(); // membresía inexistente ⇒ 404 (no filtra existencia)
    if (!esRol(membership.role)) throw new SinPermisoError('rol desconocido');
    return { user, organization: org, membership, permisos: permisosDeRol(membership.role) };
  }

  /** Exige un permiso en el contexto; lanza 403 si falta. */
  exigirPermiso(ctx: ContextoOrg, permiso: Permission): void {
    if (!ctx.permisos.has(permiso)) throw new SinPermisoError(`falta el permiso ${permiso}`);
  }

  async actualizarOrganizacion(ctx: ContextoOrg, name: string): Promise<Organization> {
    this.exigirPermiso(ctx, 'organization.manage');
    if (!name.trim()) throw new EntradaInvalidaError('nombre requerido');
    const org = await repo.actualizarOrganizacion(this.pool, ctx.organization.id, name.trim());
    await this.audit({ organizationId: org.id, actorUserId: ctx.user.id, action: 'organization.updated', resourceType: 'organization', resourceId: org.id, result: 'SUCCESS', metadata: {} });
    return org;
  }

  async cambiarModoOperativo(ctx: ContextoOrg, modo: string): Promise<Organization> {
    this.exigirPermiso(ctx, 'operational_mode.manage');
    if (!esModo(modo)) throw new EntradaInvalidaError('modo inválido');
    const activable = modoActivable(modo);
    if (!activable.ok) {
      await this.audit({ organizationId: ctx.organization.id, actorUserId: ctx.user.id, action: 'operational_mode.changed', resourceType: 'organization', resourceId: ctx.organization.id, result: 'DENIED', metadata: { modo } });
      throw new PoliticaError(activable.motivo);
    }
    const org = await repo.actualizarModoOrganizacion(this.pool, ctx.organization.id, modo);
    await this.audit({ organizationId: org.id, actorUserId: ctx.user.id, action: 'operational_mode.changed', resourceType: 'organization', resourceId: org.id, result: 'SUCCESS', metadata: { modo } });
    return org;
  }

  // ── Miembros / invitaciones ─────────────────────────────────────────────────────────────────
  async listarMiembros(ctx: ContextoOrg): Promise<Array<{ membership: Membership; email: string; displayName: string }>> {
    this.exigirPermiso(ctx, 'members.read');
    return repo.miembrosDeOrganizacion(this.pool, ctx.organization.id);
  }

  /** Invita un miembro. Devuelve el token en claro (para transporte fuera de banda; no se loguea). */
  async invitarMiembro(ctx: ContextoOrg, email: string, role: string): Promise<{ token: string }> {
    this.exigirPermiso(ctx, 'members.invite');
    const e = normalizarEmail(email);
    if (!e.includes('@')) throw new EntradaInvalidaError('email inválido');
    if (!esRol(role)) throw new EntradaInvalidaError('rol inválido');
    if (role === 'OWNER') throw new PoliticaError('no se puede invitar directamente como OWNER');
    const { token, tokenHash } = generarTokenSesion();
    await repo.crearInvitacion(this.pool, ctx.organization.id, e, role, tokenHash, ctx.user.id);
    await this.audit({ organizationId: ctx.organization.id, actorUserId: ctx.user.id, action: 'membership.invited', resourceType: 'invitation', resourceId: null, result: 'SUCCESS', metadata: { email: e, role } });
    return { token };
  }

  /** Acepta una invitación: crea el usuario si no existe y la membresía (transaccional). */
  async aceptarInvitacion(token: string, displayName: string, password: string): Promise<{ user: User; membership: Membership }> {
    const inv = await repo.invitacionVigentePorHash(this.pool, hashToken(token));
    if (!inv) throw new NoEncontradoError('invitación inválida o expirada');
    return enTransaccion(this.pool, async (c) => {
      let user = await repo.usuarioPorEmail(c, inv.email);
      if (!user) {
        if (!displayName.trim()) throw new EntradaInvalidaError('nombre requerido');
        user = await repo.crearUsuario(c, inv.email, displayName.trim(), hashPassword(password), 'ACTIVE');
      }
      const ya = await repo.membresiaActiva(c, user.id, inv.organizationId);
      if (ya) throw new ConflictoError('ya es miembro de la organización');
      const membership = await repo.crearMembresia(c, user.id, inv.organizationId, inv.role, 'ACTIVE');
      await repo.marcarInvitacionAceptada(c, inv.id);
      await repo.registrarAuditoria(c, { organizationId: inv.organizationId, actorUserId: user.id, action: 'membership.accepted', resourceType: 'membership', resourceId: membership.id, result: 'SUCCESS', metadata: { role: inv.role } });
      return { user, membership };
    });
  }

  private async membresiaDeLaOrg(ctx: ContextoOrg, membershipId: string): Promise<Membership> {
    const m = await repo.membresiaPorId(this.pool, membershipId);
    if (!m || m.organizationId !== ctx.organization.id) throw new NoEncontradoError('membresía no encontrada');
    return m;
  }

  async cambiarRolMiembro(ctx: ContextoOrg, membershipId: string, role: string): Promise<Membership> {
    this.exigirPermiso(ctx, 'members.manage');
    if (!esRol(role)) throw new EntradaInvalidaError('rol inválido');
    const m = await this.membresiaDeLaOrg(ctx, membershipId);
    if (m.role === 'OWNER') throw new PoliticaError('no se puede modificar el rol de un OWNER');
    const upd = await repo.actualizarRolMembresia(this.pool, m.id, role);
    await this.audit({ organizationId: ctx.organization.id, actorUserId: ctx.user.id, action: 'membership.role_changed', resourceType: 'membership', resourceId: m.id, result: 'SUCCESS', metadata: { role } });
    return upd;
  }

  async cambiarEstadoMiembro(ctx: ContextoOrg, membershipId: string, status: 'SUSPENDED' | 'REVOKED'): Promise<Membership> {
    this.exigirPermiso(ctx, 'members.manage');
    const m = await this.membresiaDeLaOrg(ctx, membershipId);
    if (m.role === 'OWNER') throw new PoliticaError('no se puede suspender/revocar un OWNER');
    const upd = await repo.actualizarEstadoMembresia(this.pool, m.id, status);
    await this.audit({ organizationId: ctx.organization.id, actorUserId: ctx.user.id, action: status === 'SUSPENDED' ? 'membership.suspended' : 'membership.revoked', resourceType: 'membership', resourceId: m.id, result: 'SUCCESS', metadata: {} });
    return upd;
  }

  // ── Auditoría ───────────────────────────────────────────────────────────────────────────────
  async listarAuditoria(ctx: ContextoOrg, limit = 50, offset = 0): Promise<AuditEvent[]> {
    this.exigirPermiso(ctx, 'audit.read');
    return repo.listarAuditoria(this.pool, ctx.organization.id, limit, offset);
  }

  /** Registro genérico de auditoría desde otras capas (p. ej. acceso cruzado denegado). */
  async auditar(e: Omit<AuditEvent, 'id' | 'createdAt'>): Promise<void> {
    await this.audit(e);
  }
}

export { rolTienePermiso };
