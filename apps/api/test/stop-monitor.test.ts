/**
 * MONITOR AUTOMÁTICO de STOPS con PAUSA REAL: cuando una regla existente dispara y la campaña está ENABLED, el
 * monitor PAUSA de verdad (una sola vez) la campaña del provider binding. Sin STOP / ya PAUSED / histórica ⇒ 0 writes.
 * Idempotente. Única capacidad provider = PAUSE (adapter estructuralmente incapaz de enable/create/budget/targeting).
 */
import { describe, expect, it, vi } from 'vitest';
import { decidirMonitorStop, debeSaltarPausa, StopMonitorService, type EntradaMonitor, type DepsStopMonitor, type MetricasCampania, type UltimoStop, type ResultadoPausaProvider } from '../src/campana/stop-monitor';
import { GoogleAdsPauseAdapter } from '../src/campana/google-ads-pause-adapter';
import { construirLectorMetricasCampania, crearDepsStopMonitor } from '../src/campana/stop-monitor-composition';
import { InMemoryEventStore } from '@soec/event-store';
import type { AuthorizedExecutionEnvelope } from '../src/campana/authorized-execution-envelope';

const CAMP = 'customers/8605539300/campaigns/24194332264';
const HIST = '24120966895';
const envDe = (over: Partial<AuthorizedExecutionEnvelope> = {}): AuthorizedExecutionEnvelope => ({ id: 'env:org-smileflow:371c91ff00c6a837', organizationId: 'org-smileflow', planHash: '371c91ff00c6a837', totalCap: 30000, experimentBudget: 15000, maxSpendWithoutContact: 7500, expiresAt: null, stopRules: [], ...over } as AuthorizedExecutionEnvelope);
const entrada = (over: Partial<EntradaMonitor> = {}): EntradaMonitor => ({ envelope: envDe(), campaignBindingResourceName: CAMP, snapshotCampaignId: '24194332264', campaignStatus: 'ENABLED', spend: 0, contacts: 0, trackingValid: true, landingAvailable: true, now: '2026-08-29T12:00:00.000Z', ...over });

describe('decidirMonitorStop — reglas existentes', () => {
  it('A: spend<7500, contacts=0 ⇒ NOOP', () => { expect(decidirMonitorStop(entrada({ spend: 7499 })).action).toBe('NOOP'); });
  it('B: spend>=7500, contacts=0 ⇒ STOP_ZERO_CONVERSION', () => { const d = decidirMonitorStop(entrada({ spend: 7500 })); expect(d.action).toBe('STOP_CAMPAIGN'); expect(d.firedRuleIds).toContain('STOP_ZERO_CONVERSION'); });
  it('C: spend>=7500, contacts>=1 ⇒ NOOP', () => { expect(decidirMonitorStop(entrada({ spend: 8000, contacts: 1 })).action).toBe('NOOP'); });
  it('D: cap 30000 ⇒ STOP_BUDGET', () => { expect(decidirMonitorStop(entrada({ spend: 30000, contacts: 5 })).firedRuleIds).toContain('STOP_BUDGET'); });
  it('E: expiresAt vencido ⇒ STOP_PERIOD', () => { expect(decidirMonitorStop(entrada({ envelope: envDe({ expiresAt: '2026-09-06T23:59:59Z' }), now: '2026-09-07T00:00:01Z', contacts: 3 })).firedRuleIds).toContain('STOP_PERIOD'); });
  it('G: ya PAUSED ⇒ NOOP (aunque una regla dispararía)', () => { expect(decidirMonitorStop(entrada({ campaignStatus: 'PAUSED', spend: 30000 })).reason).toBe('ALREADY_PAUSED'); });
  it('I: métricas de la histórica ⇒ NOOP (aislamiento)', () => { const d = decidirMonitorStop(entrada({ snapshotCampaignId: HIST, spend: 30000 })); expect(d.reason).toBe('METRICS_NOT_FOR_BOUND_CAMPAIGN'); });
  it('sin binding ⇒ NOOP', () => { expect(decidirMonitorStop(entrada({ campaignBindingResourceName: null })).reason).toBe('NO_CAMPAIGN_BINDING'); });
});

// Deps de servicio con una pausa FAKE que cuenta invocaciones.
function deps(over: { metricas?: Partial<MetricasCampania>; ultimo?: UltimoStop | null; pausaOk?: boolean; conAdapter?: boolean } = {}): { deps: DepsStopMonitor; pausas: { customerId: string; resourceName: string }[]; stops: unknown[] } {
  const pausas: { customerId: string; resourceName: string }[] = [];
  const stops: unknown[] = [];
  const m: MetricasCampania = { spend: 30000, contacts: 0, trackingValid: true, landingAvailable: true, campaignStatus: 'ENABLED', snapshotCampaignId: '24194332264', ...over.metricas };
  const d: DepsStopMonitor = {
    leerEnvelope: async () => envDe(),
    leerCampaignBindingResourceName: async () => CAMP,
    leerMetricas: async () => m,
    leerUltimoStop: async () => over.ultimo ?? null,
    ...((over.conAdapter ?? true) ? { pausarCampania: async (customerId: string, resourceName: string): Promise<ResultadoPausaProvider> => { pausas.push({ customerId, resourceName }); return { ok: over.pausaOk ?? true, requestId: 'REQ-P', resourceName, errorStatus: over.pausaOk === false ? 'INVALID_ARGUMENT' : null, errorMessage: null }; } } : {}),
    registrarStop: async (_o, dec, met, outcome, pausa) => { stops.push({ action: dec.action, campaignId: dec.campaignId, outcome, requestId: pausa?.requestId ?? null }); },
    ahora: () => '2026-08-29T12:00:00.000Z',
  };
  return { deps: d, pausas, stops };
}

