/**
 * Cliente de administración de organización (vía proxy autenticado /api/backend/*). La sesión viaja
 * en cookie httpOnly; toda la autoridad la resuelve la API por sesión + membresía. Aquí solo se
 * transporta la intención. Nunca se manejan tokens ni contraseñas en almacenamiento del navegador.
 */
export interface OrgDetalle {
  slug: string;
  name: string;
  operationalMode: string;
  role: string;
  permisos: string[];
}
export interface Miembro {
  membershipId: string;
  email: string;
  displayName: string;
  role: string;
  status: string;
}
export interface EventoAuditoria {
  id: string;
  action: string;
  actorUserId: string | null;
  resourceType: string | null;
  result: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

async function req<T>(ruta: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', body?: unknown): Promise<T> {
  const init: RequestInit = { method, headers: { 'content-type': 'application/json' }, cache: 'no-store' };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(`/api/backend/${ruta}`, init);
  if (!res.ok) {
    const c = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    throw new Error(c.message ?? c.error ?? `error ${res.status}`);
  }
  return (await res.json()) as T;
}

export const ROLES_ASIGNABLES = ['ADMIN', 'MARKETING_MANAGER', 'MARKETING_OPERATOR', 'ANALYST', 'VIEWER'] as const;
export const MODOS = ['PILOT', 'SUPERVISED_REAL'] as const; // AUTONOMOUS_REAL está bloqueado por dominio

export const detalleOrg = (slug: string) => req<OrgDetalle>(`organizations/${slug}`, 'GET');
export const listarMiembros = (slug: string) => req<{ miembros: Miembro[] }>(`organizations/${slug}/members`, 'GET');
export const invitar = (slug: string, email: string, role: string) => req<{ invitada: boolean; devToken?: string }>(`organizations/${slug}/invitations`, 'POST', { email, role });
export const cambiarRol = (slug: string, membershipId: string, role: string) => req<{ membershipId: string; role: string }>(`organizations/${slug}/members/${membershipId}`, 'PATCH', { role });
export const revocarMiembro = (slug: string, membershipId: string) => req<{ membershipId: string; status: string }>(`organizations/${slug}/members/${membershipId}`, 'DELETE');
export const listarAuditoria = (slug: string, limit = 50) => req<{ eventos: EventoAuditoria[] }>(`organizations/${slug}/audit?limit=${limit}`, 'GET');
export const cambiarModo = (slug: string, mode: string) => req<{ slug: string; operationalMode: string }>(`organizations/${slug}/operational-mode`, 'PATCH', { mode });
export const renombrarOrg = (slug: string, name: string) => req<{ slug: string; name: string }>(`organizations/${slug}`, 'PATCH', { name });
export const cambiarPassword = (actual: string, nueva: string) => req<{ ok: boolean }>('auth/change-password', 'POST', { actual, nueva });
