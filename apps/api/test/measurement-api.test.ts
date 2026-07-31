import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { DeterministicIntelligenceProvider } from '@soec/intelligence';
import { buildApp } from '../src/app';

function makeApp() {
  return buildApp({ store: new InMemoryEventStore(), intelligence: new DeterministicIntelligenceProvider(), legacyDemoAccess: true });
}

describe('API — Medición, Atribución y Optimización (F2-MET-01)', () => {
  it('prepara, mide (bajo desempeño), optimiza (pausa autorizada) y versiona el plan', async () => {
    const app = makeApp();
    expect((await app.inject({ method: 'POST', url: '/medicion/preparar' })).statusCode).toBe(201);

    const est0 = (await app.inject({ method: 'GET', url: '/medicion/estado' })).json();
    expect(est0.existe).toBe(true);
    expect(est0.actividades.length).toBeGreaterThan(0);

    const sinc = (await app.inject({ method: 'POST', url: '/medicion/sincronizar', payload: { escenario: 'bajo' } })).json();
    expect(sinc.medidas).toBeGreaterThan(0);

    const opt = (await app.inject({ method: 'POST', url: '/medicion/optimizar' })).json();
    expect(opt.aplicadas).toBeGreaterThan(0);

    const est1 = (await app.inject({ method: 'GET', url: '/medicion/estado' })).json();
    const blog = est1.actividades.find((a: { canal: string }) => a.canal === 'blog');
    expect(blog.clasificacion).toBe('bajo_umbral');
    expect(blog.optimizacion.tipo).toBe('pausar_actividad');
    expect(blog.optimizacion.estado).toBe('aplicada');
  });

  it('el escalamiento sobre objetivo queda denegado por la política (no automático)', async () => {
    const app = makeApp();
    await app.inject({ method: 'POST', url: '/medicion/preparar' });
    await app.inject({ method: 'POST', url: '/medicion/sincronizar', payload: { escenario: 'alto' } });
    const opt = (await app.inject({ method: 'POST', url: '/medicion/optimizar' })).json();
    expect(opt.denegadas).toBeGreaterThan(0);
    expect(opt.aplicadas).toBe(0);
  });
});
