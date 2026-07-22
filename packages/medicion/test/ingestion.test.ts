import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { buildEmulador, EstadoEmulador, TOKEN_DEMO } from '@soec/canal-emulado';
import { FuenteMetricasEmulada } from '../src/app/metrics-source';

const estado = new EstadoEmulador();
const { app } = buildEmulador(estado);
let fuente: FuenteMetricasEmulada;

async function crearPost(): Promise<string> {
  const r = estado.nuevoId('cuenta-demo');
  estado.posts.set(r, { externalId: r, idempotencyKey: null, account: 'cuenta-demo', status: 'published', content: 'x', title: '', requiereArchivoReal: false, createdAt: '2026-07-21T00:00:00.000Z', publishedAt: '2026-07-21T00:00:00.000Z' });
  return r;
}

beforeAll(async () => {
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address() as AddressInfo;
  fuente = new FuenteMetricasEmulada(`http://127.0.0.1:${addr.port}`, 1500);
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => estado.reset());

describe('Ingesta de métricas contra el proveedor emulado (frontera HTTP real)', () => {
  it('obtiene métricas de una publicación por HTTP (escenario alto)', async () => {
    const ref = await crearPost();
    estado.setEscenarioMetricas('alto');
    const filas = await fuente.obtenerDe(TOKEN_DEMO, 'cuenta-demo', ref);
    expect(filas.length).toBeGreaterThan(0);
    expect(filas.some((f) => f.metrica === 'impresiones' && f.valor > 0)).toBe(true);
  });

  it('sin datos: el escenario sin_datos devuelve un lote vacío (no es fracaso)', async () => {
    await crearPost();
    estado.setEscenarioMetricas('sin_datos');
    const lote = await fuente.obtener(TOKEN_DEMO, 'cuenta-demo');
    expect(lote.filas.length).toBe(0);
  });

  it('registra una conversión atribuible por identificador de campaña', async () => {
    const ref = await crearPost();
    // POST directo al emulador para registrar la conversión (frontera HTTP).
    const addr = (app.server.address() as AddressInfo).port;
    await fetch(`http://127.0.0.1:${addr}/v1/conversions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN_DEMO}` }, body: JSON.stringify({ externalId: ref, campaignRef: 'cmp-blog', valor: 1 }) });
    const lote = await fuente.obtener(TOKEN_DEMO, 'cuenta-demo');
    expect(lote.conversiones.some((c) => c.campaignRef === 'cmp-blog')).toBe(true);
  });
});
