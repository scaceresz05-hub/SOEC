import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { DeterministicIntelligenceProvider } from '@soec/intelligence';
import { buildApp } from '../src/app';

function makeApp() {
  return buildApp({ store: new InMemoryEventStore(), intelligence: new DeterministicIntelligenceProvider(), legacyDemoAccess: true });
}
const j = (r: { json(): unknown }) => r.json() as never;

describe('API — Decisión del primer piloto real, SmileFlow (F2-PILOT-DEC-01)', () => {
  it('registra la decisión aprobada en modo real_preparado y mantiene la activación real BLOQUEADA', async () => {
    const app = makeApp();
    expect((await app.inject({ method: 'POST', url: '/piloto/decision/preparar' })).statusCode).toBe(201);

    const est: {
      existe: boolean;
      empresa: string;
      decision: { modo: string; nivelAutonomia: number; gastoPublicitario: number; aprobacionPorPublicacion: boolean; prohibiciones: string[] };
      presupuesto: { publicidad: number; ejecutadoReal: number } | null;
      readinessReal: { resultado: string; activacionRealPermitida: boolean; bloqueos: { codigo: string }[] };
      readinessSandbox: { resultado: string };
      activacion: { permitida: boolean; loQueFaltaOperativo: string[]; loQueFaltaEstrategico: string[] };
    } = j(await app.inject({ method: 'GET', url: '/piloto/decision/estado' }));

    expect(est.existe).toBe(true);
    expect(est.empresa).toBe('SmileFlow Clinic');
    expect(est.decision.modo).toBe('real_preparado');
    expect(est.decision.nivelAutonomia).toBe(2);
    expect(est.decision.gastoPublicitario).toBe(0);
    expect(est.decision.aprobacionPorPublicacion).toBe(true);
    expect(est.decision.prohibiciones).toContain('promesas clínicas');
    // Presupuesto real ejecutado tipado en cero.
    expect(est.presupuesto?.publicidad).toBe(0);
    expect(est.presupuesto?.ejecutadoReal).toBe(0);
    // La readiness REAL está bloqueada (falta credencial real); la activación real nunca se permite.
    expect(est.readinessReal.resultado).toBe('bloqueado');
    expect(est.readinessReal.activacionRealPermitida).toBe(false);
    expect(est.readinessReal.bloqueos.some((b) => b.codigo.startsWith('canal.credencial'))).toBe(true);
    // La activación está bloqueada y el expediente lista lo que falta.
    expect(est.activacion.permitida).toBe(false);
    expect(est.activacion.loQueFaltaOperativo.some((x) => x.toLowerCase().includes('linkedin'))).toBe(true);
    expect(est.activacion.loQueFaltaEstrategico.some((x) => x.includes('autorización estratégica'))).toBe(true);

    // El endpoint de activación devuelve una denegación segura (409).
    const act = await app.inject({ method: 'POST', url: '/piloto/decision/activar' });
    expect(act.statusCode).toBe(409);
    expect((act.json() as { permitida: boolean }).permitida).toBe(false);
    await app.close();
  });
});