describe('StopMonitorService — pausa real, idempotente, fail-closed', () => {
  it('B/D/E: STOP + ENABLED ⇒ EXACTAMENTE 1 pausa real sobre la campaña del binding', async () => {
    const { deps: d, pausas, stops } = deps();
    const r = await new StopMonitorService(d).correrUnaVez('org-smileflow');
    expect(r.outcome).toBe('PAUSED');
    expect(pausas).toEqual([{ customerId: '8605539300', resourceName: CAMP }]); // 1 pausa, campaña del binding, customer del binding
    expect(stops).toHaveLength(1);
  });
  it('A/J: sin STOP (spend<7500) ⇒ 0 pausas', async () => {
    const { deps: d, pausas } = deps({ metricas: { spend: 100, contacts: 0 } });
    expect((await new StopMonitorService(d).correrUnaVez('org-smileflow')).outcome).toBe('NOOP');
    expect(pausas).toHaveLength(0);
  });
  it('F: campaña ya PAUSED ⇒ NOOP, 0 pausas', async () => {
    const { deps: d, pausas } = deps({ metricas: { campaignStatus: 'PAUSED' } });
    expect((await new StopMonitorService(d).correrUnaVez('org-smileflow')).outcome).toBe('NOOP');
    expect(pausas).toHaveLength(0);
  });
  it('G: un STOP ya ejecutado con éxito (PAUSED) ⇒ no re-pausa (idempotente)', async () => {
    const { deps: d, pausas } = deps({ ultimo: { campaignId: '24194332264', outcome: 'PAUSED' } });
    expect((await new StopMonitorService(d).correrUnaVez('org-smileflow')).outcome).toBe('ALREADY_STOPPED');
    expect(pausas).toHaveLength(0);
  });
  it('H: dos ticks — el segundo, con el primer PAUSED registrado, NO vuelve a pausar', async () => {
    let ultimo: UltimoStop | null = null; const pausas: unknown[] = [];
    const d: DepsStopMonitor = { leerEnvelope: async () => envDe(), leerCampaignBindingResourceName: async () => CAMP, leerMetricas: async () => ({ spend: 30000, contacts: 0, trackingValid: true, landingAvailable: true, campaignStatus: 'ENABLED', snapshotCampaignId: '24194332264' }), leerUltimoStop: async () => ultimo, pausarCampania: async (c, rn) => { pausas.push({ c, rn }); return { ok: true, requestId: 'R', resourceName: rn, errorStatus: null, errorMessage: null }; }, registrarStop: async (_o, dec, _m, outcome) => { ultimo = { campaignId: dec.campaignId, outcome }; }, ahora: () => 't' };
    const svc = new StopMonitorService(d);
    expect((await svc.correrUnaVez('o')).outcome).toBe('PAUSED');
    expect((await svc.correrUnaVez('o')).outcome).toBe('ALREADY_STOPPED');
    expect(pausas).toHaveLength(1); // una sola pausa efectiva
  });
  it('C: spend>=7500 con contacto ⇒ NOOP, 0 pausas', async () => {
    const { deps: d, pausas } = deps({ metricas: { spend: 9000, contacts: 2 } });
    expect((await new StopMonitorService(d).correrUnaVez('org-smileflow')).outcome).toBe('NOOP'); expect(pausas).toHaveLength(0);
  });
  it('K: la pausa provider FALLA ⇒ FAILED_STOP_EXECUTION (no falso éxito); permite reintento futuro', async () => {
    const { deps: d, stops } = deps({ pausaOk: false });
    const r = await new StopMonitorService(d).correrUnaVez('org-smileflow');
    expect(r.outcome).toBe('FAILED_STOP_EXECUTION');
    expect((stops[0] as { outcome: string }).outcome).toBe('FAILED_STOP_EXECUTION');
    // idempotencia: un FAILED previo NO bloquea el reintento (sólo un PAUSED exitoso lo hace)
    expect(debeSaltarPausa({ campaignId: '24194332264', outcome: 'FAILED_STOP_EXECUTION' }, '24194332264')).toBe(false);
    expect(debeSaltarPausa({ campaignId: '24194332264', outcome: 'PAUSED' }, '24194332264')).toBe(true);
  });
});

