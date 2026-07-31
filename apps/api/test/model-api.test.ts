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

const attribution = {
  source: 'api-test',
  purpose: 'e2e-modelos',
  assumptions: [],
  claimType: 'observational',
  regime: 'empirical',
  uncertainty: 'media',
};
const base = { attribution, occurredAt: '2026-03-01T00:00:00.000Z' };
const ambito = { proposito: 'p', representa: 'r', excluye: 'MDM', supuestos: [] };
const vigencia = { desde: '2026-01-01T00:00:00.000Z', hasta: null };

describe('API — verticales MED y MDM (§12)', () => {
  it('crea, modifica, incorpora evidencia, revisa y consulta MED', async () => {
    const app = makeApp();
    expect((await app.inject({ method: 'POST', url: '/med/m1', headers, payload: { ambito, vigencia, ...base } })).statusCode).toBe(201);
    expect((await app.inject({ method: 'POST', url: '/med/m1/entidades', headers, payload: { entidadId: 'u1', dimension: 'es', tipo: 'unidad', atributos: {}, ...base } })).statusCode).toBe(201);
    expect((await app.inject({ method: 'POST', url: '/med/m1/afirmaciones', headers, payload: { afirmacionId: 'a1', enunciado: 'x', dimension: 'hace', incertidumbre: 'media', ...base } })).statusCode).toBe(201);
    expect((await app.inject({ method: 'POST', url: '/med/m1/evidencias', headers, payload: { evidenciaId: 'e1', afirmacionId: 'a1', relacion: 'sostiene', procedencia: 'src', contenido: 'c', ...base } })).statusCode).toBe(201);
    expect((await app.inject({ method: 'POST', url: '/med/m1/revision', headers, payload: { afirmacionId: 'a1', nuevoEstado: 'respaldada', motivo: 'ok', ...base } })).statusCode).toBe(201);

    const get = await app.inject({ method: 'GET', url: '/med/m1', headers });
    expect(get.statusCode).toBe(200);
    const st = get.json().estado;
    expect(st.afirmaciones.a1.estado).toBe('respaldada');
    expect(st.entidades.u1.tipo).toBe('unidad');
    await app.close();
  });

  it('consulta el estado histórico a un corte anterior', async () => {
    const clock = new FixedClock(new Date('2026-03-01T00:00:00.000Z'));
    const app = makeApp(clock);
    await app.inject({ method: 'POST', url: '/med/m1', headers, payload: { ambito, vigencia, ...base } });
    await app.inject({ method: 'POST', url: '/med/m1/entidades', headers, payload: { entidadId: 'u1', dimension: 'es', tipo: 'unidad', atributos: {}, ...base } });
    clock.advance(1000);
    const corte = clock.now();
    clock.advance(1000);
    await app.inject({ method: 'POST', url: '/med/m1/entidades', headers, payload: { entidadId: 'u2', dimension: 'es', tipo: 'unidad', atributos: {}, ...base } });

    const hist = await app.inject({ method: 'GET', url: `/med/m1/historico?asOf=${encodeURIComponent(corte)}`, headers });
    expect(hist.statusCode).toBe(200);
    expect(Object.keys(hist.json().estado.entidades)).toEqual(['u1']);
    await app.close();
  });

  it('crear dos veces la misma instancia → 409', async () => {
    const app = makeApp();
    await app.inject({ method: 'POST', url: '/med/m1', headers, payload: { ambito, vigencia, ...base } });
    const dup = await app.inject({ method: 'POST', url: '/med/m1', headers, payload: { ambito, vigencia, ...base } });
    expect(dup.statusCode).toBe(409);
    await app.close();
  });

  it('operar sobre instancia inexistente → 404; evidencia sobre afirmación inexistente → 422', async () => {
    const app = makeApp();
    const noExiste = await app.inject({ method: 'POST', url: '/med/nada/entidades', headers, payload: { entidadId: 'u1', dimension: 'es', tipo: 'unidad', atributos: {}, ...base } });
    expect(noExiste.statusCode).toBe(404);
    await app.inject({ method: 'POST', url: '/med/m1', headers, payload: { ambito, vigencia, ...base } });
    const evSinAf = await app.inject({ method: 'POST', url: '/med/m1/evidencias', headers, payload: { evidenciaId: 'e1', afirmacionId: 'fantasma', relacion: 'sostiene', procedencia: 's', contenido: 'c', ...base } });
    expect(evSinAf.statusCode).toBe(422);
    await app.close();
  });

  it('rechaza sin alcance (403) y aísla por organización', async () => {
    const app = makeApp();
    const sinScope = await app.inject({ method: 'POST', url: '/med/m1', headers: { 'content-type': 'application/json' }, payload: { ambito, vigencia, ...base } });
    expect(sinScope.statusCode).toBe(403);

    await app.inject({ method: 'POST', url: '/med/m1', headers, payload: { ambito, vigencia, ...base } });
    const otraOrg = await app.inject({ method: 'GET', url: '/med/m1', headers: headersB });
    expect(otraOrg.json().estado.existe).toBe(false);
    await app.close();
  });

  it('MED y MDM con la misma id son independientes (separación)', async () => {
    const app = makeApp();
    await app.inject({ method: 'POST', url: '/med/x', headers, payload: { ambito, vigencia, ...base } });
    await app.inject({ method: 'POST', url: '/med/x/entidades', headers, payload: { entidadId: 'u1', dimension: 'es', tipo: 'unidad', atributos: {}, ...base } });
    await app.inject({ method: 'POST', url: '/mdm/x', headers, payload: { ambito, vigencia, ...base } });
    await app.inject({ method: 'POST', url: '/mdm/x/observaciones', headers, payload: { observacionId: 'o1', contenido: 'entorno', ...base } });

    const medX = (await app.inject({ method: 'GET', url: '/med/x', headers })).json().estado;
    const mdmX = (await app.inject({ method: 'GET', url: '/mdm/x', headers })).json().estado;
    expect(Object.keys(medX.entidades)).toEqual(['u1']);
    expect(medX.observaciones).toHaveLength(0);
    expect(mdmX.observaciones).toHaveLength(1);
    expect(Object.keys(mdmX.entidades)).toEqual([]);
    await app.close();
  });
});
