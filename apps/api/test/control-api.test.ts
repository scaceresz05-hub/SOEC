import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { DeterministicIntelligenceProvider } from '@soec/intelligence';
import { buildApp } from '../src/app';

function makeApp() {
  return buildApp({ store: new InMemoryEventStore(), intelligence: new DeterministicIntelligenceProvider() });
}
const j = (r: { json(): unknown }) => r.json() as never;

describe('API — Centro de Control del Departamento Autónomo (F2-CTRL-01)', () => {
  it('resume el departamento; la pausa total bloquea nuevos efectos; la reanudación los restaura', async () => {
    const app = makeApp();
    expect((await app.inject({ method: 'POST', url: '/control/preparar' })).statusCode).toBe(201);

    const res0: { existe?: boolean; salud: string; modo: string } = j(await app.inject({ method: 'GET', url: '/control/resumen' }));
    expect(res0.modo).toBe('simulado');
    expect(typeof res0.salud).toBe('string');

    const sim1: { aplicadas: number; pausado: boolean } = j(await app.inject({ method: 'POST', url: '/control/simular', payload: { escenario: 'bajo' } }));
    expect(sim1.aplicadas).toBeGreaterThan(0);
    expect(sim1.pausado).toBe(false);

    // Pausa total → el ciclo no produce efectos.
    const pausa: { pausaTotal: boolean } = j(await app.inject({ method: 'POST', url: '/control/pausar', payload: { tipo: 'departamento', valor: '*', motivo: 'prueba' } }));
    expect(pausa.pausaTotal).toBe(true);
    const sim2: { pausado: boolean; aplicadas: number } = j(await app.inject({ method: 'POST', url: '/control/simular', payload: { escenario: 'bajo' } }));
    expect(sim2.pausado).toBe(true);
    expect(sim2.aplicadas).toBe(0);
    const res1: { salud: string; pausaTotal: boolean } = j(await app.inject({ method: 'GET', url: '/control/resumen' }));
    expect(res1.salud).toBe('pausado');

    // Reanudar restaura el flujo.
    await app.inject({ method: 'POST', url: '/control/reanudar', payload: { tipo: 'departamento', valor: '*' } });
    const sim3: { pausado: boolean } = j(await app.inject({ method: 'POST', url: '/control/simular', payload: { escenario: 'bajo' } }));
    expect(sim3.pausado).toBe(false);
    await app.close();
  });

  it('un escalamiento genera una decisión pendiente; el propietario la aprueba y el efecto se aplica', async () => {
    const app = makeApp();
    await app.inject({ method: 'POST', url: '/control/preparar' });
    const sim: { decisiones: number } = j(await app.inject({ method: 'POST', url: '/control/simular', payload: { escenario: 'alto' } }));
    expect(sim.decisiones).toBeGreaterThan(0);

    const dec: { decisiones: { decId: string; tipo: string; estado: string }[] } = j(await app.inject({ method: 'GET', url: '/control/decisiones' }));
    const pendiente = dec.decisiones.find((d) => d.estado === 'pendiente');
    expect(pendiente).toBeDefined();
    const r: { estado: string; efectoAplicado: boolean } = j(await app.inject({ method: 'POST', url: `/control/decisiones/${pendiente!.decId}/resolver`, payload: { estado: 'aprobada', rol: 'propietario', actor: 'dueño' } }));
    expect(r.estado).toBe('aprobada');
    expect(r.efectoAplicado).toBe(true);
    await app.close();
  });

  it('una anomalía de gasto genera una alerta crítica y la auditoría enlaza la cadena', async () => {
    const app = makeApp();
    await app.inject({ method: 'POST', url: '/control/preparar' });
    await app.inject({ method: 'POST', url: '/control/simular', payload: { escenario: 'gasto_excedido' } });
    const al: { alertas: { tipo: string; severidad: string }[] } = j(await app.inject({ method: 'GET', url: '/control/alertas' }));
    expect(al.alertas.some((a) => a.tipo === 'gasto_anomalo' && a.severidad === 'critico')).toBe(true);
    const aud: { objetivo: string; publicacion: unknown; medicion: unknown } = j(await app.inject({ method: 'GET', url: '/control/auditoria/blog' }));
    expect(aud.objetivo).toBeTruthy();
    expect(aud.publicacion).not.toBeNull();
    await app.close();
  });
});
