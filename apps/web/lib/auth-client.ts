/** Cliente de autenticación (vía proxy autenticado /api/backend/*). La sesión viaja en cookie. */
export interface UsuarioSesion {
  user: { id: string; email: string; displayName: string; status: string };
  organizaciones: { slug: string; name: string; role: string; operationalMode: string }[];
}

async function post<T>(ruta: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/backend/${ruta}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  if (!res.ok) {
    const c = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    throw new Error(c.message ?? c.error ?? `error ${res.status}`);
  }
  return (await res.json()) as T;
}

export const login = (email: string, password: string) => post<{ user: UsuarioSesion['user'] }>('auth/login', { email, password });
export const registrar = (email: string, displayName: string, password: string) => post<{ user: UsuarioSesion['user'] }>('auth/register', { email, displayName, password });
export const logout = () => post<{ ok: boolean }>('auth/logout', {});

export async function yo(): Promise<UsuarioSesion | null> {
  const res = await fetch('/api/backend/auth/me', { cache: 'no-store' });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error('error al consultar la sesión');
  return (await res.json()) as UsuarioSesion;
}

export const crearOrganizacion = (slug: string, name: string) => post<{ slug: string }>('organizations', { slug, name });
