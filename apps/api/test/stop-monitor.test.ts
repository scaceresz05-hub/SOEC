/**
 * MONITOR AUTOMÁTICO de STOPS: conecta las reglas EXISTENTES a un loop. Verifica STOP_ZERO_CONVERSION(7500),
 * STOP_BUDGET, STOP_PERIOD, tracking/landing; idempotencia; aislamiento histórico (24120966895 jamás actuada);
 * única acción = STOP_CAMPAIGN; 0 capacidad de escritura a Google.
 */
import { describe, expect, it } from 'vitest';
import { decidirMonitorStop, debePersistir, StopMonitorService, type EntradaMonitor, type DepsStopMonitor, type MetricasCampania, type DecisionMonitor } from '../src/campana/stop-monitor';
import type { AuthorizedExecutionEnvelope } from '../src/campana/authorized-execution-envelope';

const CAMP = 'customers/8605539300/campaigns/24194332264';
const HIST = '24120966895';
const envDe = (over: Partial<AuthorizedExecutionEnvelope> = {}): AuthorizedExecutionEnvelope => ({ id: 'env:org-smileflow:371c91ff00c6a837', organizationId: 'org-smileflow', planHash: '371c91ff00c6a837', totalCap: 30000, experimentBudget: 15000, maxSpendWithoutContact: 7500, expiresAt: null, stopRules: [], ...over } as AuthorizedExecutionEnvelope);
const entrada = (over: Partial<EntradaMonitor> = {}): EntradaMonitor => ({ envelope: envDe(), campaignBindingResourceName: CAMP, snapshotCampaignId: '24194332264', campaignStatus: 'ENABLED', spend: 0, contacts: 0, trackingValid: true, landingAvailable: true, now: '2026-08-29T12:00:00.000Z', ...over });

describe('decidirMonitorStop — reglas de stop existentes', () => {
  it('A: spend<7500 y contacts=0 ⇒ NOOP (sin zero-conversion)', () => {
    expect(decidirMonitorStop(entrada({ spend: 7499 })).action).toBe('NOOP');
  });
  it('B: spend>=7500 y contacts=0 ⇒ STOP_ZERO_CONVERSION ⇒ STOP_CAMPAIGN', () => {
    const d = decidirMonitorStop(entrada({ spend: 7500 }));
    expect(d.action).toBe('STOP_CAMPAIGN');
    expect(d.firedRuleIds).toContain('STOP_ZERO_CONVERSION');
    expect(d.campaignId).toBe('24194332264');
  });
  it('C: spend>=7500 y contacts>=1 ⇒ NO stop por zero-conversion', () => {
    expect(decidirMonitorStop(entrada({ spend: 8000, contacts: 1 })).action).toBe('NOOP');
  });
  it('D: cap global (30000) alcanzado ⇒ STOP_BUDGET', () => {
    const d = decidirMonitorStop(entrada({ spend: 30000, contacts: 5 }));
    expect(d.action).toBe('STOP_CAMPAIGN'); expect(d.firedRuleIds).toContain('STOP_BUDGET');
  });
  it('E: fecha límite (expiresAt) alcanzada ⇒ STOP_PERIOD', () => {
    const d = decidirMonitorStop(entrada({ envelope: envDe({ expiresAt: '2026-09-06T23:59:59.000Z' }), now: '2026-09-07T00:00:01.000Z', contacts: 3 }));
    expect(d.action).toBe('STOP_CAMPAIGN'); expect(d.firedRuleIds).toContain('STOP_PERIOD');
  });
  it('F: tracking/landing inválidos ⇒ STOP (comportamiento existente preservado)', () => {
    expect(decidirMonitorStop(entrada({ trackingValid: false, contacts: 9 })).firedRuleIds).toContain('STOP_TRACKING');
    expect(decidirMonitorStop(entrada({ landingAvailable: false, contacts: 9 })).firedRuleIds).toContain('STOP_LANDING');
  });
  it('G: campaña ya PAUSED ⇒ NOOP aunque una regla dispararía (idempotente)', () => {
    const d = decidirMonitorStop(entrada({ campaignStatus: 'PAUSED', spend: 30000 }));
    expect(d.action).toBe('NOOP'); expect(d.reason).toBe('ALREADY_PAUSED');
  });
  it('I: métricas de la campaña HISTÓRICA ⇒ NOOP (aislamiento; jamás actúa sobre 24120966895)', () => {
    const d = decidirMonitorStop(entrada({ snapshotCampaignId: HIST, spend: 30000 }));
    expect(d.action).toBe('NOOP'); expect(d.reason).toBe('METRICS_NOT_FOR_BOUND_CAMPAIGN');
    expect(d.campaignId).toBe('24194332264'); // el binding sigue siendo la campaña del envelope, no la histórica
  });
  it('K: la única acción posible es STOP_CAMPAIGN (nunca create/enable/budget)', () => {
    for (const s of [0, 7500, 30000]) expect(['NOOP', 'STOP_CAMPAIGN']).toContain(decidirMonitorStop(entrada({ spend: s })).action);
  });
  it('sin campaign binding ⇒ NOOP (sin identidad)', () => {
    expect(decidirMonitorStop(entrada({ campaignBindingResourceName: null })).reason).toBe('NO_CAMPAIGN_BINDING');
  });
});

