import { describe, expect, it } from 'vitest';
import { construirPanel, type ObsPanel, type Sync } from '../src/ingesta/panel-resultados';
import type { SnapshotAdsActual } from '../src/ingesta/mapa-google-ads';

// Snapshot acumulado vigente (stream dedicado): campaña ENABLED que aún no sirve → 0 impresiones/clics/coste.
const SNAP_CERO: SnapshotAdsActual = {
  campaignId: '24120966895', campaignName: 'SmileFlow Search Chile', status: 'ENABLED',
  impressions: 0, clicks: 0, cost: 0, at: '2026-08-08T09:05:00Z',
};

const growth = (eventName: string, diagnostico: boolean, i: number): ObsPanel => ({
  provider: 'smileflow-growth',
  eventName,
  metrica: null,
  valor: 1,
  occurredAt: `2026-08-0${i}T10:00:00Z`,
  diagnostico,
  utmCampaign: null,
  utmContent: null,
  limitaciones: [],
  externalEventId: `smileflow-growth:evt-${eventName}-${i}-${diagnostico ? 'd' : 'c'}`,
});

const OBS: ObsPanel[] = [
  growth('demo_cta_clicked', false, 1),
  growth('demo_cta_clicked', false, 2),
  growth('demo_form_started', false, 3),
  growth('demo_requested', false, 4),
  growth('demo_requested', true, 5), // DIAGNÓSTICO: no debe contar como comercial
  growth('lead_created', false, 6),
];

const SYNCS: Sync[] = [
  { provider: 'smileflow-growth', ok: true, at: '2026-08-08T09:00:00Z', estado: 'OK' },
  { provider: 'google-ads', ok: true, at: '2026-08-08T09:05:00Z', estado: 'OK' },
];

describe('construirPanel', () => {
  const panel = construirPanel(OBS, SYNCS, SNAP_CERO);

  it('extrae nombre, estado e id de campaña del snapshot acumulado vigente', () => {
    expect(panel.campaign.name).toBe('SmileFlow Search Chile');
    expect(panel.campaign.status).toBe('ENABLED');
    expect(panel.campaign.id).toBe('24120966895');
  });

  it('ctr y cpc son null (no 0) cuando el denominador es 0', () => {
    expect(panel.ads.impressions).toBe(0);
    expect(panel.ads.clicks).toBe(0);
    expect(panel.ads.cost).toBe(0);
    expect(panel.ads.ctr).toBeNull();
    expect(panel.ads.cpc).toBeNull();
    expect(panel.ads.sinDatos).toBe(true);
  });

  it('sin snapshot ⇒ cabecera y cifras Ads en null (nunca 0 fabricado)', () => {
    const vacio = construirPanel(OBS, SYNCS, null);
    expect(vacio.campaign).toEqual({ name: null, status: null, id: null });
    expect(vacio.ads.impressions).toBeNull();
    expect(vacio.ads.ctr).toBeNull();
    expect(vacio.ads.cpc).toBeNull();
    expect(vacio.ads.sinDatos).toBe(true);
  });

  it('el embudo comercial cuenta bien y EXCLUYE el diagnóstico', () => {
    expect(panel.growthFunnel.comercial).toEqual({
      demo_cta_clicked: 2, demo_form_started: 1, demo_requested: 1, lead_created: 1,
    });
    expect(panel.growthFunnel.diagnostico).toEqual({
      demo_cta_clicked: 0, demo_form_started: 0, demo_requested: 1, lead_created: 0,
    });
  });

  it('atribución PENDIENTE (no se calcula join Ads↔Growth)', () => {
    expect(panel.atribucion).toEqual({ demosAtribuiblesAds: null, costePorDemo: null, estado: 'PENDIENTE' });
  });

  it('lecturaSoec afirma el hecho (0 impresiones) sin recomendar', () => {
    expect(panel.lecturaSoec).toContain('0 impresiones');
  });

  it('searchTerms vacío cuando no hay términos', () => {
    expect(panel.searchTerms).toEqual([]);
  });

  it('propaga sincronizaciones y modo OBSERVE_ONLY', () => {
    expect(panel.sincronizaciones).toEqual(SYNCS);
    expect(panel.modo).toBe('OBSERVE_ONLY');
  });

  it('refleja el acumulado vigente (incluye hoy) y agrega términos de búsqueda por utmContent', () => {
    const snapHoy: SnapshotAdsActual = { campaignId: '24120966895', campaignName: 'SmileFlow Search Chile', status: 'ENABLED', impressions: 200, clicks: 10, cost: 5000, at: '2026-08-10T22:00:00Z' };
    const conDatos = construirPanel(
      [
        { provider: 'google-ads', eventName: 'ads_search_term', metrica: 'search_term_impressions', valor: 30, occurredAt: '2026-08-10T00:00:00Z', diagnostico: false, utmCampaign: null, utmContent: 'dentista santiago', limitaciones: [], externalEventId: 'google-ads:searchterm:x:1:2026-08-10:search_term_impressions' },
        { provider: 'google-ads', eventName: 'ads_search_term', metrica: 'search_term_clicks', valor: 3, occurredAt: '2026-08-10T00:00:00Z', diagnostico: false, utmCampaign: null, utmContent: 'dentista santiago', limitaciones: [], externalEventId: 'google-ads:searchterm:x:1:2026-08-10:search_term_clicks' },
      ],
      SYNCS,
      snapHoy,
    );
    expect(conDatos.ads.impressions).toBe(200);
    expect(conDatos.ads.ctr).toBeCloseTo(10 / 200, 6);
    expect(conDatos.ads.cpc).toBeCloseTo(5000 / 10, 6);
    expect(conDatos.ads.sinDatos).toBe(false);
    expect(conDatos.searchTerms).toEqual([{ termino: 'dentista santiago', impresiones: 30, clics: 3 }]);
    expect(conDatos.lecturaSoec).not.toContain('Todavía no hay suficientes datos');
  });

  it('con 1 impresión usa singular ("impresión")', () => {
    const snap1: SnapshotAdsActual = { campaignId: '1', campaignName: 'c', status: 'ENABLED', impressions: 1, clicks: 0, cost: 0, at: '2026-08-10T22:00:00Z' };
    const p = construirPanel([], SYNCS, snap1);
    expect(p.lecturaSoec).toContain('1 impresión ');
    expect(p.ads.ctr).toBe(0); // 0 clics / 1 impresión = 0 (impresiones > 0 ⇒ calculable)
    expect(p.ads.cpc).toBeNull(); // 0 clics ⇒ NO_CALCULABLE
  });
});

