import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { DeterministicIntelligenceProvider } from '@soec/intelligence';
import { buildApp } from '../src/app';

function makeApp() {
  return buildApp({ store: new InMemoryEventStore(), intelligence: new DeterministicIntelligenceProvider(), legacyDemoAccess: true });
}
const headers = { 'x-organization-id': 'orgA', 'x-actor-id': 'soec', 'x-scope': 'events:append,events:read', 'content-type': 'application/json' };

const contenido = {
  empresa: 'Pyme demo',
  objetivo: 'alcance orgánico',
  canalesAutorizados: ['blog'],
  presupuestoTotal: 1000,
  presupuestoDiario: 200,
  productosRestringidos: [],
  afirmacionesProhibidas: ['garantizado'],
  accionesProhibidas: ['enviar_masivo'],
  accionesRequierenAprobacion: [],
  nivelAutonomia: 3,
  riesgoPorAccion: { publicar_organico: 'bajo' },
};
const accion = { tipo: 'publicar_organico', canal: 'blog', contenido: 'Artículo válido', costo: 0, productoIntelectualRef: 'ce-1' };

async function politicaVigente(app: ReturnType<typeof makeApp>) {
  await app.inject({ method: 'POST', url: '/operativo/politicas/pol-1', headers, payload: { contenido } });
  await app.inject({ method: 'POST', url: '/operativo/politicas/pol-1/publicar', headers, payload: { version: 1 } });
}

describe('API — plano operativo (F2-AUT-01)', () => {
  it('ejecuta una acción autorizada por política (efecto simulado)', async () => {
    const app = makeApp();
    await politicaVigente(app);
    const r = await app.inject({ method: 'POST', url: '/operativo/acciones/a1', headers, payload: { policyId: 'pol-1', accion } });
    expect(r.statusCode).toBe(201);
    const b = r.json();
    expect(b.estado).toBe('verificada');
    expect(b.permitida).toBe(true);
    expect(b.efectoSimulado).toBe(true);
    await app.close();
  });

  it('deniega una acción no autorizada, sin efecto', async () => {
    const app = makeApp();
    await politicaVigente(app);
    const r = await app.inject({ method: 'POST', url: '/operativo/acciones/a1', headers, payload: { policyId: 'pol-1', accion: { ...accion, canal: 'tiktok' } } });
    const b = r.json();
    expect(b.estado).toBe('denegada');
    expect(b.permitida).toBe(false);
    expect(b.efectoSimulado).toBeNull();
    await app.close();
  });

  it('sin política no hay acción; suspender detiene la ejecución', async () => {
    const app = makeApp();
    const sinPol = await app.inject({ method: 'POST', url: '/operativo/acciones/a1', headers, payload: { policyId: 'nada', accion } });
    expect(sinPol.json().motivo).toBe('sin_politica');

    await politicaVigente(app);
    await app.inject({ method: 'POST', url: '/operativo/politicas/pol-1/suspender', headers, payload: { motivo: 'pausa' } });
    const r = await app.inject({ method: 'POST', url: '/operativo/acciones/a2', headers, payload: { policyId: 'pol-1', accion } });
    expect(r.json().motivo).toBe('politica_no_vigente');
    await app.close();
  });

  it('rechaza sin alcance (403)', async () => {
    const app = makeApp();
    const r = await app.inject({ method: 'POST', url: '/operativo/politicas/pol-1', headers: { 'content-type': 'application/json' }, payload: { contenido } });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});
