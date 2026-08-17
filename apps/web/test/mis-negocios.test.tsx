import { afterEach, describe, expect, it, vi } from 'vitest';
import { listarMisNegocios } from '../lib/mis-negocios';

/** Respuesta simulada de `/api/backend/auth/me`. */
function mockMe(status: number, body: unknown): void {
  global.fetch = vi.fn().mockResolvedValue({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }) as unknown as typeof fetch;
}

afterEach(() => vi.restoreAllMocks());

describe('listarMisNegocios · negocios desde identidad (por membresía)', () => {
  it('mapea las organizaciones del usuario; no inventa modelo/mercado/métricas', async () => {
    mockMe(200, {
      user: { id: 'u1', email: 'a@b.cl', displayName: 'A', status: 'ACTIVE' },
      organizaciones: [{ slug: 'smileflow', name: 'SmileFlow', role: 'OWNER', operationalMode: 'PILOT' }],
    });
    const negocios = await listarMisNegocios();
    expect(negocios).toHaveLength(1);
    expect(negocios[0]).toEqual({
      organizationId: 'smileflow',
      displayName: 'SmileFlow',
      estado: 'CREATED',
      modeloDeNegocio: '',
      mercado: '',
    });
  });

  it('sin sesión (401) ⇒ lista vacía, nunca un negocio por defecto', async () => {
    mockMe(401, {});
    expect(await listarMisNegocios()).toEqual([]);
  });

  it('sólo lista las organizaciones que devuelve /auth/me (filtrado por membresía en el backend)', async () => {
    mockMe(200, {
      user: { id: 'u1', email: 'a@b.cl', displayName: 'A', status: 'ACTIVE' },
      organizaciones: [
        { slug: 'smileflow', name: 'SmileFlow', role: 'OWNER', operationalMode: 'PILOT' },
        { slug: 'otra', name: 'Otra', role: 'ADMIN', operationalMode: 'PILOT' },
      ],
    });
    const negocios = await listarMisNegocios();
    expect(negocios.map((n) => n.organizationId)).toEqual(['smileflow', 'otra']);
  });
});
