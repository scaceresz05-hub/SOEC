import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { DeterministicIntelligenceProvider } from '@soec/intelligence';
import { buildApp } from '../src/app';

function makeApp() {
  return buildApp({ store: new InMemoryEventStore(), intelligence: new DeterministicIntelligenceProvider() });
}
const H = { 'content-type': 'application/json' };

describe('API — experiencia «Comprender el estado» (F1-UI-01, cadena real)', () => {
  it('analiza el estado ejecutando la cadena real y devuelve un producto compuesto no vinculante', async () => {
    const app = makeApp();
    const r = await app.inject({ method: 'POST', url: '/experiencia/comprender-estado/analizar', headers: H, payload: { executionId: 'a1' } });
    expect(r.statusCode).toBe(201);
    const body = r.json();
    expect(body.estado).toBe('compuesta');
    expect(body.producto.bindingDecision).toBe(false);
    // Detectar y esclarecer aparecen diferenciados.
    expect(body.intermedios.map((i: { operacion: string }) => i.operacion).sort()).toEqual(['detectar', 'esclarecer']);
    // Cada intermedio conserva evidencia/razones/procedencia/faltante.
    for (const inter of body.intermedios) {
      expect(typeof inter.procedencia).toBe('string');
      expect(Array.isArray(inter.razones)).toBe(true);
    }
    // Contradicción abierta visible y decisión reservada a la persona.
    expect(body.producto.contradiccionesAbiertas.length).toBeGreaterThan(0);
    expect(body.producto.cuestionesJuicioHumano.join(' ')).toMatch(/persona/);
    expect(body.producto.faltante.length).toBeGreaterThan(0);
    await app.close();
  });

  it('el historial registra el análisis y el detalle es consultable', async () => {
    const app = makeApp();
    await app.inject({ method: 'POST', url: '/experiencia/comprender-estado/analizar', headers: H, payload: { executionId: 'a1' } });
    const hist = (await app.inject({ method: 'GET', url: '/experiencia/comprender-estado/historial' })).json().historial;
    expect(hist.map((h: { executionId: string }) => h.executionId)).toContain('a1');
    const det = await app.inject({ method: 'GET', url: '/experiencia/comprender-estado/a1' });
    expect(det.statusCode).toBe(200);
    expect(det.json().existe).toBe(true);
    await app.close();
  });

  it('es idempotente: reanalizar con el mismo id no duplica ni recalcula', async () => {
    const app = makeApp();
    const r1 = await app.inject({ method: 'POST', url: '/experiencia/comprender-estado/analizar', headers: H, payload: { executionId: 'a1' } });
    const r2 = await app.inject({ method: 'POST', url: '/experiencia/comprender-estado/analizar', headers: H, payload: { executionId: 'a1' } });
    expect(r2.json().producto).toEqual(r1.json().producto);
    const hist = (await app.inject({ method: 'GET', url: '/experiencia/comprender-estado/historial' })).json().historial;
    expect(hist.filter((h: { executionId: string }) => h.executionId === 'a1')).toHaveLength(1);
    await app.close();
  });

  it('una ejecución inexistente devuelve 404 (no un error genérico)', async () => {
    const app = makeApp();
    const det = await app.inject({ method: 'GET', url: '/experiencia/comprender-estado/nunca' });
    expect(det.statusCode).toBe(404);
    await app.close();
  });
});
