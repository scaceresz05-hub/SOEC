import { describe, expect, it } from 'vitest';
import { estadoAds, copyConexionAds, lineaObjetivoAds, copyPorqueSinTerminos } from './ads-estado';

const CONECTADO_SIN_DATOS = estadoAds('CONNECTED_READ_ONLY', /* adsVacio */ true);
const CONECTADO_CON_DATOS = estadoAds('CONNECTED_READ_ONLY', /* adsVacio */ false);
const NO_CONECTADO = estadoAds('NOT_CONNECTED', /* adsVacio */ true);

describe('coherencia de estado Google Ads (conexión vs datos)', () => {
  it('connected_no_data_not_rendered_as_not_connected', () => {
    const copy = copyConexionAds(CONECTADO_SIN_DATOS);
    expect(copy).toContain('conectado');
    expect(copy).not.toContain('no está conectado');
    expect(copy).toContain('todavía no hay datos');
  });

  it('connected_no_data_not_claim_observing_ads', () => {
    const l = lineaObjetivoAds(CONECTADO_SIN_DATOS);
    expect(l.t).not.toContain('Observando');
    expect(l.ok).toBe(false);
    expect(l.t).toContain('esperando datos');
  });

  it('connected_no_data_not_claim_search_terms (Por qué)', () => {
    const copy = copyPorqueSinTerminos(CONECTADO_SIN_DATOS);
    expect(copy).toContain('conectado');
    expect(copy).toContain('aún no hay datos de búsquedas');
    expect(copy).not.toContain('no está conectado');
  });

  it('not_connected_copy_correct', () => {
    expect(copyConexionAds(NO_CONECTADO)).toBe('Google Ads todavía no está conectado.');
    expect(lineaObjetivoAds(NO_CONECTADO).t).toContain('todavía no está conectado');
    expect(copyPorqueSinTerminos(NO_CONECTADO)).toContain('aún no está conectado');
  });

  it('fresh_data_claims_allowed', () => {
    expect(copyConexionAds(CONECTADO_CON_DATOS)).toBe('FRESH'); // ⇒ mostrar métricas reales
    const l = lineaObjetivoAds(CONECTADO_CON_DATOS);
    expect(l.t).toContain('Observando tus anuncios');
    expect(l.ok).toBe(true);
  });

  it('estadoAds separa conexión de datos (una fuente conectada con event-store vacío = conectado sin datos)', () => {
    expect(CONECTADO_SIN_DATOS).toEqual({ conectado: true, conDatos: false });
    expect(NO_CONECTADO).toEqual({ conectado: false, conDatos: false });
    expect(CONECTADO_CON_DATOS).toEqual({ conectado: true, conDatos: true });
  });
});
