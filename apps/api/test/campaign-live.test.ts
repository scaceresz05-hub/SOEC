/**
 * READ-MODEL de la campaña vigente: presupuesto/rendimiento/stops/monitor derivados de LA campaña del binding.
 * La histórica se marca aparte y su gasto no entra; el spend es EXCLUSIVO de la campaña (GAQL WHERE campaign.id);
 * monitor ACTIVA sólo con tick reciente; fail-soft por consulta; campos indisponibles ⇒ null (NUNCA 0 inventado, y
 * NUNCA null cuando Google entrega 0). Fechas del envelope autorizado con `dateSource` marcado.
 */
import { describe, expect, it } from 'vitest';
import { construirCampaignLive, construirLectorCampaignProvider, resolverFechasCampania, fechaCalendario, type EntradaCampaignLive } from '../src/campana/campaign-live';

const monBase = { configured: true, pauseWired: true, intervalSeconds: 300, lastTickAt: '2026-08-29T11:58:00Z', lastDecision: 'NOOP', lastDecisionReason: null, statusObserved: 'ENABLED', spendObserved: 0, contactsObserved: 0 } as const;
const base = (over: Partial<EntradaCampaignLive> = {}): EntradaCampaignLive => ({
  campaign: { id: '24194332264', resourceName: 'customers/8605539300/campaigns/24194332264', name: 'Experimento · SmileFlow', status: 'ENABLED', channelType: 'SEARCH', startDate: '2026-08-28', endDate: '2026-09-06' },
  experimentTotalClp: 15000, globalCapClp: 30000, zeroContactStopClp: 7500, authorizedEndDate: '2026-09-06', dateSource: 'AUTHORIZED',
  stopRulesEnabled: { zeroContact: true, budget: true, period: true, tracking: true, landing: true },
  metrics: { spendClp: 1850, impressions: 500, clicks: 20, conversions: 0 }, contacts: 0, evolution: [],
  trackingValid: true, landingAvailable: true,
  monitor: { ...monBase },
  lastGoogleReadAt: '2026-08-29T12:00:00Z', lastFirstPartyReadAt: '2026-08-29T12:00:00Z', now: '2026-08-29T12:00:00Z', historicalCampaignId: '24120966895', ...over,
});
const g = <T,>(m: Record<string, unknown>, path: string): T => path.split('.').reduce((o: unknown, k) => (o as Record<string, unknown>)?.[k], m) as T;

