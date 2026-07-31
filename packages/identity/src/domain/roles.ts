/**
 * @soec/identity · dominio · Roles y permisos.
 *
 * La autorización SIEMPRE consulta permisos EFECTIVOS (nunca compara strings de rol dispersos).
 * Los roles agrupan permisos atómicos; `permisosDeRol` es la única fuente de esa expansión.
 */

/** Permisos atómicos del plano comercial. */
export type Permission =
  | 'organization.read'
  | 'organization.manage'
  | 'members.read'
  | 'members.invite'
  | 'members.manage'
  | 'business.read'
  | 'business.manage'
  | 'program.read'
  | 'program.manage'
  | 'campaign.read'
  | 'campaign.manage'
  | 'content.review'
  | 'content.approve'
  | 'budget.read'
  | 'budget.manage'
  | 'execution.read'
  | 'execution.approve'
  | 'analytics.read'
  | 'audit.read'
  | 'operational_mode.manage';

export type Role = 'OWNER' | 'ADMIN' | 'MARKETING_MANAGER' | 'MARKETING_OPERATOR' | 'ANALYST' | 'VIEWER';

export const ROLES: readonly Role[] = ['OWNER', 'ADMIN', 'MARKETING_MANAGER', 'MARKETING_OPERATOR', 'ANALYST', 'VIEWER'];

const LECTURA: readonly Permission[] = ['organization.read', 'members.read', 'business.read', 'program.read', 'campaign.read', 'budget.read', 'execution.read', 'analytics.read'];

/** Mapa rol → permisos. Único punto de expansión. */
const MAPA: Readonly<Record<Role, readonly Permission[]>> = {
  OWNER: [
    ...LECTURA,
    'organization.manage', 'members.invite', 'members.manage', 'business.manage', 'program.manage',
    'campaign.manage', 'content.review', 'content.approve', 'budget.manage', 'execution.approve',
    'audit.read', 'operational_mode.manage',
  ],
  ADMIN: [
    ...LECTURA,
    'organization.manage', 'members.invite', 'members.manage', 'business.manage', 'program.manage',
    'campaign.manage', 'content.review', 'content.approve', 'budget.manage', 'execution.approve',
    'audit.read',
  ],
  MARKETING_MANAGER: [
    ...LECTURA,
    'business.manage', 'program.manage', 'campaign.manage', 'content.review', 'content.approve',
    'budget.manage', 'execution.approve',
  ],
  MARKETING_OPERATOR: [...LECTURA, 'program.manage', 'campaign.manage', 'content.review'],
  ANALYST: [...LECTURA, 'audit.read'],
  VIEWER: [...LECTURA],
};

export function esRol(v: string): v is Role {
  return (ROLES as readonly string[]).includes(v);
}

/** Permisos efectivos de un rol. */
export function permisosDeRol(role: Role): ReadonlySet<Permission> {
  return new Set(MAPA[role]);
}

/** ¿El rol concede el permiso? */
export function rolTienePermiso(role: Role, permiso: Permission): boolean {
  return MAPA[role].includes(permiso);
}
