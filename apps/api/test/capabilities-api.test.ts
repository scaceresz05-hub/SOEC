import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { DeterministicIntelligenceProvider } from '@soec/intelligence';
import { buildApp } from '../src/app';

function makeApp() {
  return buildApp({ store: new InMemoryEventStore(), intelligence: new DeterministicIntelligenceProvider(), legacyDemoAccess: true });
}
const headers = { 'x-organization-id': 'orgA', 'x-actor-id': 'tester', 'x-scope': 'events:append,events:read', 'content-type': 'application/json' };
const headersB = { ...headers, 'x-organization-id': 'orgB' };
const attribution = { source: 'api', purpose: 'e2e-cap', assumptions: [], claimType: 'observational', regime: 'empirical', uncertainty: 'media' };
const base = { attribution, occurredAt: '2026-03-01T00:00:00.000Z' };
const ambito = { proposito: 'p', representa: 'r', excluye: 'x', supuestos: [] };
const vigencia = { desde: '2026-01-01T00:00:00.000Z', hasta: null };

const definicion = {
  nombre: 'detectar-y-orientar',
  proposito: 'saber qué merece atención y qué considerar',
  familia: 'orientar-una-decision',
  pasos: [
    { stepId: 'd1', operacion: 'detectar', porque: 'ver lo no visto', dependeDe: [], usaProductoDe: null, objetivoElementoId: null, horizonte: null, obligatorio: true },
    { stepId: 'o1', operacion: 'orientar', porque: 'ofrecer consideraciones', dependeDe: ['d1'], usaProductoDe: 'd1', objetivoElementoId: null, horizonte: null, obligatorio: true },
  ],
  condicionesEntrada: [],
  condicionesAbstencion: [],
  contrato: { entrega: 'señales y consideraciones', limite: 'no decide' },
  componeCapacidades: [],
  vigencia,
  atribucion: attribution,
};

async function sembrarEce(app: ReturnType<typeof makeApp>) {
  await app.inject({ method: 'POST', url: '/med/m1', headers, payload: { ambito, vigencia, ...base } });
  await app.inject({ method: 'POST', url: '/med/m1/afirmaciones', headers, payload: { afirmacionId: 'a1', enunciado: 'x', dimension: 'hace', incertidumbre: 'media', ...base } });
  await app.inject({ method: 'POST', url: '/med/m1/evidencias', headers, payload: { evidenciaId: 's', afirmacionId: 'a1', relacion: 'sostiene', procedencia: 'A', contenido: 'c', ...base } });
  await app.inject({ method: 'POST', url: '/med/m1/evidencias', headers, payload: { evidenciaId: 'n', afirmacionId: 'a1', relacion: 'debilita', procedencia: 'B', contenido: 'c', ...base } });
  await app.inject({ method: 'POST', url: '/mdm/w1', headers, payload: { ambito, vigencia, ...base } });
  await app.inject({ method: 'POST', url: '/ece/ece1/construir', headers, payload: { medInstanceId: 'm1', mdmInstanceId: 'w1', ...base } });
}
async function registrar(app: ReturnType<typeof makeApp>, capId = 'cap1') {
  await app.inject({ method: 'POST', url: `/cap/${capId}/definiciones`, headers, payload: definicion });
  await app.inject({ method: 'POST', url: `/cap/${capId}/publicar`, headers, payload: { version: 1 } });
}

describe('API — capacidades (§21)', () => {
  it('registra, publica, ejecuta y consulta un producto compuesto no vinculante', async () => {
    const app = makeApp();
    await sembrarEce(app);
    await registrar(app);
    const r = await app.inject({ method: 'POST', url: '/cap/cap1/ejecutar/x1', headers, payload: { eceId: 'ece1', ...base } });
    expect(r.statusCode).toBe(201);
    const body = r.json();
    expect(body.awaitingHumanJudgment).toBe(true);
    expect(body.bindingDecision).toBe(false);
    expect(body.producto.operacionesEjecutadas).toHaveLength(2);

    const prod = (await app.inject({ method: 'GET', url: '/cap-exec/x1/producto', headers })).json().producto;
    expect(prod.operacionesEjecutadas.map((p: { operacion: string }) => p.operacion)).toEqual(['detectar', 'orientar']);
    const ej = (await app.inject({ method: 'GET', url: '/cap-exec/x1', headers })).json().ejecucion;
    expect(ej.estado).toBe('compuesta');
    await app.close();
  });

  it('rechaza un ciclo de composición (409)', async () => {
    const app = makeApp();
    const res = await app.inject({ method: 'POST', url: '/cap/capX/definiciones', headers, payload: { ...definicion, componeCapacidades: ['capX'] } });
    expect(res.statusCode).toBe(409);
    await app.close();
  });

  it('rechaza sin alcance (403), aísla por organización y no expone efectos ni aprobación', async () => {
    const app = makeApp();
    await sembrarEce(app);
    await registrar(app);
    const sinScope = await app.inject({ method: 'POST', url: '/cap/cap1/ejecutar/x1', headers: { 'content-type': 'application/json' }, payload: { eceId: 'ece1', ...base } });
    expect(sinScope.statusCode).toBe(403);

    await app.inject({ method: 'POST', url: '/cap/cap1/ejecutar/x1', headers, payload: { eceId: 'ece1', ...base } });
    const otra = (await app.inject({ method: 'GET', url: '/cap-exec/x1', headers: headersB })).json().ejecucion;
    expect(otra.existe).toBe(false);

    for (const ruta of ['/cap-exec/x1/aprobar', '/cap-exec/x1/ejecutar', '/cap-exec/x1/enviar', '/cap/cap1/lanzar']) {
      const res = await app.inject({ method: 'POST', url: ruta, headers, payload: {} });
      expect(res.statusCode).toBe(404);
    }
    await app.close();
  });
});
