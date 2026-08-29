/**
 * READ-MODEL de la campaña vigente: presupuesto/rendimiento/stops/monitor derivados de LA campaña del binding.
 * La histórica se marca aparte y su gasto no entra; el spend es EXCLUSIVO de la campaña (GAQL WHERE campaign.id);
 * monitor ACTIVA sólo con tick reciente; fail-soft por consulta; campos indisponibles ⇒ null.
 */
import { describe, expect, it } from 'vitest';
import { construirCampaignLive, construirLectorCampaignProvider, type EntradaCampaignLive } from '../src/campana/campaign-live';

const base = (over: Partial<EntradaCampaignLive> = {}): EntradaCampaignLive => ({
  campaign: { id: '24194332264', resourceName: 'customers/8605539300/campaigns/24194332264', name: 'Experimento · SmileFlow', status: 'PAUSED', channelType: 'SEARCH', startDate: '2026-08-28', endDate: '2026-09-06' },
  experimentTotalClp: 15000, globalCapClp: 30000, zeroContactStopClp: 7500, authorizedEndDate: '2026-09-06',
  stopRulesEnabled: { zeroContact: true, budget: true, period: true, tracking: true, landing: true },
  metrics: { spendClp: 1850, impressions: 500, clicks: 20, conversions: 0 }, contacts: 0, evolution: [],
  trackingValid: true, landingAvailable: true,
  monitor: { configured: true, pauseWired: true, intervalSeconds: 300, lastTickAt: '2026-08-29T11:58:00Z', lastDecision: 'NOOP', lastDecisionReason: 'ALREADY_PAUSED' },
  lastGoogleReadAt: '2026-08-29T12:00:00Z', lastFirstPartyReadAt: '2026-08-29T12:00:00Z', now: '2026-08-29T12:00:00Z', historicalCampaignId: '24120966895', ...over,
});
const g = <T,>(m: Record<string, unknown>, path: string): T => path.split('.').reduce((o: unknown, k) => (o as Record<string, unknown>)?.[k], m) as T;

