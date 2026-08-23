import { describe, expect, it } from 'vitest';
import { GAQL_CAMPANIA_SNAPSHOT, extraerSnapshotActual, parsearSearchStream } from '../src/ingesta/mapa-google-ads';

// Campaña PAUSADA con presupuesto diario 2000 CLP y métricas históricas presentes (caso del incidente P0).
const BODY_PAUSED = JSON.stringify([
  {
    results: [
      {
        campaign: { id: '24120966895', name: 'SmileFlow Search Chile', status: 'PAUSED' },
        campaignBudget: { amountMicros: '2000000000' }, // 2000 CLP/día
        metrics: { impressions: '1034', clicks: '35', costMicros: '31839000000' }, // 31.839 CLP
      },
    ],
  },
]);

describe('lectura Google Ads (read-only) para el guardrail', () => {
  it('google_ads_read_does_not_mutate: el GAQL del snapshot es SELECT puro, sin ninguna mutación', () => {
    expect(GAQL_CAMPANIA_SNAPSHOT.trim().toUpperCase().startsWith('SELECT')).toBe(true);
    for (const mut of ['mutate', 'update', 'remove', 'create', 'insert', 'delete', 'set ']) {
      expect(GAQL_CAMPANIA_SNAPSHOT.toLowerCase()).not.toContain(mut);
    }
    // Trae el presupuesto DIARIO (campaign_budget.amount_micros) — dato distinto del cap total humano.
    expect(GAQL_CAMPANIA_SNAPSHOT).toContain('campaign_budget.amount_micros');
  });

  it('daily_budget se lee (2000 CLP) y NO se confunde con el gasto ni con un cap total', () => {
    const s = extraerSnapshotActual(parsearSearchStream(BODY_PAUSED), '2026-08-19T20:00:00Z');
    expect(s!.dailyBudget).toBe(2000);
    expect(s!.cost).toBe(31839); // gasto acumulado, distinto del diario
  });

  it('paused_campaign_status_is_visible: el estado PAUSED se conserva y expone', () => {
    const s = extraerSnapshotActual(parsearSearchStream(BODY_PAUSED), '2026-08-19T20:00:00Z');
    expect(s!.status).toBe('PAUSED');
  });

  it('historical_metrics_remain_visible_when_paused: pausada NO borra las métricas históricas', () => {
    const s = extraerSnapshotActual(parsearSearchStream(BODY_PAUSED), '2026-08-19T20:00:00Z');
    expect(s!.status).toBe('PAUSED');
    expect(s!.impressions).toBe(1034);
    expect(s!.clicks).toBe(35);
    expect(s!.cost).toBe(31839);
  });
});
