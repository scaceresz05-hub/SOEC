/**
 * @soec/identity · repositorios PostgreSQL. Queries parametrizadas (sin interpolación de strings),
 * mapeo fila→dominio, y soporte transaccional (aceptan Pool o PoolClient). Los timestamps y
 * vencimientos se calculan en la base (`now()`), no en el reloj del cliente.
 */
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { AuditEvent, Invitation, Membership, Organization, Session, User } from '../domain/entities';

export type Queryable = Pool | PoolClient;

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
const isoN = (v: unknown): string | null => (v == null ? null : iso(v));

function aUser(r: Record<string, unknown>): User {
  return { id: r.id as string, email: r.email as string, displayName: r.display_name as string, passwordHash: r.password_hash as string, status: r.status as User['status'], emailVerifiedAt: isoN(r.email_verified_at), createdAt: iso(r.created_at), updatedAt: iso(r.updated_at) };
}
function aOrg(r: Record<string, unknown>): Organization {
  return { id: r.id as string, slug: r.slug as string, name: r.name as string, status: r.status as Organization['status'], operationalMode: r.operational_mode as Organization['operationalMode'], createdAt: iso(r.created_at), updatedAt: iso(r.updated_at) };
}
function aMembership(r: Record<string, unknown>): Membership {
  return { id: r.id as string, userId: r.user_id as string, organizationId: r.organization_id as string, role: r.role as string, status: r.status as Membership['status'], createdAt: iso(r.created_at), updatedAt: iso(r.updated_at) };
}
function aSession(r: Record<string, unknown>): Session {
  return { id: r.id as string, userId: r.user_id as string, expiresAt: iso(r.expires_at), revokedAt: isoN(r.revoked_at), createdAt: iso(r.created_at), lastSeenAt: iso(r.last_seen_at) };
}
function aInvitation(r: Record<string, unknown>): Invitation {
  return { id: r.id as string, organizationId: r.organization_id as string, email: r.email as string, role: r.role as string, expiresAt: iso(r.expires_at), acceptedAt: isoN(r.accepted_at), revokedAt: isoN(r.revoked_at), invitedBy: r.invited_by as string };
}
function aAudit(r: Record<string, unknown>): AuditEvent {
  return { id: r.id as string, organizationId: (r.organization_id as string) ?? null, actorUserId: (r.actor_user_id as string) ?? null, action: r.action as string, resourceType: (r.resource_type as string) ?? null, resourceId: (r.resource_id as string) ?? null, result: r.result as AuditEvent['result'], metadata: (r.metadata as Record<string, unknown>) ?? {}, createdAt: iso(r.created_at) };
}

// ── Usuarios ───────────────────────────────────────────────────────────────────────────────────
export async function crearUsuario(q: Queryable, email: string, displayName: string, passwordHash: string, status: User['status'] = 'ACTIVE'): Promise<User> {
  const r = await q.query('insert into identity_users (id, email, display_name, password_hash, status) values ($1,$2,$3,$4,$5) returning *', [randomUUID(), email, displayName, passwordHash, status]);
  return aUser(r.rows[0]);
}
export async function usuarioPorEmail(q: Queryable, email: string): Promise<User | null> {
  const r = await q.query('select * from identity_users where email = $1', [email]);
  return r.rows[0] ? aUser(r.rows[0]) : null;
}
export async function usuarioPorId(q: Queryable, id: string): Promise<User | null> {
  const r = await q.query('select * from identity_users where id = $1', [id]);
  return r.rows[0] ? aUser(r.rows[0]) : null;
}
export async function actualizarPasswordUsuario(q: Queryable, id: string, passwordHash: string): Promise<void> {
  await q.query('update identity_users set password_hash = $2, updated_at = now() where id = $1', [id, passwordHash]);
}

// ── Organizaciones ───────────────────────────────────────────────────────────────────────────────
export async function crearOrganizacion(q: Queryable, slug: string, name: string, operationalMode = 'PILOT'): Promise<Organization> {
  const r = await q.query('insert into identity_organizations (id, slug, name, operational_mode) values ($1,$2,$3,$4) returning *', [randomUUID(), slug, name, operationalMode]);
  return aOrg(r.rows[0]);
}
export async function organizacionPorSlug(q: Queryable, slug: string): Promise<Organization | null> {
  const r = await q.query('select * from identity_organizations where slug = $1', [slug]);
  return r.rows[0] ? aOrg(r.rows[0]) : null;
}
export async function organizacionPorId(q: Queryable, id: string): Promise<Organization | null> {
  const r = await q.query('select * from identity_organizations where id = $1', [id]);
  return r.rows[0] ? aOrg(r.rows[0]) : null;
}
export async function actualizarModoOrganizacion(q: Queryable, id: string, modo: string): Promise<Organization> {
  const r = await q.query('update identity_organizations set operational_mode = $2, updated_at = now() where id = $1 returning *', [id, modo]);
  return aOrg(r.rows[0]);
}
export async function actualizarOrganizacion(q: Queryable, id: string, name: string): Promise<Organization> {
  const r = await q.query('update identity_organizations set name = $2, updated_at = now() where id = $1 returning *', [id, name]);
  return aOrg(r.rows[0]);
}

