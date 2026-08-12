import { describe, expect, it } from 'vitest';
import { filasDesdeSnapshot, FuenteMetricasRealSOEC, type SnapshotCumulativo } from '../src/real-director/fuente-metricas-real';

const OPTS = { campaignRef: 'cmp-x', ocurridoEn: '2026-08-11T00:00:00Z', periodo: 'acumulado', proveedorSeq: 1 };

describe('fuente-metricas-real', () => {
  it('construye filas canónicas ACUMULADAS desde el snapshot + conversiones=0 (hecho, no ausencia)', () => {
    const snap: SnapshotCumulativo = { impressions: 273, clicks: 7, cost: 6028 };
    const filas = filasDesdeSnapshot(snap, OPTS);
    const byM = Object.fromEntries(filas.map((f) => [f.metrica, f]));
    expect(byM.impresiones!.valor).toBe(273);
    expect(byM.clics!.valor).toBe(7);
    expect(byM.gasto!.valor).toBe(6028);
    expect(byM.gasto!.unidad).toBe('monetario');
    expect(byM.gasto!.moneda).toBe('CLP');
    expect(byM.conversiones!.valor).toBe(0); // 0 conversiones Ads-atribuibles
    for (const f of filas) {
      expect(f.estimada).toBe(false);
      expect(f.acumulativa).toBe(true);
      expect(f.externalId).toBe('cmp-x');
    }
  });

  it('snapshot null o métrica null ⇒ 0 (nunca inventa, nunca NaN)', () => {
    const filas = filasDesdeSnapshot(null, OPTS);
    expect(filas.map((f) => f.valor)).toEqual([0, 0, 0, 0]);
    const parcial = filasDesdeSnapshot({ impressions: 10, clicks: null, cost: null }, OPTS);
    expect(Object.fromEntries(parcial.map((f) => [f.metrica, f.valor]))).toEqual({ impresiones: 10, clics: 0, gasto: 0, conversiones: 0 });
  });

  it('la fuente REAL declara modo "real", filtra por externalRef y no aporta conversiones', async () => {
    const src = new FuenteMetricasRealSOEC(filasDesdeSnapshot({ impressions: 273, clicks: 7, cost: 6028 }, OPTS));
    expect(src.modo).toBe('real');
    const lote = await src.obtener();
    expect(lote.conversiones).toEqual([]);
    expect((await src.obtenerDe('-', '-', 'cmp-x')).length).toBe(4);
    expect((await src.obtenerDe('-', '-', 'otra')).length).toBe(0);
  });
});
