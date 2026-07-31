import { describe, expect, it } from 'vitest';
import { FixedClock, InMemoryEventStore } from '@soec/event-store';
import { DeterministicIntelligenceProvider } from '@soec/intelligence';
import { buildApp } from '../src/app';

function makeApp(clock?: FixedClock) {
  return buildApp({
    store: new InMemoryEventStore(clock),
    intelligence: new DeterministicIntelligenceProvider(), legacyDemoAccess: true,
  });
}

const headers = {
  'x-organization-id': 'orgA',
  'x-actor-id': 'tester',
  'x-scope': 'events:append,events:read',
  'x-correlation-id': 'corr-1',
  'content-type': 'application/json',
};
const headersB = { ...headers, 'x-organization-id': 'orgB' };
const attribution = { source: 'api-test', purpose: 'e2e-ece', assumptions: [], claimType: 'observational', regime: 'empirical', uncertainty: 'media' };
const base = { attribution, occurredAt: '2026-03-01T00:00:00.000Z' };
const ambito = { proposito: 'p', representa: 'r', excluye: 'x', supuestos: [] };
const vigencia = { desde: '2026-01-01T00:00:00.000Z', hasta: null };

async function sembrarMedMdm(app: ReturnType<typeof makeApp>) {
  await app.inject({ method: 'POST', url: '/med/m1', headers, payload: { ambito, vigencia, ...base } });
  await app.inject({ method: 'POST', url: '/med/m1/afirmaciones', headers, payload: { afirmacionId: 'a1', enunciado: 'x', dimension: 'hace', incertidumbre: 'alta', ...base } });
  await app.inject({ method: 'POST', url: '/mdm/w1', headers, payload: { ambito, vigencia, ...base } });
}

describe('API — Estado Cognitivo Empresarial (§18)', () => {
  it('construye el ECE y consulta estado, ausencias, procedencia y vigencia', async () => {
    const app = makeApp();
    await sembrarMedMdm(app);
    const c = await app.inject({ method: 'POST', url: '/ece/ece1/construir', headers, payload: { medInstanceId: 'm1', mdmInstanceId: 'w1', ...base } });
    expect(c.statusCode).toBe(201);

    const st = (await app.inject({ method: 'GET', url: '/ece/ece1', headers })).json().estado;
    expect(st.existe).toBe(true);

    const aus = (await app.inject({ method: 'GET', url: '/ece/ece1/ausencias', headers })).json().elementos;
    expect(aus.length).toBeGreaterThanOrEqual(1);

    const proc = (await app.inject({ method: 'GET', url: '/ece/ece1/procedencia', headers })).json().procedencia;
    expect(proc.medCorte.instanceId).toBe('m1');

    const vig = (await app.inject({ method: 'GET', url: '/ece/ece1/vigencia', headers })).json().vigencia;
    expect(vig.vigente).toBe(true);
    await app.close();
  });

  it('detecta desactualización tras un cambio en el MED', async () => {
    const app = makeApp();
    await sembrarMedMdm(app);
    await app.inject({ method: 'POST', url: '/ece/ece1/construir', headers, payload: { medInstanceId: 'm1', mdmInstanceId: 'w1', ...base } });
    await app.inject({ method: 'POST', url: '/med/m1/entidades', headers, payload: { entidadId: 'u1', dimension: 'es', tipo: 'unidad', atributos: {}, ...base } });
    const vig = (await app.inject({ method: 'GET', url: '/ece/ece1/vigencia', headers })).json().vigencia;
    expect(vig.requiereReconstruccion).toBe(true);
    await app.close();
  });

  it('registra una contradicción declarada y la consulta', async () => {
    const app = makeApp();
    await sembrarMedMdm(app);
    await app.inject({ method: 'POST', url: '/ece/ece1/construir', headers, payload: { medInstanceId: 'm1', mdmInstanceId: 'w1', ...base } });
    const reg = await app.inject({
      method: 'POST',
      url: '/ece/ece1/elementos',
      headers,
      payload: {
        tipo: 'contradiccion',
        id: 'c1',
        referencias: [{ modelo: 'MED', instanceId: 'm1', elementoId: 'a1', elementoTipo: 'afirmacion' }],
        procedencia: 'declarada',
        alcance: 'x',
        incertidumbre: 'media',
        ...base,
      },
    });
    expect(reg.statusCode).toBe(201);
    const contra = (await app.inject({ method: 'GET', url: '/ece/ece1/contradicciones', headers })).json().elementos;
    expect(contra).toHaveLength(1);
    await app.close();
  });

  it('rechaza sin alcance (403), aísla por organización y no expone operaciones intelectuales', async () => {
    const app = makeApp();
    await sembrarMedMdm(app);
    const sinScope = await app.inject({ method: 'POST', url: '/ece/ece1/construir', headers: { 'content-type': 'application/json' }, payload: { medInstanceId: 'm1', mdmInstanceId: 'w1', ...base } });
    expect(sinScope.statusCode).toBe(403);

    await app.inject({ method: 'POST', url: '/ece/ece1/construir', headers, payload: { medInstanceId: 'm1', mdmInstanceId: 'w1', ...base } });
    const otraOrg = await app.inject({ method: 'GET', url: '/ece/ece1', headers: headersB });
    expect(otraOrg.json().estado.existe).toBe(false);

    // No existen endpoints de operación intelectual.
    for (const op of ['explicar', 'orientar', 'predecir', 'recomendar']) {
      const res = await app.inject({ method: 'POST', url: `/ece/ece1/${op}`, headers, payload: {} });
      expect(res.statusCode).toBe(404);
    }
    await app.close();
  });

  it('construir sobre MED/MDM inexistentes → 422', async () => {
    const app = makeApp();
    const res = await app.inject({ method: 'POST', url: '/ece/ece1/construir', headers, payload: { medInstanceId: 'nada', mdmInstanceId: 'nada', ...base } });
    expect(res.statusCode).toBe(422);
    await app.close();
  });
});
