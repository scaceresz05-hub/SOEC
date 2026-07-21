import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { DeterministicIntelligenceProvider } from '@soec/intelligence';
import { buildApp } from '../src/app';

function makeApp() {
  return buildApp({
    store: new InMemoryEventStore(),
    intelligence: new DeterministicIntelligenceProvider(),
  });
}

const headers = {
  'x-organization-id': 'orgA',
  'x-actor-id': 'tester',
  'x-scope': 'events:append,events:read',
  'x-correlation-id': 'corr-1',
  'content-type': 'application/json',
};

const attribution = {
  source: 'api-test',
  purpose: 'e2e',
  assumptions: [],
  claimType: 'observational',
  regime: 'empirical',
  uncertainty: 'none',
};

describe('API — vertical técnica de la Base Técnica', () => {
  it('health responde', async () => {
    const app = makeApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
    await app.close();
  });

  it('registra un evento con contexto y lo recupera; el estado histórico es consultable', async () => {
    const app = makeApp();
    const post = await app.inject({
      method: 'POST',
      url: '/events',
      headers,
      payload: {
        streamId: 's1',
        expectedVersion: 0,
        events: [{ type: 'Hecho', payload: { n: 1 }, attribution, occurredAt: new Date().toISOString() }],
      },
    });
    expect(post.statusCode).toBe(201);
    expect(post.json().version).toBe(1);

    const get = await app.inject({ method: 'GET', url: '/streams/s1', headers });
    expect(get.statusCode).toBe(200);
    expect(get.json().events).toHaveLength(1);
    await app.close();
  });

  it('rechaza solicitudes sin alcance (403)', async () => {
    const app = makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/events',
      headers: { 'content-type': 'application/json' }, // sin identidad
      payload: { streamId: 's1', expectedVersion: 0, events: [] },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('conflicto de versión → 409', async () => {
    const app = makeApp();
    const body = {
      streamId: 's2',
      expectedVersion: 0,
      events: [{ type: 'A', payload: {}, attribution, occurredAt: new Date().toISOString() }],
    };
    await app.inject({ method: 'POST', url: '/events', headers, payload: body });
    const conflict = await app.inject({ method: 'POST', url: '/events', headers, payload: body });
    expect(conflict.statusCode).toBe(409);
    await app.close();
  });

  it('/intelligence entrega un producto no vinculante ofrecido al juicio humano', async () => {
    const app = makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/intelligence',
      headers,
      payload: { operation: 'hypothesis', input: 'algo', dataPolicy: 'must-stay-internal' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.awaitingHumanJudgment).toBe(true);
    expect(body.product.bindingDecision).toBe(false);
    await app.close();
  });
});
