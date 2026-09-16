// @vitest-environment node
/**
 * CONTRATO del proxy BFF `/api/medicion/*`.
 *
 *   1. Toda ruta literal `/api/medicion/...` que la web llama tiene un handler BFF que la sirve con ese
 *      método. Así se detectó tarde que la pantalla Decisiones pedía `/api/medicion/decisiones` y el
 *      proxy respondía 404 aunque la API servía `/medicion/decisiones`.
 *   2. `/api/medicion/decisiones[/aprobar|rechazar|ajustar]` llega a la API existente con la misma
 *      cookie, la misma organización, el mismo método y el mismo manejo de error que el resto.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET as getDecisiones } from '../app/api/medicion/decisiones/route';
import { POST as postDecision } from '../app/api/medicion/decisiones/[accion]/route';
import { GET as getAccion, POST as postAccion } from '../app/api/medicion/[accion]/route';

const WEB = join(__dirname, '..');
afterEach(() => vi.unstubAllGlobals());

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    if (n === 'node_modules' || n === '.next' || n === 'test') return [];
    const p = join(dir, n);
    return statSync(p).isDirectory() ? archivos(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

/** Llamadas literales (sin plantilla) a `/api/medicion/...`, con su método (POST si el fetch lo declara o si pasa por `accionar`). */
function llamadasLiterales(): { ruta: string; metodo: 'GET' | 'POST'; archivo: string }[] {
  const out: { ruta: string; metodo: 'GET' | 'POST'; archivo: string }[] = [];
  for (const f of archivos(WEB)) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/(fetch|accionar)\(\s*['`](\/api\/medicion\/[a-z0-9\-/]+)['`]([^\n]*)/g)) {
      const metodo = m[1] === 'accionar' || /method:\s*['"]POST['"]/.test(m[3] ?? '') ? 'POST' : 'GET';
      out.push({ ruta: m[2]!, metodo, archivo: relative(WEB, f) });
    }
  }
  return out;
}

function stubFetch(status = 200, cuerpo: unknown = { ok: true }) {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: status < 400, status, json: async () => cuerpo }));
  vi.stubGlobal('fetch', fn);
  return fn;
}
const peticion = (url: string, init: RequestInit = {}) =>
  new Request(url, { ...init, headers: { cookie: 'soec_session=abc', 'x-organization-slug': 'smileflow', ...(init.headers as Record<string, string> | undefined) } });

async function servir(ruta: string, metodo: 'GET' | 'POST'): Promise<number> {
  stubFetch();
  const seg = ruta.replace('/api/medicion/', '').split('/');
  const req = peticion(`http://web${ruta}`, metodo === 'POST' ? { method: 'POST', body: '{}' } : {});
  if (seg[0] === 'decisiones') {
    if (seg.length === 1) return metodo === 'GET' ? (await getDecisiones(req)).status : 405;
    return metodo === 'POST' && seg.length === 2 ? (await postDecision(req, { params: Promise.resolve({ accion: seg[1]! }) })).status : 405;
  }
  if (seg.length !== 1) return 404;
  const ctx = { params: Promise.resolve({ accion: seg[0]! }) };
  return (metodo === 'GET' ? await getAccion(req, ctx) : await postAccion(req, ctx)).status;
}

describe('contrato · toda llamada literal de la web a /api/medicion tiene proxy', () => {
  it('encuentra las llamadas de la pantalla Decisiones (el escaneo no está vacío)', () => {
    const rutas = llamadasLiterales().map((l) => `${l.metodo} ${l.ruta}`);
    expect(rutas).toContain('GET /api/medicion/decisiones');
    expect(rutas).toContain('POST /api/medicion/decisiones/aprobar');
    expect(rutas).toContain('POST /api/medicion/decisiones/rechazar');
    expect(rutas).toContain('POST /api/medicion/decisiones/ajustar');
  });

  it('ninguna responde 404/405 en el BFF', async () => {
    const sinProxy: string[] = [];
    for (const l of llamadasLiterales()) {
      const s = await servir(l.ruta, l.metodo);
      if (s === 404 || s === 405) sinProxy.push(`${l.metodo} ${l.ruta} (${l.archivo})`);
    }
    expect(sinProxy).toEqual([]);
  });

  it('la API sirve las rutas de decisiones a las que apunta el proxy (no se inventa backend)', () => {
    const api = readFileSync(join(WEB, '../api/src/measurement-routes.ts'), 'utf8');
    expect(api).toContain("app.get('/medicion/decisiones'");
    for (const a of ['aprobar', 'rechazar', 'ajustar']) expect(api).toContain(`app.post('/medicion/decisiones/${a}'`);
  });
});

describe('proxy /api/medicion/decisiones', () => {
  it('GET reenvía a /medicion/decisiones con cookie, organización, método y sin caché', async () => {
    const fn = stubFetch(200, { ok: true, current: null, history: [] });
    const r = await getDecisiones(peticion('http://web/api/medicion/decisiones'));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, current: null, history: [] });
    const [url, init] = fn.mock.calls[0]!;
    expect(url).toMatch(/\/medicion\/decisiones$/);
    expect(init?.method).toBe('GET');
    expect(init?.cache).toBe('no-store');
    expect(init?.body).toBeUndefined();
    expect(init?.headers).toMatchObject({ cookie: 'soec_session=abc', 'x-organization-slug': 'smileflow' });
  });

  it('GET propaga el estado de la API (403 de permisos) sin maquillarlo', async () => {
    stubFetch(403, { ok: false, error: 'NO_AUTORIZADO' });
    const r = await getDecisiones(peticion('http://web/api/medicion/decisiones'));
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ ok: false, error: 'NO_AUTORIZADO' });
  });

  it('POST aprobar/rechazar/ajustar reenvía el cuerpo tal cual a /medicion/decisiones/<accion>', async () => {
    for (const accion of ['aprobar', 'rechazar', 'ajustar']) {
      const fn = stubFetch(201, { ok: true });
      const cuerpo = { decisionId: 'd1', planHash: 'h1' };
      const r = await postDecision(
        peticion(`http://web/api/medicion/decisiones/${accion}`, { method: 'POST', body: JSON.stringify(cuerpo) }),
        { params: Promise.resolve({ accion }) },
      );
      expect(r.status).toBe(201);
      const [url, init] = fn.mock.calls[0]!;
      expect(url).toMatch(new RegExp(`/medicion/decisiones/${accion}$`));
      expect(init?.method).toBe('POST');
      expect(JSON.parse(String(init?.body))).toEqual(cuerpo);
      expect(init?.headers).toMatchObject({ cookie: 'soec_session=abc', 'x-organization-slug': 'smileflow' });
    }
  });

  it('POST de una acción desconocida no llega a la API', async () => {
    const fn = stubFetch();
    const r = await postDecision(peticion('http://web/api/medicion/decisiones/ejecutar', { method: 'POST', body: '{}' }), { params: Promise.resolve({ accion: 'ejecutar' }) });
    expect(r.status).toBe(404);
    expect(fn).not.toHaveBeenCalled();
  });

  it('API caída ⇒ 502 ApiUnreachable, igual que el resto del proxy', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const r = await getDecisiones(peticion('http://web/api/medicion/decisiones'));
    expect(r.status).toBe(502);
    expect(await r.json()).toMatchObject({ error: 'ApiUnreachable' });
  });
});