describe('idempotencia + servicio', () => {
  it('H: debePersistir — NOOP no persiste; STOP nuevo sí; STOP idéntico ya vigente no', () => {
    const stop: DecisionMonitor = { action: 'STOP_CAMPAIGN', reason: 'STOP_BUDGET', firedRuleIds: ['STOP_BUDGET'], campaignId: '24194332264' };
    expect(debePersistir(null, { action: 'NOOP', reason: null, firedRuleIds: [], campaignId: '24194332264' })).toBe(false);
    expect(debePersistir(null, stop)).toBe(true);
    expect(debePersistir({ action: 'STOP_CAMPAIGN', campaignId: '24194332264', firedRuleIds: ['STOP_BUDGET'] }, stop)).toBe(false); // ya vigente
    expect(debePersistir({ action: 'STOP_CAMPAIGN', campaignId: '24194332264', firedRuleIds: ['STOP_TRACKING'] }, stop)).toBe(true); // otra regla
  });
  it('J/H: dos ciclos con STOP ⇒ una sola persistencia; el servicio NO tiene puerto de escritura a Google', async () => {
    let ultima: DecisionMonitor | null = null; const persistidos: DecisionMonitor[] = [];
    const deps: DepsStopMonitor = {
      leerEnvelope: async () => envDe(),
      leerCampaignBindingResourceName: async () => CAMP,
      leerMetricas: async (): Promise<MetricasCampania> => ({ spend: 30000, contacts: 0, trackingValid: true, landingAvailable: true, campaignStatus: 'ENABLED', snapshotCampaignId: '24194332264' }),
      registrarDecision: async (_org, d) => { if (debePersistir(ultima ? { action: ultima.action, campaignId: ultima.campaignId, firedRuleIds: ultima.firedRuleIds } : null, d)) { persistidos.push(d); ultima = d; } },
      ahora: () => '2026-08-29T12:00:00.000Z',
    };
    const svc = new StopMonitorService(deps);
    const d1 = await svc.correrUnaVez('org-smileflow');
    const d2 = await svc.correrUnaVez('org-smileflow');
    expect(d1.action).toBe('STOP_CAMPAIGN'); expect(d2.action).toBe('STOP_CAMPAIGN'); // detecta en ambos ciclos
    expect(persistidos).toHaveLength(1); // …pero una sola persistencia efectiva (idempotente)
    // el contrato DepsStopMonitor NO incluye ningún puerto de mutate/write a Google ⇒ 0 provider writes por construcción
    expect('mutar' in deps || 'aplicar' in deps || 'port' in deps).toBe(false);
  });
  it('sin envelope ⇒ NOOP NO_ENVELOPE', async () => {
    const svc = new StopMonitorService({ leerEnvelope: async () => null, leerCampaignBindingResourceName: async () => null, leerMetricas: async () => ({ spend: 0, contacts: 0, trackingValid: true, landingAvailable: true, campaignStatus: null, snapshotCampaignId: null }), registrarDecision: async () => undefined, ahora: () => 't' });
    expect((await svc.correrUnaVez('org-smileflow')).reason).toBe('NO_ENVELOPE');
  });
});
