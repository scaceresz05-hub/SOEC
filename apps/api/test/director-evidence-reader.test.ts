/**
 * Lector de evidencia Google READ-ONLY del Director: KEYWORD / DEVICE / GEO / NETWORK. Fail-soft por consulta.
 * Prueba que la evidencia REAL se incorpora (parseo correcto) y que un rechazo de Google deja esa dimensión vacía.
 */
import { describe, it, expect } from 'vitest';
import { construirLectorEvidenciaGoogle } from '../src/autonomia-ads/director-evidence-reader';

const ventana = { desde: '2026-08-01', hasta: '2026-09-01' };

function buscarFake(fallar: Set<string> = new Set()): (cid: string, q: string) => Promise<Array<Record<string, unknown>>> {
  return async (_cid, q) => {
    if (q.includes('keyword_view')) { if (fallar.has('kw')) throw new Error('400'); return [{ adGroupCriterion: { keyword: { text: 'software de administración dental', matchType: 'BROAD' } }, metrics: { impressions: '100', clicks: '2', costMicros: '2414000000', conversions: '0' } }]; }
    if (q.includes('segments.device')) { if (fallar.has('dev')) throw new Error('400'); return [{ segments: { device: 'MOBILE' }, metrics: { impressions: '120', clicks: '3', costMicros: '2200000000', conversions: '0' } }]; }
    if (q.includes('ad_network_type')) { if (fallar.has('net')) throw new Error('400'); return [{ segments: { adNetworkType: 'SEARCH' }, metrics: { impressions: '160', clicks: '4', costMicros: '3001000000' } }]; }
    if (q.includes('geographic_view')) { if (fallar.has('geo')) throw new Error('400'); return [{ geographicView: { countryCriterionId: '2152' }, metrics: { impressions: '160', clicks: '4', costMicros: '3001000000', conversions: '0' } }]; }
    return [];
  };
}

describe('construirLectorEvidenciaGoogle', () => {
  it('KEYWORD: parsea texto/matchType/gasto (separado de search terms)', async () => {
    const ev = await construirLectorEvidenciaGoogle(buscarFake())('c', '24194332264', ventana);
    expect(ev.keywords).toHaveLength(1);
    expect(ev.keywords[0]!.keyword).toBe('software de administración dental');
    expect(ev.keywords[0]!.matchType).toBe('BROAD');
    expect(ev.keywords[0]!.gasto).toBeCloseTo(2414, 0);
    expect(ev.keywords[0]!.clics).toBe(2);
  });
  it('9: DEVICE evidence real se incorpora', async () => {
    const ev = await construirLectorEvidenciaGoogle(buscarFake())('c', '24194332264', ventana);
    expect(ev.devices).toHaveLength(1);
    expect(ev.devices[0]!.clave).toBe('MOBILE');
    expect(ev.devices[0]!.gasto).toBeCloseTo(2200, 0);
  });
  it('11: NETWORK evidence real se incorpora', async () => {
    const ev = await construirLectorEvidenciaGoogle(buscarFake())('c', '24194332264', ventana);
    expect(ev.networks[0]!.clave).toBe('SEARCH');
  });
  it('10: GEO evidence real se incorpora', async () => {
    const ev = await construirLectorEvidenciaGoogle(buscarFake())('c', '24194332264', ventana);
    expect(ev.geos[0]!.clave).toBe('geo:2152');
  });
  it('fail-soft: si una dimensión 400ea, queda vacía (UNKNOWN) sin romper el resto', async () => {
    const ev = await construirLectorEvidenciaGoogle(buscarFake(new Set(['kw', 'geo'])))('c', '24194332264', ventana);
    expect(ev.keywords).toHaveLength(0);
    expect(ev.geos).toHaveLength(0);
    expect(ev.devices).toHaveLength(1);   // las demás siguen
    expect(ev.networks).toHaveLength(1);
  });
});