describe('construirCampaignLive', () => {
  it('A/F: campaña vigente (ACTIVE) con status y recursos del binding', () => {
    const m = construirCampaignLive(base());
    expect(g(m, 'campaign.id')).toBe('24194332264');
    expect(g(m, 'campaign.campaignRole')).toBe('ACTIVE');
    expect(g(m, 'campaign.status')).toBe('PAUSED');
  });
  it('B: la histórica se reporta APARTE (HISTORICAL), nunca como vigente', () => {
    const m = construirCampaignLive(base());
    expect(g(m, 'historical.id')).toBe('24120966895');
    expect(g(m, 'historical.campaignRole')).toBe('HISTORICAL');
    expect(g(m, 'campaign.id')).not.toBe('24120966895');
  });
  it('C: budget — spent/remaining/percent de LA campaña (spend 1850 de 15000)', () => {
    const m = construirCampaignLive(base());
    expect(g(m, 'budget.totalClp')).toBe(15000);
    expect(g(m, 'budget.spentClp')).toBe(1850);
    expect(g(m, 'budget.remainingClp')).toBe(13150);
    expect(g(m, 'budget.spentPercent')).toBeCloseTo(12.33, 1);
  });
  it('D/E: stop $7.500 sin contactos — remaining correcto y no disparado bajo umbral', () => {
    const m = construirCampaignLive(base({ metrics: { spendClp: 1850, impressions: 500, clicks: 20, conversions: 0 }, contacts: 0 }));
    expect(g(m, 'stops.zeroContact.thresholdClp')).toBe(7500);
    expect(g(m, 'stops.zeroContact.remainingUntilStopClp')).toBe(5650); // 7500-1850
    expect(g(m, 'stops.zeroContact.triggered')).toBe(false);
    expect(g(m, 'stops.zeroContact.hasContact')).toBe(false);
    // en 7500 sin contactos ⇒ triggered
    expect(g(construirCampaignLive(base({ metrics: { spendClp: 7500, impressions: 1, clicks: 1, conversions: 0 }, contacts: 0 })), 'stops.zeroContact.triggered')).toBe(true);
    // con contacto ⇒ no dispara aunque supere 7500
    expect(g(construirCampaignLive(base({ metrics: { spendClp: 9000, impressions: 1, clicks: 1, conversions: 0 }, contacts: 2 })), 'stops.zeroContact.triggered')).toBe(false);
  });
  it('rendimiento: CTR/CPC/costo-por-contacto; null cuando el denominador es 0', () => {
    const m = construirCampaignLive(base());
    expect(g(m, 'performance.averageCpcClp')).toBe(92.5); // 1850/20
    expect(g(m, 'performance.ctr')).toBe(4);              // 20/500 *100
    expect(g(m, 'performance.costPerContactClp')).toBeNull(); // contacts=0
    expect(g(construirCampaignLive(base({ contacts: 2 })), 'performance.costPerContactClp')).toBe(925);
  });
  it('G: monitor ACTIVA sólo con tick reciente; sin tick ⇒ UNAVAILABLE; tick viejo ⇒ STALE', () => {
    expect(g(construirCampaignLive(base()), 'monitor.status')).toBe('ACTIVE');
    expect(g(construirCampaignLive(base({ monitor: { configured: true, pauseWired: true, intervalSeconds: 300, lastTickAt: null, lastDecision: null, lastDecisionReason: null } })), 'monitor.status')).toBe('UNAVAILABLE');
    expect(g(construirCampaignLive(base({ monitor: { configured: true, pauseWired: true, intervalSeconds: 300, lastTickAt: '2026-08-29T11:00:00Z', lastDecision: 'NOOP', lastDecisionReason: 'x' } })), 'monitor.status')).toBe('STALE'); // >2.5 intervalos
  });
  it('métricas indisponibles ⇒ null en toda métrica derivada (no se inventan ceros)', () => {
    const m = construirCampaignLive(base({ metrics: { spendClp: null, impressions: null, clicks: null, conversions: null } }));
    expect(g(m, 'budget.spentClp')).toBeNull();
    expect(g(m, 'budget.remainingClp')).toBeNull();
    expect(g(m, 'stops.zeroContact.remainingUntilStopClp')).toBeNull();
  });
});

describe('construirLectorCampaignProvider — GAQL READ-ONLY por campaignId', () => {
  it('C/H: spend/status/evolución de LA campaña; el WHERE filtra por campaign.id (histórica excluida); fail-soft', async () => {
    const queries: string[] = [];
    const buscar = async (_cid: string, q: string) => {
      queries.push(q);
      if (q.includes('campaign.start_date')) throw new Error('UNRECOGNIZED_FIELD'); // v23+ ⇒ fail-soft ⇒ dates null
      if (q.includes('segments.date')) return [{ segments: { date: '2026-08-28' }, metrics: { costMicros: '1850000000', clicks: '20', impressions: '500' } }];
      if (q.includes('metrics.cost_micros')) return [{ metrics: { costMicros: '1850000000', impressions: '500', clicks: '20', conversions: '0' } }];
      return [{ campaign: { status: 'PAUSED', name: 'Experimento', advertisingChannelType: 'SEARCH' } }];
    };
    const p = await construirLectorCampaignProvider(buscar)('8605539300', '24194332264');
    expect(p.core).toEqual({ status: 'PAUSED', name: 'Experimento', channelType: 'SEARCH' });
    expect(p.dates).toBeNull();                 // fail-soft
    expect(p.metrics?.spendClp).toBe(1850);
    expect(p.evolution).toHaveLength(1);
    expect(p.evolution[0]).toEqual({ date: '2026-08-28', spendClp: 1850, clicks: 20, impressions: 500 });
    expect(queries.every((q) => q.includes('campaign.id = 24194332264'))).toBe(true);
    expect(queries.some((q) => q.includes('24120966895'))).toBe(false); // jamás la histórica
  });
});
