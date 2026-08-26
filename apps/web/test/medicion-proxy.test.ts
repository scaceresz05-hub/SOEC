// @vitest-environment node
/**
 * El proxy BFF de /api/medicion debe PRESERVAR el query string (?detail=intents). Sin esto la API recibe la
 * ruta sin parámetros y la rama de detalle nunca corre (bug productivo de Fase 2A inspeccionable).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { GET } from '../app/api/medicion/[accion]/route';

afterEach(() => vi.unstubAllGlobals());

function stubFetch(): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ intents: [] }) }));
  vi.stubGlobal('fetch', fn);
  return fn;
}
const upstream = (fn: ReturnType<typeof vi.fn>): string => String(fn.mock.calls[0]?.[0] ?? '');

describe('proxy BFF /api/medicion — preservación de query', () => {
  it('reenvía ?detail=intents al upstream', async () => {
    const fn = stubFetch();
    await GET(new Request('http://web/api/medicion/execution-plan?detail=intents'), { params: Promise.resolve({ accion: 'execution-plan' }) });
    expect(upstream(fn)).toContain('/medicion/execution-plan');
    expect(upstream(fn)).toContain('detail=intents');
  });
  it('sin query ⇒ upstream sin parámetros (compat)', async () => {
    const fn = stubFetch();
    await GET(new Request('http://web/api/medicion/execution-plan'), { params: Promise.resolve({ accion: 'execution-plan' }) });
    expect(upstream(fn)).toContain('/medicion/execution-plan');
    expect(upstream(fn)).not.toContain('detail=');
  });
});
