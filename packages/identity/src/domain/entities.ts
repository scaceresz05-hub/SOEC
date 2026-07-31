/**
 * @soec/identity · dominio · Entidades del plano de identidad (relacional).
 * Nunca contienen secretos en claro: la contraseña se guarda hasheada; el token de sesión sólo
 * como hash. La organización relacional es la autoridad; su `slug` es la clave de tenant que
 * coincide con el `organizationId` de los streams del event-store.
 */
import { createHash, randomBytes } from 'node:crypto';

export type UserStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'DISABLED';
export type OrgStatus = 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
export type MembershipStatus = 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'REVOKED';

export interface User {
  readonly id: string;
  readonly email: string; // normalizado
  readonly displayName: string;
  readonly passwordHash: string;
  readonly status: UserStatus;
  readonly emailVerifiedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Organization {
  readonly id: string;
  readonly slug: string; // clave de tenant (== organizationId del event-store)
  readonly name: string;
  readonly status: OrgStatus;
  readonly operationalMode: 'PILOT' | 'SUPERVISED_REAL' | 'AUTONOMOUS_REAL';
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Membership {
  readonly id: string;
  readonly userId: string;
  readonly organizationId: string;
  readonly role: string;
  readonly status: MembershipStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Session {
  readonly id: string;
  readonly userId: string;
  readonly expiresAt: string;
  readonly revokedAt: string | null;
  readonly createdAt: string;
  readonly lastSeenAt: string;
}

export interface Invitation {
  readonly id: string;
  readonly organizationId: string;
  readonly email: string;
  readonly role: string;
  readonly expiresAt: string;
  readonly acceptedAt: string | null;
  readonly revokedAt: string | null;
  readonly invitedBy: string;
}

export interface AuditEvent {
  readonly id: string;
  readonly organizationId: string | null;
  readonly actorUserId: string | null;
  readonly action: string;
  readonly resourceType: string | null;
  readonly resourceId: string | null;
  readonly result: 'SUCCESS' | 'DENIED' | 'FAILED';
  readonly metadata: Record<string, unknown>;
  readonly createdAt: string;
}

/** Normaliza un email para unicidad y comparación (lower + trim). */
export function normalizarEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Genera un token de sesión opaco y su hash almacenable (nunca se guarda el token en claro). */
export function generarTokenSesion(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}

/** Hash determinista (SHA-256) de un token, para almacenar/buscar sin guardar el token en claro. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** slug válido: minúsculas, números y guiones. */
export function slugValido(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,62}$/.test(slug);
}
