import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { DeterministicIntelligenceProvider } from '@soec/intelligence';
import { buildApp } from '../src/app';

function makeApp() {
  return buildApp({ store: new InMemoryEventStore(), intelligence: new DeterministicIntelligenceProvider(), legacyDemoAccess: true });
}

describe('API — Fábrica Autónoma de Contenido (F2-CONT-01)', () => {
  it('prepara la estrategia, produce contenido para las actividades bloqueadas y desbloquea', async () => {
    const app = makeApp();
    expect((await app.inject({ method: 'POST', url: '/contenido/preparar' })).statusCode).toBe(201);

    const estado0 = (await app.inject({ method: 'GET', url: '/contenido/estado' })).json();
    expect(estado0.existe).toBe(true);
    expect(estado0.actividades.some((a: { estado: string }) => a.estado === 'bloqueada')).toBe(true);

    const todo = (await app.inject({ method: 'POST', url: '/contenido/preparar-todo' })).json();
    expect(todo.desbloqueadas).toBeGreaterThan(0);

    const estado1 = (await app.inject({ method: 'GET', url: '/contenido/estado' })).json();
    const blog = estado1.actividades.find((a: { canal: string }) => a.canal === 'blog');
    expect(blog.estado).toBe('autorizable');
    expect(blog.paquete.resultado).toBe('listo');
    // La actividad de facebook (canal no autorizado) se mantiene bloqueada.
    const fb = estado1.actividades.find((a: { canal: string }) => a.canal === 'facebook');
    expect(fb.estado).toBe('bloqueada');

    await app.close();
  });

  it('el contenido de meta_ads corrige una afirmación prohibida antes de quedar listo; luego ejecuta (simulado)', async () => {
    const app = makeApp();
    await app.inject({ method: 'POST', url: '/contenido/preparar' });
    const r = (await app.inject({ method: 'POST', url: '/contenido/actividades/act-meta_ads-0/preparar-contenido' })).json();
    expect(r.actividadDesbloqueada).toBe(true);
    expect(r.paquete.revisiones.some((x: { accion: string }) => x.accion === 'corregida')).toBe(true);
    const ad = r.paquete.adaptaciones.find((a: { canal: string }) => a.canal === 'meta_ads');
    expect(String(ad.cuerpo).toLowerCase()).not.toContain('oferta imperdible');

    const ejec = (await app.inject({ method: 'POST', url: '/contenido/ejecutar-siguiente' })).json();
    expect(ejec.permitida).toBe(true);
    await app.close();
  });
});
