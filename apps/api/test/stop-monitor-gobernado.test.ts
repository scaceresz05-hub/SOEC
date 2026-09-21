/**
 * Autonomy Fase 0 · SAFETY_PAUSE GOBERNADA.
 *
 * La pausa por stop-loss es la ÚNICA mutación externa autónoma del sistema y estaba fuera del árbol de
 * interruptores. Aquí se prueba que sigue protegiendo (cuando la organización la habilita) y que deja de
 * ocurrir cuando no lo hace o cuando el kill switch está apagado — registrando siempre el motivo.
 */
import { describe, expect, it, vi } from 'vitest';
import { StopMonitorService, type DepsStopMonitor, type MetricasCampania } from '../src/campana/stop-monitor';
import { evaluarPausaSeguridad, pausaSeguridadHabilitada } from '../src/gobierno';
import type { AuthorizedExecutionEnvelope } from '../src/campana/authorized-execution-envelope';

const ORG = 'org-smileflow';
const RN = 'customers/8605539300/campaigns/24194332264';
const AHORA = '2026-09-21T12:00:00.000Z';

/** Envelope ACTIVO con una regla de stop por cero contactos que YA disparó (gasto sobre el umbral). */
const ENVELOPE = {
  id: 'env:test', organizationId: ORG, status: 'ACTIVE', planHash: 'h', totalCap: 100_000, experimentBudget: 15_000,
  maxSpendWithoutContact: 7_500, authorizedDurationDays: 10, startsAt: '2026-09-20T00:00:00.000Z', expiresAt: '2026-09-30T00:00:00.000Z',
  authorizedChannels: ['google'], authorizedActionTypes: ['CREATE_CAMPAIGN', 'STOP_CAMPAIGN'],
  stopRules: [{ id: 'zero-contact', tipo: 'ZERO_CONTACT_SPEND', threshold: 7_500 }],
} as unknown as AuthorizedExecutionEnvelope;

const METRICAS: MetricasCampania = { spend: 9_000, contacts: 0, trackingValid: true, landingAvailable: true, campaignStatus: 'ENABLED', snapshotCampaignId: '24194332264' };

function deps(over: Partial<DepsStopMonitor> = {}): { deps: DepsStopMonitor; pausas: number; registros: Array<{ outcome: string; reason: string | null }> } {
  const registros: Array<{ outcome: string; reason: string | null }> = [];
  let pausas = 0;
  const d: DepsStopMonitor = {
    leerEnvelope: async () => ENVELOPE,
    leerCampaignBindingResourceName: async () => RN,
    leerMetricas: async () => METRICAS,
    leerUltimoStop: async () => null,
    pausarCampania: async () => { pausas += 1; return { ok: true, requestId: 'req-1', resourceName: RN, errorStatus: null, errorMessage: null }; },
    registrarStop: async (_o, decision, _m, outcome) => { registros.push({ outcome, reason: decision.reason }); },
    ahora: () => AHORA,
    ...over,
  };
  return { deps: d, get pausas() { return pausas; }, registros } as never;
}

describe('SAFETY_PAUSE habilitada · SmileFlow conserva su protección', () => {
  it('la organización declara la pausa automática en su registro', () => {
    expect(pausaSeguridadHabilitada(ORG)).toBe(true);
    const v = evaluarPausaSeguridad(ORG, {} as NodeJS.ProcessEnv);
    expect(v.permitido).toBe(true);
  });

  it('con permiso, la regla que dispara pausa de verdad una sola vez', async () => {
    const pausar = vi.fn(async () => ({ ok: true, requestId: 'req-1', resourceName: RN, errorStatus: null, errorMessage: null }));
    const registros: Array<{ outcome: string }> = [];
    const svc = new StopMonitorService({
      ...deps().deps,
      pausarCampania: pausar,
      registrarStop: async (_o, _d, _m, outcome) => { registros.push({ outcome }); },
      permitirPausaSegura: () => ({ permitido: true, motivo: 'SAFETY_PAUSE_ENABLED' }),
    });
    const r = await svc.correrUnaVez(ORG);
    expect(r.decision.action).toBe('STOP_CAMPAIGN');
    expect(r.outcome).toBe('PAUSED');
    expect(pausar).toHaveBeenCalledTimes(1);
    expect(registros[0]?.outcome).toBe('PAUSED');
  });
});

describe('SAFETY_PAUSE denegada · 0 escrituras al proveedor', () => {
  it('política de la organización deshabilitada ⇒ no se toca al proveedor y queda el motivo', async () => {
    const pausar = vi.fn(async () => ({ ok: true, requestId: null, resourceName: null, errorStatus: null, errorMessage: null }));
    const registros: Array<{ outcome: string; reason: string | null }> = [];
    const svc = new StopMonitorService({
      ...deps().deps,
      pausarCampania: pausar,
      registrarStop: async (_o, decision, _m, outcome) => { registros.push({ outcome, reason: decision.reason }); },
      permitirPausaSegura: () => ({ permitido: false, motivo: 'SAFETY_PAUSE_NOT_ENABLED' }),
    });
    const r = await svc.correrUnaVez(ORG);
    expect(r.decision.action).toBe('STOP_CAMPAIGN'); // la decisión se toma igual: la evidencia no se oculta
    expect(r.outcome).toBe('SAFETY_PAUSE_DENIED');
    expect(pausar).not.toHaveBeenCalled();
    expect(registros[0]?.reason).toContain('SAFETY_PAUSE_NOT_ENABLED');
  });

  it('kill switch apagado ⇒ denegada aunque la organización la tenga habilitada', async () => {
    const v = evaluarPausaSeguridad(ORG, { SOEC_EXTERNAL_MUTATIONS: 'off' } as NodeJS.ProcessEnv);
    expect(v.permitido).toBe(false);
    expect(v.permitido === false && v.motivo).toBe('EXTERNAL_MUTATIONS_DISABLED');

    const pausar = vi.fn(async () => ({ ok: true, requestId: null, resourceName: null, errorStatus: null, errorMessage: null }));
    const svc = new StopMonitorService({
      ...deps().deps,
      pausarCampania: pausar,
      permitirPausaSegura: (org) => { const x = evaluarPausaSeguridad(org, { SOEC_EXTERNAL_MUTATIONS: 'off' } as NodeJS.ProcessEnv); return { permitido: x.permitido, motivo: x.motivo }; },
    });
    expect((await svc.correrUnaVez(ORG)).outcome).toBe('SAFETY_PAUSE_DENIED');
    expect(pausar).not.toHaveBeenCalled();
  });

  it('sin gobierno inyectado ⇒ denegada (fail-closed): un monitor sin política no muta nada', async () => {
    const pausar = vi.fn(async () => ({ ok: true, requestId: null, resourceName: null, errorStatus: null, errorMessage: null }));
    const svc = new StopMonitorService({ ...deps().deps, pausarCampania: pausar });
    expect((await svc.correrUnaVez(ORG)).outcome).toBe('SAFETY_PAUSE_DENIED');
    expect(pausar).not.toHaveBeenCalled();
  });

  it('una organización sin política declarada (CP) no recibe pausas automáticas', () => {
    expect(pausaSeguridadHabilitada('org-cp-odontologia')).toBe(false);
    const v = evaluarPausaSeguridad('org-cp-odontologia', {} as NodeJS.ProcessEnv);
    expect(v.permitido).toBe(false);
    expect(v.permitido === false && v.motivo).toBe('SAFETY_PAUSE_NOT_ENABLED');
  });
});
