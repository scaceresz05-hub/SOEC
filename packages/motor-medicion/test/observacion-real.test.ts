/**
 * @soec/motor-medicion · tests · PUERTA REAL GOBERNADA (Opción C).
 *
 * Verifica que: (1) el invariante se preserva — `registrar()` sigue rechazando REAL; (2) `registrarReal()`
 * exige procedencia externa y produce una observación REAL ya VALIDADA; (3) rechaza evidencia incompleta;
 * (4) es idempotente/replay-safe por observacionId (provider+externalEventId); (5) conserva la naturaleza REAL
 * y el flag diagnóstico. Sin PII.
 */
import { describe, it, expect } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { ActorId, OrganizationId, type Attribution, type RequestContext } from '@soec/contracts';
import { ObservacionService, type EntradaObservacion, type EntradaObservacionReal } from '../src/index';
import { observacionMedible } from '../src/dominio/observacion';

const attr: Attribution = { source: 'm8', purpose: 'test', assumptions: ['t'], claimType: 'observational', regime: 'empirical', uncertainty: 'media' };
const O = '2026-08-08T13:40:00.000Z';
function ctx(org = 'org-a'): RequestContext {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('director'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: 't' };
}
// registrarReal NO usa LecturaOperativa: stub vacío.
function svc(): ObservacionService { return new ObservacionService(new InMemoryEventStore(), {} as never); }

const OBS_ID = 'smileflow-growth::367';
const baseReal: EntradaObservacionReal = {
  provider: 'smileflow-growth', externalEventId: '367', eventName: 'demo_requested',
  occurredAt: '2026-08-08T13:32:22.000Z', kpiId: 'demo_requested', metrica: 'demo_requested',
  valor: 1, unidad: 'conteo', calidad: 'alta', cobertura: 1, utmSource: 'google', utmCampaign: 'sw-dental-cl',
};

describe('M8 · puerta REAL gobernada', () => {
  it('registrar() SIGUE rechazando REAL (invariante preservado)', async () => {
    const s = svc();
    const entrada = { ordenId: 'orden1', hipotesisId: null, kpiId: 'ctr', instante: O, fuente: 'x', metrica: 'ctr',
      valor: 0.06, unidad: 'ratio', naturaleza: 'REAL', calidad: 'alta', cobertura: 1 } as unknown as EntradaObservacion;
    await expect(s.registrar(ctx(), 'obs-x', entrada, attr, O)).rejects.toThrow(/REAL/i);
  });

  it('registrarReal() produce una observación REAL ya VALIDADA y medible', async () => {
    const s = svc();
    const st = await s.registrarReal(ctx(), OBS_ID, baseReal, attr, O);
    expect(st.existe).toBe(true);
    expect(st.estado).toBe('VALIDADA');
    expect(st.datos?.naturaleza).toBe('REAL');
    expect(st.datos?.provenanciaReal?.provider).toBe('smileflow-growth');
    expect(st.datos?.provenanciaReal?.externalEventId).toBe('367');
    expect(st.datos?.provenanciaReal?.ingestedAt).toBe(O);
    expect(observacionMedible(st)).toBe(true);
    // aparece en el índice
    expect(await s.listarIds(ctx())).toContain(OBS_ID);
  });

  it('registrarReal() rechaza evidencia incompleta (procedencia obligatoria)', async () => {
    const s = svc();
    for (const campo of ['provider', 'externalEventId', 'eventName', 'occurredAt'] as const) {
      const roto = { ...baseReal, [campo]: '' };
      await expect(s.registrarReal(ctx(), `obs-${campo}`, roto, attr, O)).rejects.toThrow();
    }
  });

  it('es idempotente / replay-safe por observacionId (misma ingesta → 1 observación)', async () => {
    const s = svc();
    const c = ctx();
    const a = await s.registrarReal(c, OBS_ID, baseReal, attr, O);
    const b = await s.registrarReal(c, OBS_ID, baseReal, attr, O); // replay
    const d = await s.registrarReal(c, OBS_ID, baseReal, attr, O); // replay
    expect(a.version).toBe(b.version);
    expect(b.version).toBe(d.version);
    expect((await s.listarIds(c)).filter((x) => x === OBS_ID).length).toBe(1);
  });

  it('conserva el flag diagnóstico para excluir TEST/DIAG del aprendizaje', async () => {
    const s = svc();
    const st = await s.registrarReal(ctx(), 'smileflow-growth::999', { ...baseReal, externalEventId: '999', diagnostico: true }, attr, O);
    expect(st.datos?.provenanciaReal?.diagnostico).toBe(true);
  });

  it('no transporta PII: datos sólo contiene identificadores/atribución', async () => {
    const s = svc();
    const st = await s.registrarReal(ctx(), OBS_ID, baseReal, attr, O);
    const serial = JSON.stringify(st.datos);
    for (const pii of ['email', 'telefono', 'phone', 'nombre', '@', 'rut']) expect(serial.toLowerCase()).not.toContain(pii);
  });
});
