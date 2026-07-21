import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { DeterministicIntelligenceProvider } from '@soec/intelligence';
import { buildApp } from '../src/app';

function makeApp() {
  return buildApp({ store: new InMemoryEventStore(), intelligence: new DeterministicIntelligenceProvider() });
}

describe('API — experiencia de marketing autónomo (F2-MKT-01)', () => {
  it('prepara la estrategia sintética, muestra el plan y ejecuta acciones autorizadas/denegadas', async () => {
    const app = makeApp();
    expect((await app.inject({ method: 'POST', url: '/marketing/preparar' })).statusCode).toBe(201);

    const estado = (await app.inject({ method: 'GET', url: '/marketing/estado' })).json();
    expect(estado.existe).toBe(true);
    expect(estado.plan.planVersion).toBe(1);
    expect(estado.plan.campanias.length).toBeGreaterThan(0);
    // Hay actividades bloqueadas (youtube no autorizado / blog_tecnico sin contenido) y ejecutables.
    expect(estado.plan.actividades.some((a: { estado: string }) => a.estado === 'bloqueada')).toBe(true);
    expect(estado.siguiente).not.toBeNull();

    // Próxima acción autorizada → ejecutada (efecto simulado).
    const e1 = (await app.inject({ method: 'POST', url: '/marketing/ejecutar-siguiente' })).json();
    expect(e1.permitida).toBe(true);
    expect(e1.resultado).toContain('simulado');

    // Siguiente (meta_ads con afirmación prohibida) → denegada por la política.
    const e2 = (await app.inject({ method: 'POST', url: '/marketing/ejecutar-siguiente' })).json();
    expect(e2.permitida).toBe(false);
    expect(e2.motivo).toBe('afirmacion_prohibida');

    await app.close();
  });

  it('replanifica creando una nueva versión; pausar detiene la ejecución', async () => {
    const app = makeApp();
    await app.inject({ method: 'POST', url: '/marketing/preparar' });
    const rep = (await app.inject({ method: 'POST', url: '/marketing/replanificar', headers: { 'content-type': 'application/json' }, payload: { motivo: 'ajuste' } })).json();
    expect(rep.planVersion).toBe(2);

    await app.inject({ method: 'POST', url: '/marketing/pausar' });
    const est = (await app.inject({ method: 'GET', url: '/marketing/estado' })).json();
    expect(est.plan.estado).toBe('pausado');
    await app.close();
  });
});