describe('métricas del monitor desde la campaña del binding (no la histórica)', () => {
  it('§8/§12: lector GAQL por campaignId ⇒ spend de ESA campaña; el WHERE nunca incluye la histórica', async () => {
    const queries: string[] = [];
    const buscar = async (_cid: string, q: string) => { queries.push(q); return q.includes('campaign.status') ? [{ campaign: { status: 'ENABLED' } }] : [{ metrics: { costMicros: '7500000000' } }]; };
    const m = await construirLectorMetricasCampania(buscar)('8605539300', '24194332264');
    expect(m).toEqual({ cost: 7500, status: 'ENABLED' });
    expect(queries.every((q) => q.includes('campaign.id = 24194332264'))).toBe(true);
    expect(queries.some((q) => q.includes('24120966895'))).toBe(false); // jamás consulta la histórica
  });
  it('§8: la composición produce snapshotCampaignId = campaña del binding (guard pasa) y spend real', async () => {
    const lector = async () => ({ cost: 7500, status: 'ENABLED' as string });
    const deps = crearDepsStopMonitor(new InMemoryEventStore(), null, lector);
    const m = await deps.leerMetricas('org-smileflow', CAMP);
    expect(m.snapshotCampaignId).toBe('24194332264');
    expect(m.spend).toBe(7500);
    expect(m.campaignStatus).toBe('ENABLED');
    // con esas métricas y contacts=0 ⇒ STOP_ZERO_CONVERSION (7500), NO METRICS_NOT_FOR_BOUND_CAMPAIGN
    const d = decidirMonitorStop(entrada({ snapshotCampaignId: m.snapshotCampaignId, campaignStatus: m.campaignStatus, spend: m.spend, contacts: m.contacts }));
    expect(d.action).toBe('STOP_CAMPAIGN'); expect(d.firedRuleIds).toContain('STOP_ZERO_CONVERSION');
  });
  it('§7: sin lector (métricas indisponibles) ⇒ snapshotCampaignId=null ⇒ fail-closed NOOP (no actúa con datos ajenos)', async () => {
    const deps = crearDepsStopMonitor(new InMemoryEventStore(), null, null);
    const m = await deps.leerMetricas('org-smileflow', CAMP);
    expect(m.snapshotCampaignId).toBeNull();
    expect(decidirMonitorStop(entrada({ snapshotCampaignId: null, campaignStatus: null })).action).toBe('NOOP');
  });
});

describe('GoogleAdsPauseAdapter — PAUSE-ONLY', () => {
  const fake = (res: { ok: boolean; status: number; body?: unknown }) => { const fn = vi.fn(async () => ({ ok: res.ok, status: res.status, headers: { get: (k: string) => (k.toLowerCase() === 'request-id' ? 'REQ-PA' : null) }, text: async () => JSON.stringify(res.body ?? {}), json: async () => res.body ?? {} })); return fn; };
  const adapter = (fn: ReturnType<typeof fake>) => new GoogleAdsPauseAdapter({ resolverAccessToken: async () => 'AT', developerToken: 'DT', loginCustomerId: '1742063041', fetchFn: fn as unknown as typeof fetch });
  it('I: única operación = status→PAUSED (updateMask=status); URL campaigns:mutate; nunca enable/create', async () => {
    const fn = fake({ ok: true, status: 200, body: { results: [{ resourceName: CAMP }] } });
    const r = await adapter(fn).pausarCampania('8605539300', CAMP);
    expect(r.ok).toBe(true); expect(r.resourceName).toBe(CAMP); expect(r.requestId).toBe('REQ-PA');
    const call = fn.mock.calls[0]!;
    expect(String(call[0])).toContain('/customers/8605539300/campaigns:mutate');
    const body = JSON.parse((call[1] as { body: string }).body);
    expect(body.operations[0].update).toEqual({ resourceName: CAMP, status: 'PAUSED' });
    expect(body.operations[0].updateMask).toBe('status');
    expect(JSON.stringify(body)).not.toContain('ENABLED'); // jamás habilita
    // el adapter expone SÓLO pausarCampania (sin enable/create/budget/targeting)
    expect(Object.getOwnPropertyNames(GoogleAdsPauseAdapter.prototype).filter((n) => n !== 'constructor')).toEqual(['pausarCampania']);
  });
  it('rechaza un resourceName que no es una campaña, u otro customer', async () => {
    const a = adapter(fake({ ok: true, status: 200 }));
    await expect(a.pausarCampania('8605539300', 'customers/8605539300/campaignBudgets/1')).rejects.toThrow(/RESOURCE_NAME_NO_ES_CAMPAIGN/);
    await expect(a.pausarCampania('8605539300', 'customers/9999/campaigns/1')).rejects.toThrow(/CUSTOMER_ID_MISMATCH/);
  });
  it('error de Google ⇒ ok=false sanitizado (no falso éxito)', async () => {
    const r = await adapter(fake({ ok: false, status: 400, body: { error: { status: 'INVALID_ARGUMENT', details: [{ errors: [{ errorCode: { fieldError: 'REQUIRED' }, message: 'x' }] }] } } })).pausarCampania('8605539300', CAMP);
    expect(r.ok).toBe(false); expect(r.errorStatus).toBe('INVALID_ARGUMENT'); expect(r.resourceName).toBeNull();
  });
});
