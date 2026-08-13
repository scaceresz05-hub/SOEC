/**
 * Unit · ObservacionService.reconciliarDiagnostico — reconciliación convergente de is_test (M8).
 * Fail-closed (no crea, no toca simuladas), idempotente (no evento si ya coincide), tenant-safe.
 */
import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { ActorId, OrganizationId, type Attribution, type RequestContext } from '@soec/contracts';
import { ObservacionService, type EntradaObservacionReal } from '../src/index';

const O = '2026-08-13T00:00:00.000Z';
const attr: Attribution = { source: 'test', purpose: 'test', assumptions: [], claimType: 'observational', regime: 'empirical', uncertainty: 'baja' };
function ctx(org = 'org-x'): RequestContext {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('t'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: 'c' };
}
const OBS_ID = 'smileflow-growth:14';
const baseReal: EntradaObservacionReal = { provider: 'smileflow-growth', externalEventId: '14', eventName: 'lead_created', occurredAt: O, kpiId: 'lead_created', metrica: 'lead_created', valor: 1, unidad: 'conteo', calidad: 'alta', cobertura: 1, diagnostico: false };

describe('ObservacionService.reconciliarDiagnostico', () => {
  it('no-op si la observación no existe (fail-closed, no crea)', async () => {
    const s = new ObservacionService(new InMemoryEventStore(), {} as never);
    const r = await s.reconciliarDiagnostico(ctx(), OBS_ID, true, attr, O);
    expect(r.cambiado).toBe(false);
    expect(r.estado.existe).toBe(false);
    expect(await s.listarIds(ctx())).toHaveLength(0);
  });

  it('actualiza diagnostico false→true en una observación REAL, conservando estado/valor', async () => {
    const s = new ObservacionService(new InMemoryEventStore(), {} as never);
    await s.registrarReal(ctx(), OBS_ID, baseReal, attr, O);
    const r = await s.reconciliarDiagnostico(ctx(), OBS_ID, true, attr, O);
    expect(r.cambiado).toBe(true);
    expect(r.estado.datos?.provenanciaReal?.diagnostico).toBe(true);
    expect(r.estado.estado).toBe('VALIDADA');
    expect(r.estado.datos?.naturaleza).toBe('REAL');
    expect(r.estado.datos?.valor).toBe(1);
  });

  it('idempotente: si ya coincide, no emite evento (sin subir versión)', async () => {
    const s = new ObservacionService(new InMemoryEventStore(), {} as never);
    await s.registrarReal(ctx(), OBS_ID, baseReal, attr, O);
    const v0 = (await s.cargar(ctx(), OBS_ID)).version;
    const r = await s.reconciliarDiagnostico(ctx(), OBS_ID, false, attr, O);
    expect(r.cambiado).toBe(false);
    expect((await s.cargar(ctx(), OBS_ID)).version).toBe(v0);
  });

  it('aislamiento por organización: no reconcilia una observación de otra org', async () => {
    const s = new ObservacionService(new InMemoryEventStore(), {} as never);
    await s.registrarReal(ctx('org-a'), OBS_ID, baseReal, attr, O);
    const r = await s.reconciliarDiagnostico(ctx('org-b'), OBS_ID, true, attr, O);
    expect(r.cambiado).toBe(false);
    expect((await s.cargar(ctx('org-a'), OBS_ID)).datos?.provenanciaReal?.diagnostico).toBe(false);
  });
});
