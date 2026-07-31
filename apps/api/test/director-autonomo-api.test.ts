/**
 * Cableado del Director Autónomo al runtime (experiencia + rutas). Verifica el ciclo end-to-end
 * a través de la API: estado vacío honesto → ejecutar ciclo (persistido) → estado poblado con
 * ROI SIMULADO (nunca REAL) → PAUSA (modo seguro con bloqueo) → reanudar exige actor humano.
 * Aislamiento por organización. Ejecución simulada; sin efectos externos reales.
 */
import { describe, expect, it } from 'vitest';
import { InMemoryEventStore, FixedClock } from '@soec/event-store';
import { DeterministicIntelligenceProvider } from '@soec/intelligence';
import { buildApp } from '../src/app';

const H = { 'content-type': 'application/json' };
const ORG = 'clinica-brille';

function makeApp() {
  return buildApp({
    store: new InMemoryEventStore(),
    intelligence: new DeterministicIntelligenceProvider(),
    clock: new FixedClock(new Date('2026-07-30T12:00:00.000Z')),
  });
}

describe('Director Autónomo · cableado al runtime', () => {
  it('estado inicial es honestamente vacío (objetivo DESCONOCIDO) y recomienda registrar decisión', async () => {
    const app = makeApp();
    const res = await app.inject({ method: 'GET', url: `/experience/director-autonomo/estado?org=${ORG}` });
    expect(res.statusCode).toBe(200);
    const v = res.json();
    expect(v.objetivo.naturaleza).toBe('DESCONOCIDO');
    expect(v.modoSeguro).toBe(false);
    expect(v.proximaRecomendacion).toMatch(/decisión|evaluar|datos/i);
  });

  it('ejecutar el ciclo lo persiste y el estado se puebla con ROI SIMULADO (nunca REAL)', async () => {
    const app = makeApp();
    const run = await app.inject({ method: 'POST', url: '/experience/director-autonomo/ejecutar-ciclo', headers: H, payload: { org: ORG } });
    expect(run.statusCode).toBe(201);
    const traza = run.json();
    expect(traza.decisionId).toBeTruthy();
    expect(traza.campaignId).toBeTruthy();
    expect(traza.vista.resultado.naturaleza).toBe('SIMULADO');

    // Nueva lectura (read-only) sobre el mismo store: el ciclo quedó persistido.
    const estado = await app.inject({ method: 'GET', url: `/experience/director-autonomo/estado?org=${ORG}` });
    const v = estado.json();
    expect(v.objetivo.naturaleza).toBe('REAL');
    expect(v.decision.naturaleza).toBe('REAL');
    expect(v.resultado.naturaleza).toBe('SIMULADO'); // badge honesto: no es REAL
    expect(typeof v.resultado.valor).toBe('number'); // el número mostrado es ILUSTRATIVO, no real
    expect(v.resultado.nota).toMatch(/simulad/i);
    expect(v.ejecucionesSimuladas.length).toBeGreaterThan(0);
    expect(v.ejecucionesSimuladas[0].naturaleza).toBe('SIMULADO');
  });

  it('PAUSA activa el modo seguro con bloqueo; reanudar exige actor humano', async () => {
    const app = makeApp();
    await app.inject({ method: 'POST', url: '/experience/director-autonomo/ejecutar-ciclo', headers: H, payload: { org: ORG } });

    const pausa = await app.inject({ method: 'POST', url: '/experience/director-autonomo/pausar', headers: H, payload: { org: ORG, motivo: 'anomalía' } });
    expect(pausa.statusCode).toBe(201);
    const vp = pausa.json();
    expect(vp.modoSeguro).toBe(true);
    expect(vp.bloqueos.some((b: string) => b.includes('MODO_SEGURO'))).toBe(true);

    // Reanudar sin actor humano → rechazo del runtime.
    const sinActor = await app.inject({ method: 'POST', url: '/experience/director-autonomo/reanudar', headers: H, payload: { org: ORG } });
    expect(sinActor.statusCode).toBe(400);

    // Con actor humano → reanuda.
    const conActor = await app.inject({ method: 'POST', url: '/experience/director-autonomo/reanudar', headers: H, payload: { org: ORG, actorHumano: 'director-humano', motivo: 'resuelto' } });
    expect(conActor.statusCode).toBe(201);
    expect(conActor.json().modoSeguro).toBe(false);
  });

  it('aislamiento: el ciclo de una organización no aparece en otra', async () => {
    const app = makeApp();
    await app.inject({ method: 'POST', url: '/experience/director-autonomo/ejecutar-ciclo', headers: H, payload: { org: ORG } });
    const otra = await app.inject({ method: 'GET', url: '/experience/director-autonomo/estado?org=clinica-nova' });
    expect(otra.json().objetivo.naturaleza).toBe('DESCONOCIDO');
  });

  it('falta la organización → 400', async () => {
    const app = makeApp();
    const res = await app.inject({ method: 'GET', url: '/experience/director-autonomo/estado' });
    expect(res.statusCode).toBe(400);
  });
});
