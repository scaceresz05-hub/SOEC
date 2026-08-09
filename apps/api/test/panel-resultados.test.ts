import { describe, expect, it } from 'vitest';
import { construirPanel, type ObsPanel, type Sync } from '../src/ingesta/panel-resultados';

// Fixture REAL: snapshot de campaña con 0 impresiones/clics/coste + embudo Growth (1 diagnóstico, varios comerciales).
const snap = (metrica: string): ObsPanel => ({
  provider: 'google-ads',
  eventName: `ads_campaign_snapshot:${metrica}`,
  metrica,
  valor: 0,
  occurredAt: '2026-08-08T00:00:00Z',
  diagnostico: false,
  utmCampaign: 'SmileFlow Search Chile',
  utmContent: null,
  limitaciones: ['campaign_status=ENABLED'],
  externalEventId: `google-ads:campaign:24120966895:snapshot:2026-08-08:${metrica}`,
});

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
  snap('impressions'), snap('clicks'), snap('cost'),
  growth('demo_cta_clicked', false, 1),
  growth('demo_cta_clicked', false, 2),
  growth('demo_form_started', false, 3),
  growth('demo_requested', false, 4),
  growth('demo_requested', true, 5), // DIAGNÓSTICO: no debe contar como comercial
  growth('lead_created', false, 6),
];

const SYNCS: Sync[] = [
  { provider: 'smileflow-growth', ok: true, at: '2026-08-08T09:00:00Z' },
  { provider: 'google-ads', ok: true, at: '2026-08-08T09:05:00Z' },
];

describe('construirPanel', () => {
  const panel = construirPanel(OBS, SYNCS);

  it('extrae nombre, estado e id de campaña del snapshot más reciente', () => {
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

  it('ctr/cpc reales cuando hay denominador; agrega términos de búsqueda por utmContent', () => {
    const conDatos = construirPanel(
      [
        { ...snap('impressions'), valor: 200, occurredAt: '2026-08-09T00:00:00Z', externalEventId: 'google-ads:campaign:24120966895:snapshot:2026-08-09:impressions' },
        { ...snap('clicks'), valor: 10, occurredAt: '2026-08-09T00:00:00Z', externalEventId: 'google-ads:campaign:24120966895:snapshot:2026-08-09:clicks' },
        { ...snap('cost'), valor: 5000, occurredAt: '2026-08-09T00:00:00Z', externalEventId: 'google-ads:campaign:24120966895:snapshot:2026-08-09:cost' },
        { provider: 'google-ads', eventName: 'ads_search_term', metrica: 'search_term_impressions', valor: 30, occurredAt: '2026-08-09T00:00:00Z', diagnostico: false, utmCampaign: null, utmContent: 'dentista santiago', limitaciones: [], externalEventId: 'google-ads:searchterm:x:1:2026-08-09:search_term_impressions' },
        { provider: 'google-ads', eventName: 'ads_search_term', metrica: 'search_term_clicks', valor: 3, occurredAt: '2026-08-09T00:00:00Z', diagnostico: false, utmCampaign: null, utmContent: 'dentista santiago', limitaciones: [], externalEventId: 'google-ads:searchterm:x:1:2026-08-09:search_term_clicks' },
      ],
      SYNCS,
    );
    expect(conDatos.ads.ctr).toBeCloseTo(10 / 200, 6);
    expect(conDatos.ads.cpc).toBeCloseTo(5000 / 10, 6);
    expect(conDatos.ads.sinDatos).toBe(false);
    expect(conDatos.searchTerms).toEqual([{ termino: 'dentista santiago', impresiones: 30, clics: 3 }]);
    expect(conDatos.lecturaSoec).not.toContain('Todavía no hay suficientes datos');
  });
});
