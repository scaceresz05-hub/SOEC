/**
 * Smoke de la superficie HTTP /acquisition — 200 y tenant-scoped (FASE 27 runtime smoke).
 */
import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { DeterministicIntelligenceProvider } from '@soec/intelligence';
import { buildApp } from '../src/app';

function makeApp() {
  return buildApp({
    store: new InMemoryEventStore(),
    intelligence: new DeterministicIntelligenceProvider(),
    legacyDemoAccess: true,
  });
}

const cab = (org: string) => ({
  'x-organization-id': org,
  'x-organization-slug': org,
  'x-actor-id': 'smoke',
  'x-scope': 'events:read',
});

describe('API /acquisition — smoke tenant-scoped', () => {
  it('CYP: summary/channels/strategy/outcomes responden 200 con datos honestos', async () => {
    const app = makeApp();
    const summary = await app.inject({ method: 'GET', url: '/acquisition/summary', headers: cab('org-cyp') });
    expect(summary.statusCode).toBe(200);
    expect(summary.json().objetivo).toBe('GENERATE_SALES');
    expect(summary.json().foundation).toBe('FOUNDATION_REQUIRED');

    const channels = await app.inject({ method: 'GET', url: '/acquisition/channels', headers: cab('org-cyp') });
    expect(channels.statusCode).toBe(200);
    const metaIg = channels.json().canales.find((c: { canal: string }) => c.canal === 'META_INSTAGRAM');
    expect(metaIg.status).toBe('NOT_CONFIGURED'); // no conectado, no 0
    expect(channels.json().meta.graphCalls).toBe(0);

    expect((await app.inject({ method: 'GET', url: '/acquisition/strategy', headers: cab('org-cyp') })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/acquisition/outcomes', headers: cab('org-cyp') })).statusCode).toBe(200);
    await app.close();
  });

  it('SmileFlow: summary 200 con objetivo de leads', async () => {
    const app = makeApp();
    const r = await app.inject({ method: 'GET', url: '/acquisition/summary', headers: cab('org-smileflow') });
    expect(r.statusCode).toBe(200);
    expect(r.json().objetivo).toBe('GENERATE_LEADS');
    await app.close();
  });

  it('UNKNOWN_ORG_FAILS_CLOSED: una org no registrada no responde 200', async () => {
    const app = makeApp();
    const r = await app.inject({ method: 'GET', url: '/acquisition/summary', headers: cab('org-inexistente') });
    expect(r.statusCode).not.toBe(200);
    await app.close();
  });
});
