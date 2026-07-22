import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { DeterministicIntelligenceProvider } from '@soec/intelligence';
import { buildApp } from '../src/app';

function makeApp() {
  return buildApp({ store: new InMemoryEventStore(), intelligence: new DeterministicIntelligenceProvider() });
}
const j = (r: { json(): unknown }) => r.json() as never;

describe('API — Preparación del Piloto Operacional Controlado (F2-PILOT-01)', () => {
  it('prepara una organización sintética, evalúa readiness, ensaya con éxito y mantiene la activación real BLOQUEADA', async () => {
    const app = makeApp();
    expect((await app.inject({ method: 'POST', url: '/piloto/preparar' })).statusCode).toBe(201);

    const est: { existe: boolean; onboarding: { completas: number; total: number }; readiness: { resultado: string; activacionRealPermitida: boolean }; activacion: { bloqueada: boolean } } = j(await app.inject({ method: 'GET', url: '/piloto/estado' }));
    expect(est.existe).toBe(true);
    expect(est.onboarding.completas).toBe(est.onboarding.total);
    expect(est.readiness.activacionRealPermitida).toBe(false);
    expect(est.activacion.bloqueada).toBe(true);

    const rd: { resultado: string } = j(await app.inject({ method: 'GET', url: '/piloto/readiness?entorno=sandbox' }));
    expect(['apto_para_ensayo', 'ensayo_aprobado']).toContain(rd.resultado);

    const ens: { resultado: string; rollbackVerificado: boolean } = j(await app.inject({ method: 'POST', url: '/piloto/ensayar', payload: { escenario: 'exitoso' } }));
    expect(ens.resultado).toBe('apto_para_activacion');
    expect(ens.rollbackVerificado).toBe(true);

    // Idempotencia del ensayo.
    const ens2: { ensId: string } = j(await app.inject({ method: 'POST', url: '/piloto/ensayar', payload: { escenario: 'exitoso' } }));
    expect(ens2.ensId).toBeTruthy();

    // Activación real → SIEMPRE denegada (409) con las autorizaciones faltantes.
    const act = await app.inject({ method: 'POST', url: '/piloto/activar', payload: { entorno: 'real_preparado' } });
    expect(act.statusCode).toBe(409);
    const body: { permitida: boolean; autorizacionesFaltantes: string[] } = act.json();
    expect(body.permitida).toBe(false);
    expect(body.autorizacionesFaltantes.some((x) => x.includes('autorización estratégica'))).toBe(true);
    await app.close();
  });

  it('los ensayos de bloqueo funcionan: onboarding incompleto, credencial pendiente (real) y activo faltante', async () => {
    const app = makeApp();
    await app.inject({ method: 'POST', url: '/piloto/preparar' });
    const inc: { resultado: string; incidencias: number } = j(await app.inject({ method: 'POST', url: '/piloto/ensayar', payload: { escenario: 'onboarding_incompleto' } }));
    expect(inc.resultado).toBe('bloqueado');
    const cred: { resultado: string } = j(await app.inject({ method: 'POST', url: '/piloto/ensayar', payload: { escenario: 'credencial_pendiente' } }));
    expect(cred.resultado).toBe('bloqueado');
    const act: { resultado: string } = j(await app.inject({ method: 'POST', url: '/piloto/ensayar', payload: { escenario: 'activo_faltante' } }));
    expect(act.resultado).toBe('bloqueado');
    await app.close();
  });

  it('el ensayo de suspensión dispara una anomalía crítica, pausa y verifica el rollback', async () => {
    const app = makeApp();
    await app.inject({ method: 'POST', url: '/piloto/preparar' });
    const sus: { resultado: string; incidencias: number; rollbackVerificado: boolean } = j(await app.inject({ method: 'POST', url: '/piloto/ensayar', payload: { escenario: 'suspension' } }));
    expect(sus.resultado).toBe('suspendido');
    expect(sus.incidencias).toBeGreaterThan(0);
    expect(sus.rollbackVerificado).toBe(true);
    await app.close();
  });
});
