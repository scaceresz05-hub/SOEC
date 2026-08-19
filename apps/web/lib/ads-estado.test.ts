import { describe, expect, it } from 'vitest';
import { estadoAds, copyConexionAds, lineaObjetivoAds, copyPorqueSinTerminos, midiendoContactos } from './ads-estado';

// Verdad real: la conexión deriva de `googleAdsConfigured` (credenciales/autorización), NO del registry.
const SIN_CREDENCIALES = estadoAds(/* googleAdsConfigured */ false, /* adsVacio */ true); // prod SmileFlow hoy
const CONECTADO_SIN_DATOS = estadoAds(true, true);
const CONECTADO_CON_DATOS = estadoAds(true, false);

describe('verdad real de conexión Google Ads (registry ≠ conexión)', () => {
  it('supported_provider_without_credentials_is_not_connected', () => {
    expect(SIN_CREDENCIALES.conectado).toBe(false);
  });

  it('registry_does_not_imply_connection', () => {
    // El estado del registry (p.ej. CONNECTED_READ_ONLY) NO es entrada de `estadoAds`: sólo cuentan las
    // credenciales reales. Sin credenciales ⇒ no conectado, diga lo que diga el registry.
    expect(estadoAds(false, true).conectado).toBe(false);
    expect(estadoAds(undefined, true).conectado).toBe(false);
  });

  it('not_connected_google_ads_does_not_claim_waiting_for_campaign_data', () => {
    const l = lineaObjetivoAds(SIN_CREDENCIALES);
    expect(l.t).not.toContain('esperando datos');
    expect(l.t).toContain('todavía no está conectado');
    expect(copyConexionAds(SIN_CREDENCIALES)).toBe('Google Ads todavía no está conectado.');
  });

  it('not_connected_google_ads_does_not_claim_observing_ads', () => {
    expect(lineaObjetivoAds(SIN_CREDENCIALES).t).not.toContain('Observando');
    expect(lineaObjetivoAds(SIN_CREDENCIALES).ok).toBe(false);
  });

  it('not_connected_google_ads_does_not_claim_search_terms', () => {
    const copy = copyPorqueSinTerminos(SIN_CREDENCIALES);
    expect(copy).toContain('aún no está conectado');
    expect(copy).not.toContain('está conectado,'); // no afirma conexión
  });

  it('site_events_can_remain_connected_independently', () => {
    // La medición del sitio (first-party) es independiente de Google Ads: puede estar activa aunque Ads no.
    expect(midiendoContactos({ lead_created: 3, demo_cta_clicked: 10 })).toBe(true);
    expect(midiendoContactos({})).toBe(false);
    expect(midiendoContactos(undefined)).toBe(false);
    // Que Google Ads esté no-conectado no cambia el estado de los eventos del sitio.
    expect(SIN_CREDENCIALES.conectado).toBe(false);
    expect(midiendoContactos({ lead_created: 1 })).toBe(true);
  });

  it('fresh_data_claims_allowed (solo con conexión real + datos)', () => {
    expect(copyConexionAds(CONECTADO_CON_DATOS)).toBe('FRESH');
    expect(lineaObjetivoAds(CONECTADO_CON_DATOS).t).toContain('Observando tus anuncios');
    // Conectado pero sin datos: honesto, sin afirmar observación.
    expect(lineaObjetivoAds(CONECTADO_SIN_DATOS).t).toContain('esperando datos');
  });
});