// ── Membresías ───────────────────────────────────────────────────────────────────────────────────
export async function crearMembresia(q: Queryable, userId: string, organizationId: string, role: string, status: Membership['status'] = 'ACTIVE'): Promise<Membership> {
  const r = await q.query('insert into identity_memberships (id, user_id, organization_id, role, status) values ($1,$2,$3,$4,$5) returning *', [randomUUID(), userId, organizationId, role, status]);
  return aMembership(r.rows[0]);
}
export async function membresiaActiva(q: Queryable, userId: string, organizationId: string): Promise<Membership | null> {
  const r = await q.query("select * from identity_memberships where user_id = $1 and organization_id = $2 and status = 'ACTIVE'", [userId, organizationId]);
  return r.rows[0] ? aMembership(r.rows[0]) : null;
}
export async function membresiaPorId(q: Queryable, id: string): Promise<Membership | null> {
  const r = await q.query('select * from identity_memberships where id = $1', [id]);
  return r.rows[0] ? aMembership(r.rows[0]) : null;
}
/** Organizaciones ACTIVAS del usuario (con membresía ACTIVA). */
export async function organizacionesDeUsuario(q: Queryable, userId: string): Promise<Array<{ organization: Organization; role: string }>> {
  const r = await q.query("select o.*, m.role as m_role from identity_memberships m join identity_organizations o on o.id = m.organization_id where m.user_id = $1 and m.status = 'ACTIVE' and o.status = 'ACTIVE' order by o.name", [userId]);
  return r.rows.map((row) => ({ organization: aOrg(row), role: row.m_role as string }));
}
export async function miembrosDeOrganizacion(q: Queryable, organizationId: string): Promise<Array<{ membership: Membership; email: string; displayName: string }>> {
  const r = await q.query('select m.*, u.email, u.display_name from identity_memberships m join identity_users u on u.id = m.user_id where m.organization_id = $1 order by u.email', [organizationId]);
  return r.rows.map((row) => ({ membership: aMembership(row), email: row.email as string, displayName: row.display_name as string }));
}
export async function actualizarRolMembresia(q: Queryable, id: string, role: string): Promise<Membership> {
  const r = await q.query('update identity_memberships set role = $2, updated_at = now() where id = $1 returning *', [id, role]);
  return aMembership(r.rows[0]);
}
export async function actualizarEstadoMembresia(q: Queryable, id: string, status: Membership['status']): Promise<Membership> {
  const r = await q.query('update identity_memberships set status = $2, updated_at = now() where id = $1 returning *', [id, status]);
  return aMembership(r.rows[0]);
}

// ── Sesiones ───────────────────────────────────────────────────────────────────────────────────
export async function crearSesion(q: Queryable, userId: string, tokenHash: string, ttlHoras = 24 * 7): Promise<Session> {
  const r = await q.query(`insert into identity_sessions (id, user_id, token_hash, expires_at) values ($1,$2,$3, now() + ($4 || ' hours')::interval) returning *`, [randomUUID(), userId, tokenHash, String(ttlHoras)]);
  return aSession(r.rows[0]);
}
/** Sesión vigente por hash de token (no vencida, no revocada) + su usuario. */
export async function sesionVigentePorHash(q: Queryable, tokenHash: string): Promise<{ session: Session; user: User } | null> {
  const r = await q.query('select s.*, u.id as u_id, u.email, u.display_name, u.password_hash, u.status as u_status, u.email_verified_at, u.created_at as u_created, u.updated_at as u_updated from identity_sessions s join identity_users u on u.id = s.user_id where s.token_hash = $1 and s.revoked_at is null and s.expires_at > now()', [tokenHash]);
  const row = r.rows[0];
  if (!row) return null;
  const user = aUser({ id: row.u_id, email: row.email, display_name: row.display_name, password_hash: row.password_hash, status: row.u_status, email_verified_at: row.email_verified_at, created_at: row.u_created, updated_at: row.u_updated });
  return { session: aSession(row), user };
}
export async function tocarSesion(q: Queryable, id: string): Promise<void> {
  await q.query('update identity_sessions set last_seen_at = now() where id = $1', [id]);
}
export async function revocarSesion(q: Queryable, id: string): Promise<void> {
  await q.query('update identity_sessions set revoked_at = now() where id = $1 and revoked_at is null', [id]);
}
export async function revocarSesionesDeUsuario(q: Queryable, userId: string): Promise<number> {
  const r = await q.query('update identity_sessions set revoked_at = now() where user_id = $1 and revoked_at is null', [userId]);
  return r.rowCount ?? 0;
}

