import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { DeterministicIntelligenceProvider } from '@soec/intelligence';
import { buildApp } from '../src/app';

function makeApp() {
  return buildApp({ store: new InMemoryEventStore(), intelligence: new DeterministicIntelligenceProvider() });
}
const headers = {
  'x-organization-id': 'orgA',
  'x-actor-id': 'tester',
  'x-scope': 'events:append,events:read',
  'content-type': 'application/json',
};
const headersB = { ...headers, 'x-organization-id': 'orgB' };
const attribution = { source: 'api', purpose: 'e2e-oi', assumptions: [], claimType: 'observational', regime: 'empirical', uncertainty: 'media' };
const base = { attribution, occurredAt: '2026-03-01T00:00:00.000Z' };
const ambito = { proposito: 'p', representa: 'r', excluye: 'x', supuestos: [] };
const vigencia = { desde: '2026-01-01T00:00:00.000Z', hasta: null };

async function sembrarEce(app: ReturnType<typeof makeApp>) {
  await app.inject({ method: 'POST', url: '/med/m1', headers, payload: { ambito, vigencia, ...base } });
  await app.inject({ method: 'POST', url: '/med/m1/afirmaciones', headers, payload: { afirmacionId: 'a1', enunciado: 'x', dimension: 'hace', incertidumbre: 'media', ...base } });
  await app.inject({ method: 'POST', url: '/med/m1/evidencias', headers, payload: { evidenciaId: 's', afirmacionId: 'a1', relacion: 'sostiene', procedencia: 'A', contenido: 'c', ...base } });
  await app.inject({ method: 'POST', url: '/med/m1/evidencias', headers, payload: { evidenciaId: 'n', afirmacionId: 'a1', relacion: 'debilita', procedencia: 'B', contenido: 'c', ...base } });
  await app.inject({ method: 'POST', url: '/mdm/w1', headers, payload: { ambito, vigencia, ...base } });
  await app.inject({ method: 'POST', url: '/ece/ece1/construir', headers, payload: { medInstanceId: 'm1', mdmInstanceId: 'w1', ...base } });
}
const sol = (extra: object = {}) => ({ eceId: 'ece1', proposito: 'probar', ...base, ...extra });

describe('API — operaciones intelectuales (§22)', () => {
  it('solicita una detección y recupera el producto no vinculante', async () => {
    const app = makeApp();
    await sembrarEce(app);
    const r = await app.inject({ method: 'POST', url: '/oi/x1/detectar', headers, payload: sol() });
    expect(r.statusCode).toBe(201);
    const body = r.json();
    expect(body.awaitingHumanJudgment).toBe(true);
    expect(body.bindingDecision).toBe(false);
    expect(body.producto.operacion).toBe('detectar');

    const prod = (await app.inject({ method: 'GET', url: '/oi/x1/producto', headers })).json().producto;
    expect(prod.operacion).toBe('detectar');
    const ej = (await app.inject({ method: 'GET', url: '/oi/x1', headers })).json().ejecucion;
    expect(ej.estado).toBe('ejecutada');
    await app.close();
  });

  it('solicita un esclarecimiento sobre un elemento', async () => {
    const app = makeApp();
    await sembrarEce(app);
    const r = await app.inject({ method: 'POST', url: '/oi/x1/esclarecer', headers, payload: sol({ objetivoElementoId: 'der:contradiccion:MED:m1:a1' }) });
    expect(r.statusCode).toBe(201);
    expect(r.json().producto.esclarecimiento.contradiccionSinResolver).toBe(true);
    await app.close();
  });

  it('rechaza propósito vacío (422) y mecanismo inexistente (422)', async () => {
    const app = makeApp();
    await sembrarEce(app);
    const sinProp = await app.inject({ method: 'POST', url: '/oi/x1/detectar', headers, payload: sol({ proposito: '' }) });
    expect(sinProp.statusCode).toBe(422);
    const mal = await app.inject({ method: 'POST', url: '/oi/x2/detectar', headers, payload: sol({ mecanismo: 'inexistente' }) });
    expect(mal.statusCode).toBe(422);
    await app.close();
  });

  it('rechaza sin alcance (403), aísla por organización y no expone ejecución de acciones ni capacidades', async () => {
    const app = makeApp();
    await sembrarEce(app);
    const sinScope = await app.inject({ method: 'POST', url: '/oi/x1/detectar', headers: { 'content-type': 'application/json' }, payload: sol() });
    expect(sinScope.statusCode).toBe(403);

    await app.inject({ method: 'POST', url: '/oi/x1/detectar', headers, payload: sol() });
    const otra = (await app.inject({ method: 'GET', url: '/oi/x1', headers: headersB })).json().ejecucion;
    expect(otra.existe).toBe(false);

    for (const ruta of ['/oi/x1/ejecutar', '/oi/x1/aprobar', '/capacidades/x1', '/oi/x1/actuar']) {
      const res = await app.inject({ method: 'POST', url: ruta, headers, payload: {} });
      expect(res.statusCode).toBe(404);
    }
    await app.close();
  });
});