describe('construirCampaignLive', () => {
  it('campaña vigente (ACTIVE) con status y recursos del binding; dateSource marcado', () => {
    const m = construirCampaignLive(base());
    expect(g(m, 'campaign.id')).toBe('24194332264');
    expect(g(m, 'campaign.campaignRole')).toBe('ACTIVE');
    expect(g(m, 'campaign.status')).toBe('ENABLED');
    expect(g(m, 'campaign.dateSource')).toBe('AUTHORIZED');
    expect(g(m, 'campaign.startDate')).toBe('2026-08-28');
    expect(g(m, 'campaign.endDate')).toBe('2026-09-06');
  });
  it('M: la histórica se reporta APARTE (HISTORICAL), nunca como vigente', () => {
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
  it('A/B/D/E: métricas CERO reales se preservan como 0 (no null); remaining y stop parten de dato real', () => {
    const m = construirCampaignLive(base({ metrics: { spendClp: 0, impressions: 0, clicks: 0, conversions: 0 }, contacts: 0 }));
    expect(g(m, 'budget.spentClp')).toBe(0);           // A: 0, no null
    expect(g(m, 'budget.remainingClp')).toBe(15000);    // D: total - 0
    expect(g(m, 'budget.spentPercent')).toBe(0);
    expect(g(m, 'performance.impressions')).toBe(0);    // B
    expect(g(m, 'performance.clicks')).toBe(0);         // B
    expect(g(m, 'stops.zeroContact.currentSpendClp')).toBe(0);    // E
    expect(g(m, 'stops.zeroContact.remainingUntilStopClp')).toBe(7500); // E: 7500-0
    expect(g(m, 'stops.zeroContact.triggered')).toBe(false);
  });
  it('D/E: stop $7.500 sin contactos — remaining correcto y disparo según umbral y contactos', () => {
    const m = construirCampaignLive(base({ metrics: { spendClp: 1850, impressions: 500, clicks: 20, conversions: 0 }, contacts: 0 }));
    expect(g(m, 'stops.zeroContact.thresholdClp')).toBe(7500);
    expect(g(m, 'stops.zeroContact.remainingUntilStopClp')).toBe(5650); // 7500-1850
    expect(g(m, 'stops.zeroContact.triggered')).toBe(false);
    expect(g(construirCampaignLive(base({ metrics: { spendClp: 7500, impressions: 1, clicks: 1, conversions: 0 }, contacts: 0 })), 'stops.zeroContact.triggered')).toBe(true);
    expect(g(construirCampaignLive(base({ metrics: { spendClp: 9000, impressions: 1, clicks: 1, conversions: 0 }, contacts: 2 })), 'stops.zeroContact.triggered')).toBe(false);
  });
  it('G/H: stops.period.endDate = fin real; remainingDays en días calendario (sin off-by-one)', () => {
    const m = construirCampaignLive(base({ authorizedEndDate: '2026-09-06', now: '2026-08-29T12:00:00Z' }));
    expect(g(m, 'stops.period.endDate')).toBe('2026-09-06');
    expect(g(m, 'stops.period.remainingDays')).toBe(8); // 29-ago → 6-sep = 8 días calendario (no 9)
    expect(g(m, 'campaign.endDate')).toBe('2026-09-06');
    // día del fin ⇒ 0 días restantes (no negativo, no 1)
    expect(g(construirCampaignLive(base({ authorizedEndDate: '2026-09-06', now: '2026-09-06T23:59:00Z' })), 'stops.period.remainingDays')).toBe(0);
  });
  it('rendimiento: CTR/CPC/costo-por-contacto; null cuando el denominador es 0', () => {
    const m = construirCampaignLive(base());
    expect(g(m, 'performance.averageCpcClp')).toBe(92.5); // 1850/20
    expect(g(m, 'performance.ctr')).toBe(4);              // 20/500 *100
    expect(g(m, 'performance.costPerContactClp')).toBeNull(); // contacts=0
    expect(g(construirCampaignLive(base({ contacts: 2 })), 'performance.costPerContactClp')).toBe(925);
  });
  it('G: monitor ACTIVA sólo con tick reciente; sin tick ⇒ UNAVAILABLE; tick viejo ⇒ STALE; expone lo observado', () => {
    const m = construirCampaignLive(base());
    expect(g(m, 'monitor.status')).toBe('ACTIVE');
    expect(g(m, 'monitor.campaignStatusObserved')).toBe('ENABLED');
    expect(g(m, 'monitor.spendObserved')).toBe(0);
    expect(g(m, 'monitor.contactsObserved')).toBe(0);
    expect(g(construirCampaignLive(base({ monitor: { ...monBase, lastTickAt: null } })), 'monitor.status')).toBe('UNAVAILABLE');
    expect(g(construirCampaignLive(base({ monitor: { ...monBase, lastTickAt: '2026-08-29T11:00:00Z' } })), 'monitor.status')).toBe('STALE'); // >2.5 intervalos
  });
  it('F/G: métricas indisponibles ⇒ null en toda métrica derivada (no se inventan ceros)', () => {
    const m = construirCampaignLive(base({ metrics: { spendClp: null, impressions: null, clicks: null, conversions: null } }));
    expect(g(m, 'budget.spentClp')).toBeNull();
    expect(g(m, 'budget.remainingClp')).toBeNull();
    expect(g(m, 'stops.zeroContact.currentSpendClp')).toBeNull();
    expect(g(m, 'stops.zeroContact.remainingUntilStopClp')).toBeNull();
  });
});

describe('fechaCalendario — YYYY-MM-DD verbatim, sin off-by-one', () => {
  it('C: toma la fecha calendario tal cual; jamás convierte 28-ago a 27-ago', () => {
    expect(fechaCalendario('2026-08-28')).toBe('2026-08-28');                 // date-only
    expect(fechaCalendario('2026-08-28 00:00:00')).toBe('2026-08-28');        // v25 start_date_time ⇒ primeros 10 chars, sin parseo
    expect(fechaCalendario('2026-09-06 23:59:59')).toBe('2026-09-06');        // v25 end_date_time (con hora) ⇒ fecha calendario
  });
  it('centinela "sin fin" 2037-12-30 ⇒ null; basura/null ⇒ null', () => {
    expect(fechaCalendario('2037-12-30')).toBeNull();
    expect(fechaCalendario(null)).toBeNull();
    expect(fechaCalendario('')).toBeNull();
    expect(fechaCalendario('no-fecha')).toBeNull();
  });
});

describe('resolverFechasCampania — prioridad Google → envelope materializado → null (NUNCA createdAt)', () => {
  it('A/B/D: fechas reales de Google ⇒ dateSource=GOOGLE con start/end exactos', () => {
    const r = resolverFechasCampania({ startDate: '2026-08-28', endDate: '2026-09-06' }, { startsAt: null, expiresAt: null });
    expect(r).toEqual({ startDate: '2026-08-28', endDate: '2026-09-06', dateSource: 'GOOGLE' });
  });
  it('E: Google ausente + ventana materializada del envelope ⇒ AUTHORIZED (sólo YYYY-MM-DD)', () => {
    const r = resolverFechasCampania(null, { startsAt: '2026-08-28T03:38:45.947Z', expiresAt: '2026-09-06T03:38:45.947Z' });
    expect(r).toEqual({ startDate: '2026-08-28', endDate: '2026-09-06', dateSource: 'AUTHORIZED' });
  });
  it('F: Google ausente + envelope sin ventana materializada (createdAt NO participa) ⇒ null/null/NONE', () => {
    const r = resolverFechasCampania(null, { startsAt: null, expiresAt: null });
    expect(r).toEqual({ startDate: null, endDate: null, dateSource: 'NONE' });
  });
});

describe('construirLectorCampaignProvider — GAQL READ-ONLY por campaignId', () => {
  const ventana = { desde: '2026-08-15', hasta: '2026-08-29' };
  it('A/B/C/D: fechas Google (start/end), spend/status/evolución; WHERE por campaign.id; sin DURING; histórica excluida', async () => {
    const queries: string[] = [];
    const buscar = async (_cid: string, q: string) => {
      queries.push(q);
      if (q.includes('segments.date')) return [{ segments: { date: '2026-08-28' }, metrics: { costMicros: '1850000000', clicks: '20', impressions: '500' } }];
      if (q.includes('start_date_time')) return [{ campaign: { id: '24194332264', startDateTime: '2026-08-28 00:00:00', endDateTime: '2026-09-06 23:59:59' } }]; // v25: datetime en zona del customer
      if (q.includes('metrics.cost_micros')) return [{ metrics: { costMicros: '1850000000', impressions: '500', clicks: '20', conversions: '0' } }];
      return [{ campaign: { status: 'ENABLED', name: 'Experimento', advertisingChannelType: 'SEARCH' } }];
    };
    const p = await construirLectorCampaignProvider(buscar)('8605539300', '24194332264', ventana);
    expect(p.core).toEqual({ status: 'ENABLED', name: 'Experimento', channelType: 'SEARCH' });
    expect(p.dates).toEqual({ startDate: '2026-08-28', endDate: '2026-09-06' }); // A/B: fechas reales, C: sin off-by-one (28-ago no→27)
    expect(p.metrics?.spendClp).toBe(1850);
    expect(p.evolution).toHaveLength(1);
    expect(p.evolution[0]).toEqual({ date: '2026-08-28', spendClp: 1850, clicks: 20, impressions: 500 });
    expect(queries.every((q) => q.includes('campaign.id = 24194332264'))).toBe(true);
    expect(queries.some((q) => q.includes('24120966895'))).toBe(false); // jamás la histórica
    expect(queries.some((q) => q.includes('DURING'))).toBe(false);       // métricas sin DURING (agregado lifetime)
    expect(queries.some((q) => q.includes('campaign.start_date_time, campaign.end_date_time'))).toBe(true); // campos de fecha v25
    expect(queries.some((q) => q.includes('campaign.start_date,'))).toBe(false); // NO usa los campos eliminados en v23+
    expect(queries.some((q) => q.includes("BETWEEN '2026-08-15' AND '2026-08-29'"))).toBe(true);
  });
  it('dates: si la consulta de fechas falla ⇒ dates=null (fallback en el caller), core/metrics sobreviven', async () => {
    const buscar = async (_cid: string, q: string) => {
      if (q.includes('start_date_time')) throw new Error('GOOGLE_SEARCH_HTTP_400');
      if (q.includes('segments.date')) return [];
      if (q.includes('metrics.cost_micros')) return [{ metrics: { costMicros: '0' } }];
      return [{ campaign: { status: 'ENABLED', name: 'Experimento', advertisingChannelType: 'SEARCH' } }];
    };
    const p = await construirLectorCampaignProvider(buscar)('8605539300', '24194332264', ventana);
    expect(p.dates).toBeNull();
    expect(p.core?.status).toBe('ENABLED');
    expect(p.metrics?.spendClp).toBe(0);
  });
  it('A: Google devuelve métricas CERO (fila sin campos) ⇒ 0 real, NO null', async () => {
    const buscar = async (_cid: string, q: string) => {
      if (q.includes('segments.date')) return []; // sin actividad diaria
      if (q.includes('metrics.cost_micros')) return [{ campaign: { id: '24194332264' }, metrics: {} }]; // fila devuelta, métricas 0
      return [{ campaign: { status: 'ENABLED', name: 'Experimento', advertisingChannelType: 'SEARCH' } }];
    };
    const p = await construirLectorCampaignProvider(buscar)('8605539300', '24194332264', ventana);
    expect(p.metrics).not.toBeNull();
    expect(p.metrics?.spendClp).toBe(0);
    expect(p.metrics?.impressions).toBe(0);
    expect(p.metrics?.clicks).toBe(0);
    expect(p.evolution).toEqual([]);
  });
  it('F: si la consulta de métricas FALLA ⇒ metrics=null (indisponible), NO 0 inventado; core sobrevive', async () => {
    const buscar = async (_cid: string, q: string) => {
      if (q.includes('metrics.cost_micros') || q.includes('segments.date')) throw new Error('GOOGLE_SEARCH_HTTP_400');
      return [{ campaign: { status: 'ENABLED', name: 'Experimento', advertisingChannelType: 'SEARCH' } }];
    };
    const p = await construirLectorCampaignProvider(buscar)('8605539300', '24194332264', ventana);
    expect(p.core?.status).toBe('ENABLED'); // core (sin métricas) sobrevive
    expect(p.metrics).toBeNull();           // fail-soft: indisponible, no 0
    expect(p.evolution).toEqual([]);
  });
});
