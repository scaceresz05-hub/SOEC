import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { DeterministicIntelligenceProvider } from '@soec/intelligence';
import { buildApp } from '../src/app';

function makeApp() {
  return buildApp({ store: new InMemoryEventStore(), intelligence: new DeterministicIntelligenceProvider(), legacyDemoAccess: true });
}

describe('API — Plano de Canales / Publicación Controlada (F2-CHAN-01)', () => {
  it('prepara, publica (modo simulado) y verifica; los canales que exigen imagen real quedan bloqueados', async () => {
    const app = makeApp();
    expect((await app.inject({ method: 'POST', url: '/canales/preparar' })).statusCode).toBe(201);

    const est0 = (await app.inject({ method: 'GET', url: '/canales/estado' })).json();
    expect(est0.existe).toBe(true);
    expect(est0.modo).toBe('simulado');
    const blog0 = est0.actividades.find((a: { canal: string }) => a.canal === 'blog');
    expect(blog0.publicable).toBe(true);

    const todo = (await app.inject({ method: 'POST', url: '/canales/publicar-todo' })).json();
    expect(todo.verificadas).toBeGreaterThan(0);
    expect(todo.bloqueadas).toBeGreaterThan(0); // instagram/meta_ads exigen imagen real

    const est1 = (await app.inject({ method: 'GET', url: '/canales/estado' })).json();
    const blog = est1.actividades.find((a: { canal: string }) => a.canal === 'blog');
    expect(blog.publicacion.estado).toBe('verificada');
    expect(blog.publicacion.externalRef).toBeTruthy();
    const insta = est1.actividades.find((a: { canal: string }) => a.canal === 'instagram');
    expect(insta.publicacion.estado).toBe('bloqueada');
    expect(insta.publicacion.motivoBloqueo).toBe('activo_real_faltante');
  });

  it('rechaza un webhook con firma inválida (422)', async () => {
    const app = makeApp();
    await app.inject({ method: 'POST', url: '/canales/preparar' });
    const res = await app.inject({ method: 'POST', url: '/canales/webhook', payload: { id: 'wh-1', tipo: 'post.published', externalRef: 'ext-x', status: 'published', firma: 'firma-mala' } });
    expect(res.statusCode).toBe(422);
  });
});