// ── Trazabilidad Google Ads: source / capturedAt / período ALL_TIME / stale / no-data ──────────────
const SNAP_REAL: SnapshotAdsActual = {
  campaignId: '24120966895', campaignName: 'SmileFlow Search Chile', status: 'ENABLED',
  impressions: 556, clicks: 22, cost: 13842.571271, at: '2026-08-16T00:24:06.440Z',
  startDate: '2026-07-01', endDate: null,
};

describe('construirPanel · trazabilidad Google Ads', () => {
  it('snapshot con valores: source, capturedAt y período ALL_TIME (from=inicio campaña, to=capturedAt)', () => {
    const p = construirPanel([], SYNCS, SNAP_REAL, '2026-08-16T01:00:00Z');
    expect(p.ads.source).toBe('GOOGLE_ADS');
    expect(p.ads.impressions).toBe(556);
    expect(p.ads.clicks).toBe(22);
    expect(p.ads.cost).toBe(13842.571271); // exacto del event store, sin redondear
    expect(p.ads.capturedAt).toBe('2026-08-16T00:24:06.440Z');
    expect(p.ads.period).toEqual({ kind: 'ALL_TIME', from: '2026-07-01', to: '2026-08-16T00:24:06.440Z' });
    expect(p.ads.sinDatos).toBe(false);
  });
  it('fresco (dentro del umbral) ⇒ no stale; viejo ⇒ stale, nunca como actual', () => {
    expect(construirPanel([], SYNCS, SNAP_REAL, '2026-08-16T01:00:00Z').ads.stale).toBe(false);
    expect(construirPanel([], SYNCS, SNAP_REAL, '2026-08-18T12:00:00Z').ads.stale).toBe(true); // ~2 días
  });
  it('sin snapshot ⇒ capturedAt/period null, sinDatos true, NO se inventa rango ni 0 como dato', () => {
    const p = construirPanel([], SYNCS, null, '2026-08-18T12:00:00Z');
    expect(p.ads.capturedAt).toBeNull();
    expect(p.ads.period).toBeNull();
    expect(p.ads.sinDatos).toBe(true);
    expect(p.ads.impressions).toBeNull(); // no-data ≠ 0
    expect(p.ads.stale).toBe(false); // sin dato ⇒ no aplica STALE
  });
  it('snapshot viejo sin start_date persistido ⇒ period.from null (no se infiere desde capturedAt)', () => {
    const viejo: SnapshotAdsActual = { ...SNAP_REAL, startDate: undefined };
    const p = construirPanel([], SYNCS, viejo, '2026-08-18T12:00:00Z');
    expect(p.ads.period).toEqual({ kind: 'ALL_TIME', from: null, to: '2026-08-16T00:24:06.440Z' });
  });
});