// ── Invitaciones ─────────────────────────────────────────────────────────────────────────────────
export async function crearInvitacion(q: Queryable, organizationId: string, email: string, role: string, tokenHash: string, invitedBy: string, ttlHoras = 24 * 7): Promise<Invitation> {
  const r = await q.query(`insert into identity_invitations (id, organization_id, email, role, token_hash, invited_by, expires_at) values ($1,$2,$3,$4,$5,$6, now() + ($7 || ' hours')::interval) returning *`, [randomUUID(), organizationId, email, role, tokenHash, invitedBy, String(ttlHoras)]);
  return aInvitation(r.rows[0]);
}
export async function invitacionVigentePorHash(q: Queryable, tokenHash: string): Promise<Invitation | null> {
  const r = await q.query('select * from identity_invitations where token_hash = $1 and accepted_at is null and revoked_at is null and expires_at > now()', [tokenHash]);
  return r.rows[0] ? aInvitation(r.rows[0]) : null;
}
export async function marcarInvitacionAceptada(q: Queryable, id: string): Promise<void> {
  await q.query('update identity_invitations set accepted_at = now() where id = $1', [id]);
}

// ── Restablecimiento de contraseña ──────────────────────────────────────────────────────────────
export async function crearPasswordReset(q: Queryable, userId: string, tokenHash: string, ttlMin = 30): Promise<{ id: string; expiresAt: string }> {
  const r = await q.query(`insert into identity_password_resets (id, user_id, token_hash, expires_at) values ($1,$2,$3, now() + ($4 || ' minutes')::interval) returning id, expires_at`, [randomUUID(), userId, tokenHash, String(ttlMin)]);
  return { id: r.rows[0].id as string, expiresAt: iso(r.rows[0].expires_at) };
}
/** Reset vigente por hash (no usado, no vencido) + el usuario asociado. */
export async function passwordResetVigentePorHash(q: Queryable, tokenHash: string): Promise<{ id: string; user: User } | null> {
  const r = await q.query('select pr.id as pr_id, u.* from identity_password_resets pr join identity_users u on u.id = pr.user_id where pr.token_hash = $1 and pr.used_at is null and pr.expires_at > now()', [tokenHash]);
  const row = r.rows[0];
  if (!row) return null;
  return { id: row.pr_id as string, user: aUser(row) };
}
export async function marcarPasswordResetUsado(q: Queryable, id: string): Promise<void> {
  await q.query('update identity_password_resets set used_at = now() where id = $1', [id]);
}
/** Invalida los resets pendientes de un usuario (al emitir uno nuevo o tras cambiar la contraseña). */
export async function invalidarResetsDeUsuario(q: Queryable, userId: string): Promise<void> {
  await q.query('update identity_password_resets set used_at = now() where user_id = $1 and used_at is null', [userId]);
}

// ── Auditoría ─────────────────────────────────────────────────────────────────────────────────────
export async function registrarAuditoria(q: Queryable, e: Omit<AuditEvent, 'id' | 'createdAt'>): Promise<void> {
  await q.query('insert into identity_audit_events (id, organization_id, actor_user_id, action, resource_type, resource_id, result, metadata) values ($1,$2,$3,$4,$5,$6,$7,$8)', [randomUUID(), e.organizationId, e.actorUserId, e.action, e.resourceType, e.resourceId, e.result, JSON.stringify(e.metadata ?? {})]);
}
export async function listarAuditoria(q: Queryable, organizationId: string, limit: number, offset: number): Promise<AuditEvent[]> {
  const r = await q.query('select * from identity_audit_events where organization_id = $1 order by created_at desc limit $2 offset $3', [organizationId, Math.min(Math.max(limit, 1), 100), Math.max(offset, 0)]);
  return r.rows.map(aAudit);
}
