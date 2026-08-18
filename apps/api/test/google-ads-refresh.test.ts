/**
 * Refresh manual de Google Ads: reducer del estado de refresh (LAST-WINS) + config gate (fail-closed).
 * El fallo de OAuth debe quedar VISIBLE; sin config ⇒ NOT_CONFIGURED (sin inventar datos).
 */
import { describe, expect, it } from 'vitest';
import { ultimoRefreshState, EVENTO_REFRESH_STATE, adsRefreshStateStreamId, type AdsRefreshState } from '../src/ingesta/ingesta-google-ads-service';
import { googleAdsConfigurado } from '../src/ingesta/google-ads-runtime';

const ev = (s: AdsRefreshState) => ({ type: EVENTO_REFRESH_STATE, payload: s });
const base = (over: Partial<AdsRefreshState>): AdsRefreshState => ({ queriedAt: '2026-08-18T21:00:00Z', ok: false, estado: 'FALLO', ventana: { desde: '2026-08-12', hasta: '2026-08-18' }, error: null, dataThrough: null, ...over });

describe('ads refresh state', () => {
  it('ultimoRefreshState toma el último evento (last-wins)', () => {
    const events = [ev(base({ queriedAt: '2026-08-18T20:00:00Z' })), ev(base({ queriedAt: '2026-08-18T21:00:00Z', ok: true, estado: 'OK', dataThrough: '2026-08-18' }))];
    const u = ultimoRefreshState(events);
    expect(u!.queriedAt).toBe('2026-08-18T21:00:00Z');
    expect(u!.ok).toBe(true);
    expect(u!.dataThrough).toBe('2026-08-18');
  });
  it('fallo de OAuth queda visible (ok=false + error)', () => {
    const u = ultimoRefreshState([ev(base({ error: 'NO_AUTORIZADO — no se pudo obtener access_token de OAuth' }))]);
    expect(u!.ok).toBe(false);
    expect(u!.error).toContain('NO_AUTORIZADO');
    expect(u!.dataThrough).toBeNull(); // sin datos ⇒ no se inventa dataThrough
  });
  it('sin eventos ⇒ null (no hay refresh conocido)', () => {
    expect(ultimoRefreshState([])).toBeNull();
  });
  it('stream id namespaced por org (aislamiento)', () => {
    expect(adsRefreshStateStreamId('org-smileflow')).toBe('ingesta-refresh-state:google-ads:org-smileflow');
  });
});

describe('googleAdsConfigurado (fail-closed)', () => {
  it('sin variables de Google Ads ⇒ false (NOT_CONFIGURED)', () => {
    expect(googleAdsConfigurado({} as NodeJS.ProcessEnv, 'org-smileflow')).toBe(false);
  });
  it('org inexistente ⇒ false aunque haya env', () => {
    expect(googleAdsConfigurado({ GOOGLE_ADS_DEVELOPER_TOKEN: 'x', GOOGLE_ADS_CLIENT_ID: 'x', GOOGLE_ADS_CLIENT_SECRET: 'x' } as NodeJS.ProcessEnv, 'org-inexistente-zzz')).toBe(false);
  });
});
