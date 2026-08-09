import { describe, expect, it } from 'vitest';
import {
  clasificarTermino, fechaMaxima, mapearCampania, mapearCampaniaSnapshot, mapearTerminos, parsearSearchStream, sha1corto,
} from '../src/ingesta/mapa-google-ads';

// Snapshot acumulado (sin segments.date): campaña ENABLED que aún no sirve → métricas 0 reales.
const BODY_SNAPSHOT = JSON.stringify([
  { results: [{ campaign: { id: '24120966895', name: 'SmileFlow Search Chile', status: 'ENABLED' }, metrics: { impressions: '0', clicks: '0', costMicros: '0' } }] },
]);

const BODY_CAMPANIA = JSON.stringify([
  {
    results: [
      {
        campaign: { id: '24120966895', name: 'SmileFlow Search Chile', status: 'ENABLED' },
        segments: { date: '2026-08-07' },
        metrics: { impressions: '100', clicks: '5', costMicros: '1234000', averageCpc: '246800', ctr: 0.05 },
      },
    ],
  },
]);

const BODY_TERMINOS = JSON.stringify([
  {
    results: [
      {
        searchTermView: { searchTerm: 'dentista santiago' },
        campaign: { id: '24120966895' },
        segments: { date: '2026-08-07' },
        metrics: { impressions: '10', clicks: '1', costMicros: '5000' },
      },
    ],
  },
]);

describe('mapa-google-ads', () => {
  it('parsearSearchStream aplana batches → results; vacío ⇒ []', () => {
    expect(parsearSearchStream('')).toEqual([]);
    expect(parsearSearchStream(BODY_CAMPANIA)).toHaveLength(1);
  });

  it('mapearCampania produce 5 métricas por (campaña,día): cost_micros→monetario, ctr→ratio', () => {
    const obs = mapearCampania(parsearSearchStream(BODY_CAMPANIA));
    expect(obs).toHaveLength(5);
    const byMetric = Object.fromEntries(obs.map((o) => [o.metrica, o]));

    expect(byMetric.impressions!.valor).toBe(100);
    expect(byMetric.impressions!.unidad).toBe('conteo');
    expect(byMetric.clicks!.valor).toBe(5);
    expect(byMetric.cost!.valor).toBeCloseTo(1.234, 6);
    expect(byMetric.cost!.unidad).toBe('monetario');
    expect(byMetric.cpc!.valor).toBeCloseTo(0.2468, 6);
    expect(byMetric.cpc!.unidad).toBe('monetario');
    expect(byMetric.ctr!.valor).toBeCloseTo(0.05, 6);
    expect(byMetric.ctr!.unidad).toBe('ratio');

    // todas comparten provider/occurredAt/utmCampaign y no llevan PII
    for (const o of obs) {
      expect(o.provider).toBe('google-ads');
      expect(o.occurredAt).toBe('2026-08-07T00:00:00Z');
      expect(o.utmCampaign).toBe('SmileFlow Search Chile');
      expect(o.diagnostico).toBe(false);
    }
  });

  it('externalEventId de campaña es idempotente por (campaña,día,métrica)', () => {
    const a = mapearCampania(parsearSearchStream(BODY_CAMPANIA));
    const b = mapearCampania(parsearSearchStream(BODY_CAMPANIA));
    expect(a.map((o) => o.externalEventId).sort()).toEqual(b.map((o) => o.externalEventId).sort());
    const imp = a.find((o) => o.metrica === 'impressions')!;
    expect(imp.externalEventId).toBe('google-ads:campaign:24120966895:2026-08-07:impressions');
  });

  it('mapearTerminos: 2 obs por término (clicks/impressions), guarda el término en utmContent y usa sha1 en el id', () => {
    const obs = mapearTerminos(parsearSearchStream(BODY_TERMINOS));
    expect(obs).toHaveLength(2);
    const clicks = obs.find((o) => o.metrica === 'search_term_clicks')!;
    const imps = obs.find((o) => o.metrica === 'search_term_impressions')!;
    expect(clicks.valor).toBe(1);
    expect(imps.valor).toBe(10);
    expect(clicks.unidad).toBe('conteo');
    expect(clicks.utmContent).toBe('dentista santiago');
    expect(clicks.eventName).toBe('ads_search_term');
    expect(clicks.externalEventId).toBe(`google-ads:searchterm:${sha1corto('dentista santiago')}:24120966895:2026-08-07:search_term_clicks`);
    // sin PII: no hay campos personales (el término de búsqueda no lo es)
    expect(clicks.leadRef ?? null).toBeNull();
  });

  it('clasificarTermino: muestra mínima ⇒ NO_EVALUABLE; con datos suficientes clasifica', () => {
    expect(clasificarTermino('x', 0, 2)).toBe('NO_EVALUABLE');
    expect(clasificarTermino('x', 0, 0)).toBe('NO_EVALUABLE');
    expect(clasificarTermino('x', 10, 100)).toBe('RELEVANTE');
    expect(clasificarTermino('x', 1, 100)).toBe('POSIBLEMENTE_RELEVANTE');
    expect(clasificarTermino('x', 0, 100)).toBe('IRRELEVANTE');
  });

  it('fechaMaxima toma la fecha más reciente del conjunto', () => {
    expect(fechaMaxima(parsearSearchStream(BODY_CAMPANIA))).toBe('2026-08-07');
    expect(fechaMaxima([])).toBeNull();
  });

  it('mapearCampaniaSnapshot registra el estado real (0 impresiones), fechado por fechaSync e idempotente por día', () => {
    const obs = mapearCampaniaSnapshot(parsearSearchStream(BODY_SNAPSHOT), '2026-08-08');
    const byMetric = Object.fromEntries(obs.map((o) => [o.metrica, o]));
    // 0 es un valor real (no ausencia): se registra impressions/clicks/cost=0
    expect(byMetric.impressions!.valor).toBe(0);
    expect(byMetric.clicks!.valor).toBe(0);
    expect(byMetric.cost!.valor).toBe(0);
    for (const o of obs) {
      expect(o.provider).toBe('google-ads');
      expect(o.occurredAt).toBe('2026-08-08T00:00:00Z');
      expect(o.eventName.startsWith('ads_campaign_snapshot:')).toBe(true);
      expect(o.limitaciones).toContain('campaign_status=ENABLED');
    }
    expect(byMetric.impressions!.externalEventId).toBe('google-ads:campaign:24120966895:snapshot:2026-08-08:impressions');
    // idempotente por (campaña, fechaSync, métrica)
    const b = mapearCampaniaSnapshot(parsearSearchStream(BODY_SNAPSHOT), '2026-08-08');
    expect(obs.map((o) => o.externalEventId).sort()).toEqual(b.map((o) => o.externalEventId).sort());
  });
});
