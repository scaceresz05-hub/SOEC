import { describe, expect, it } from 'vitest';
import {
  clasificarTermino, extraerSnapshotActual, fechaLocal, fechaMaxima, gaqlCampanias, gaqlTerminos, mapearCampania,
  mapearTerminos, parsearSearchStream, sha1corto, ventanaIngesta,
} from '../src/ingesta/mapa-google-ads';

// Snapshot acumulado (sin segments.date): campaña ENABLED que aún no sirve → métricas 0 reales.
const BODY_SNAPSHOT = JSON.stringify([
  { results: [{ campaign: { id: '24120966895', name: 'SmileFlow Search Chile', status: 'ENABLED' }, metrics: { impressions: '0', clicks: '0', costMicros: '0' } }] },
]);
const BODY_SNAPSHOT_SIRVIENDO = JSON.stringify([
  { results: [{ campaign: { id: '24120966895', name: 'SmileFlow Search Chile', status: 'ENABLED' }, metrics: { impressions: '51', clicks: '0', costMicros: '0' } }] },
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

  it('extraerSnapshotActual toma el acumulado vigente (0 real cuando no sirve; acumulado cuando sirve)', () => {
    const cero = extraerSnapshotActual(parsearSearchStream(BODY_SNAPSHOT), '2026-08-08T12:00:00Z');
    expect(cero).not.toBeNull();
    expect(cero!.campaignId).toBe('24120966895');
    expect(cero!.campaignName).toBe('SmileFlow Search Chile');
    expect(cero!.status).toBe('ENABLED');
    expect(cero!.impressions).toBe(0); // 0 real, no ausencia
    expect(cero!.clicks).toBe(0);
    expect(cero!.cost).toBe(0);
    expect(cero!.at).toBe('2026-08-08T12:00:00Z');

    const sirviendo = extraerSnapshotActual(parsearSearchStream(BODY_SNAPSHOT_SIRVIENDO), '2026-08-10T22:00:00Z');
    expect(sirviendo!.impressions).toBe(51);
    expect(extraerSnapshotActual([], 'x')).toBeNull(); // sin filas ⇒ null (no fabrica)
  });

  it('fechaLocal calcula el día en la zona de la cuenta (América/Santiago, GMT-04/-03)', () => {
    // 2026-08-10T02:00:00Z = 2026-08-09 ~22:00 en Santiago ⇒ el día local es el 09, no el 10 (UTC).
    expect(fechaLocal('2026-08-10T02:00:00Z', 'America/Santiago')).toBe('2026-08-09');
    // 2026-08-10T12:00:00Z = 2026-08-10 ~08:00 en Santiago.
    expect(fechaLocal('2026-08-10T12:00:00Z', 'America/Santiago')).toBe('2026-08-10');
  });

  it('ventanaIngesta INCLUYE hoy (hasta = hoy local) y abarca `dias` días', () => {
    const v = ventanaIngesta('2026-08-10T12:00:00Z', 7, 'America/Santiago');
    expect(v.hasta).toBe('2026-08-10'); // hoy incluido (a diferencia de LAST_7_DAYS)
    expect(v.desde).toBe('2026-08-04'); // 7 días: 04,05,06,07,08,09,10
  });

  it('las GAQL usan BETWEEN [desde, hasta] (no el preset LAST_7_DAYS que excluye hoy)', () => {
    const c = gaqlCampanias('2026-08-04', '2026-08-10');
    expect(c).toContain("segments.date BETWEEN '2026-08-04' AND '2026-08-10'");
    expect(c).not.toContain('LAST_7_DAYS');
    const t = gaqlTerminos('2026-08-04', '2026-08-10');
    expect(t).toContain('FROM search_term_view');
    expect(t).toContain("BETWEEN '2026-08-04' AND '2026-08-10'");
    expect(t).not.toContain('LAST_7_DAYS');
  });
});
