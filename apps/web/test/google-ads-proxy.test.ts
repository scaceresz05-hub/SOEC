// @vitest-environment node
/**
 * REPAIR ACCOUNT_SELECTION_PENDING — el proxy BFF /api/google-ads debe permitir `accounts` por GET (discovery
 * READ ONLY) además de POST (compat). Antes, GET accounts caía en el 404 del proxy y el listado no llegaba a la API.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { GET, POST } from '../app/api/google-ads/[...accion]/route';

afterEach(() => vi.unstubAllGlobals());

function stubFetch(): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, datos: { cuentas: [] } }) }));
  vi.stubGlobal('fetch', fn);
  return fn;
}
const upstream = (fn: ReturnType<typeof vi.fn>): string => String(fn.mock.calls[0]?.[0] ?? '');
const req = (path: string, method = 'GET'): Request => new Request(`http://web/api/google-ads/${path}`, method === 'GET' ? {} : { method, headers: { 'content-type': 'application/json' }, body: '{}' });

describe('proxy BFF /api/google-ads', () => {
  it('GET accounts ya NO da 404: reenvía a /acquisition/google-ads/accounts', async () => {
    const fn = stubFetch();
    const res = await GET(req('accounts'), { params: Promise.resolve({ accion: ['accounts'] }) });
    expect(res.status).toBe(200);
    expect(upstream(fn)).toContain('/acquisition/google-ads/accounts');
  });
  it('GET connection sigue permitido', async () => {
    const fn = stubFetch();
    const res = await GET(req('connection'), { params: Promise.resolve({ accion: ['connection'] }) });
    expect(res.status).toBe(200);
    expect(upstream(fn)).toContain('/acquisition/google-ads/connection');
  });
  it('GET ruta desconocida ⇒ 404 (allowlist fail-closed)', async () => {
    const fn = stubFetch();
    const res = await GET(req('refresh'), { params: Promise.resolve({ accion: ['refresh'] }) }); // refresh es POST-only
    expect(res.status).toBe(404);
    expect(fn).not.toHaveBeenCalled();
  });
  it('POST accounts sigue permitido (compat)', async () => {
    const fn = stubFetch();
    const res = await POST(req('accounts', 'POST'), { params: Promise.resolve({ accion: ['accounts'] }) });
    expect(res.status).toBe(200);
    expect(upstream(fn)).toContain('/acquisition/google-ads/accounts');
  });
  it('POST select-account (mutación de conexión) permitido', async () => {
    const fn = stubFetch();
    const res = await POST(req('select-account', 'POST'), { params: Promise.resolve({ accion: ['select-account'] }) });
    expect(res.status).toBe(200);
    expect(upstream(fn)).toContain('/acquisition/google-ads/select-account');
  });
});
