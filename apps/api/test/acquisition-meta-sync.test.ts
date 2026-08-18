/**
 * SYNC READ-ONLY + OBSERVABILIDAD — normalización, idempotencia, clasificación de salud y aislamiento.
 *
 * Verifica que cada capacidad se sincroniza a un snapshot NORMALIZADO (conteos/métricas/identidad), que el
 * upsert es idempotente (mismo asset+período no duplica), que un fallo de auth/permiso clasifica la salud
 * sin abortar el resto, que no-data no es fallo ni 0 forzado, y que nunca se persiste token ni raw Graph.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { MetaGraphReadHttpAdapter } from '../src/acquisition/meta-graph-http';
import type { PeticionHttpMeta, RespuestaHttpMeta, TransporteMeta } from '../src/acquisition/meta-http';
import { ejecutarSync, InMemoryMetaSyncRepo, type DepsSync } from '../src/acquisition/meta-sync';
import type { BindingMeta } from '../src/acquisition/meta-onboarding';

const IG = '17841432883225770';
const AD = '1037025024374407';
const ORG = 'smileflow';
const CONN = 'meta-smileflow';
const AHORA = '2026-08-17T12:00:00.000Z';

const BINDINGS: BindingMeta[] = [
  { assetType: 'business', externalId: '934186066270538', displayName: null, confirmadoPorHumano: true },
  { assetType: 'page', externalId: '1066708446525633', displayName: null, confirmadoPorHumano: true },
  { assetType: 'instagram', externalId: IG, displayName: null, confirmadoPorHumano: true },
  { assetType: 'adAccount', externalId: AD, displayName: null, confirmadoPorHumano: true },
];

/** Transporte que devuelve shapes realistas por endpoint; `fail(url)` fuerza auth/permiso selectivo. */
class TransporteSync implements TransporteMeta {
  readonly esProductivo = false;
  readonly urls: string[] = [];
  constructor(private readonly fail: (url: string) => { code: number; status: number } | null = () => null) {}
  async enviar(req: PeticionHttpMeta): Promise<RespuestaHttpMeta> {
    const u = req.url;
    this.urls.push(u);
    const f = this.fail(u);
    if (f) return { status: f.status, ok: false, json: { error: { code: f.code, message: 'x' } } };
    const ok = (json: unknown): RespuestaHttpMeta => ({ status: 200, ok: true, json });
    if (u.includes('/me/businesses')) return ok({ data: [{ id: '934186066270538', name: 'Biz' }] });
    if (u.includes('/me/accounts')) return ok({ data: [{ id: '1066708446525633', name: 'Page' }] });
    if (u.includes(`/${IG}/media`)) return ok({ data: [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }] });
    if (u.includes(`/${IG}/insights`)) return ok({ data: [{ name: 'reach', values: [{ value: 321 }] }, { name: 'follower_count', values: [{ value: 50 }] }] });
    if (u.includes(`/${IG}?`)) return ok({ id: IG, username: 'smileflow' });
    if (u.includes(`act_${AD}/campaigns`)) return ok({ data: [{ id: 'c1' }] });
    if (u.includes(`act_${AD}/insights`)) return ok({ data: [{ impressions: '1000', clicks: '20', spend: '12345' }] });
    if (u.includes(`act_${AD}?`)) return ok({ id: `act_${AD}`, account_id: AD, currency: 'CLP', account_status: 1 });
    return ok({ data: [] });
  }
}

function deps(transporte: TransporteMeta): { d: DepsSync; repo: InMemoryMetaSyncRepo } {
  const repo = new InMemoryMetaSyncRepo();
  const graph = new MetaGraphReadHttpAdapter({ graphVersion: 'v26.0', appSecret: 'S' }, transporte, 'SYNTH_TOKEN_boundary');
  return { d: { graph, repo, ahora: () => AHORA }, repo };
}

describe('meta sync · normalización + snapshots', () => {
  it('8 snapshots normalizados; identidad/conteos/métricas; estado OK/HEALTHY; source+observedAt', async () => {
    const { d, repo } = deps(new TransporteSync());
    const est = await ejecutarSync(d, ORG, CONN, BINDINGS);
    expect(est.lastErrorClass).toBe('NONE');
    expect(est.saludConexion).toBe('HEALTHY');
    expect(est.lastSuccessfulSyncAt).toBe(AHORA);
    expect(est.capacidades.every((c) => c.estado === 'OK')).toBe(true);

    const snaps = await repo.listarSnapshots(ORG, CONN);
    expect(snaps).toHaveLength(8);
    const by = (cap: string) => snaps.find((s) => s.capability === cap)!;
    expect(by('INSTAGRAM_IDENTITY').resumen.identity).toEqual({ id: IG, username: 'smileflow' });
    expect(by('INSTAGRAM_MEDIA').resumen.count).toBe(3);
    expect(by('INSTAGRAM_INSIGHTS').resumen.metrics).toEqual({ reach: 321, follower_count: 50 });
    expect(by('ADS_ACCOUNT').resumen.identity).toMatchObject({ account_id: AD, currency: 'CLP', account_status: '1' });
    expect(by('ADS_CAMPAIGNS').resumen.count).toBe(1);
    expect(by('ADS_INSIGHTS').resumen.metrics).toEqual({ impressions: 1000, clicks: 20, spend: 12345 });
    for (const s of snaps) {
      expect(s.source).toBe('meta');
      expect(s.observedAt).toBe(AHORA);
      expect(s.period).toBe('CURRENT');
    }
  });

  it('idempotencia: sincronizar dos veces NO duplica (upsert por asset+período)', async () => {
    const { d, repo } = deps(new TransporteSync());
    await ejecutarSync(d, ORG, CONN, BINDINGS);
    await ejecutarSync(d, ORG, CONN, BINDINGS);
    expect(await repo.listarSnapshots(ORG, CONN)).toHaveLength(8);
  });

  it('no-data NO es fallo ni 0 forzado: lecturas vacías ⇒ OK, count 0 / metrics vacío', async () => {
    // Transporte que devuelve SIEMPRE data vacía (no-data) para todas las lecturas.
    const vacio: TransporteMeta = { esProductivo: false, async enviar() { return { status: 200, ok: true, json: { data: [] } }; } };
    const { d, repo } = deps(vacio);
    const est = await ejecutarSync(d, ORG, CONN, [{ assetType: 'adAccount', externalId: AD, displayName: null, confirmadoPorHumano: true }]);
    expect(est.saludConexion).toBe('HEALTHY'); // no-data no degrada
    expect(est.capacidades.find((c) => c.capability === 'ADS_CAMPAIGNS')!.estado).toBe('OK');
    const snaps = await repo.listarSnapshots(ORG, CONN);
    expect(snaps.find((s) => s.capability === 'ADS_CAMPAIGNS')!.resumen.count).toBe(0); // count 0, no error
    expect(snaps.find((s) => s.capability === 'ADS_INSIGHTS')!.resumen.metrics).toEqual({}); // métricas vacías, no 0 forzado
  });

  it('tenant isolation: snapshots de una org no aparecen en otra', async () => {
    const { d, repo } = deps(new TransporteSync());
    await ejecutarSync(d, ORG, CONN, BINDINGS);
    expect(await repo.listarSnapshots('otra-org', 'meta-otra-org')).toHaveLength(0);
  });

  it('sin token ni raw Graph ni URLs de paging en lo persistido', async () => {
    const { d, repo } = deps(new TransporteSync());
    await ejecutarSync(d, ORG, CONN, BINDINGS);
    const s = JSON.stringify(await repo.listarSnapshots(ORG, CONN));
    expect(s).not.toContain('SYNTH_TOKEN_boundary');
    expect(s.toLowerCase()).not.toContain('access_token');
    expect(s).not.toContain('graph.facebook.com');
    expect(s.toLowerCase()).not.toContain('paging');
  });
});

describe('meta sync · clasificación de salud fail-closed (parcial)', () => {
  it('IG insights auth failure (190) ⇒ ese check AUTH_FAILED, saludConexion TOKEN_EXPIRED; resto OK', async () => {
    const { d, repo } = deps(new TransporteSync((u) => (u.includes(`/${IG}/insights`) ? { code: 190, status: 401 } : null)));
    const est = await ejecutarSync(d, ORG, CONN, BINDINGS);
    expect(est.capacidades.find((c) => c.capability === 'INSTAGRAM_INSIGHTS')!.estado).toBe('AUTH_FAILED');
    expect(est.capacidades.find((c) => c.capability === 'ADS_INSIGHTS')!.estado).toBe('OK'); // el resto continúa
    expect(est.lastErrorClass).toBe('AUTH');
    expect(est.saludConexion).toBe('TOKEN_EXPIRED');
    expect(est.lastSuccessfulSyncAt).toBeNull();
    // El snapshot fallido NO se persiste; los OK sí.
    expect((await repo.listarSnapshots(ORG, CONN)).some((s) => s.capability === 'INSTAGRAM_INSIGHTS')).toBe(false);
  });

  it('Ads insights permission failure (10) ⇒ SCOPE_MISSING + saludConexion SCOPE_MISSING', async () => {
    const { d } = deps(new TransporteSync((u) => (u.includes(`act_${AD}/insights`) ? { code: 10, status: 403 } : null)));
    const est = await ejecutarSync(d, ORG, CONN, BINDINGS);
    expect(est.capacidades.find((c) => c.capability === 'ADS_INSIGHTS')!.estado).toBe('SCOPE_MISSING');
    expect(est.lastErrorClass).toBe('SCOPE');
    expect(est.saludConexion).toBe('SCOPE_MISSING');
  });
});

describe('meta sync · arquitectura zero-write', () => {
  it('el módulo de sync no usa verbos de escritura ni ads_management ni lee leads', () => {
    const src = readFileSync(new URL('../src/acquisition/meta-sync.ts', import.meta.url), 'utf8');
    for (const verbo of ['publish', 'create', 'update', 'pause', 'delete', 'assign', 'budget']) {
      expect(new RegExp(`(?<![.\\w])${verbo}\\s*\\(`, 'i').test(src)).toBe(false);
    }
    expect(src.includes('ads_management')).toBe(false);
    expect(src.toLowerCase().includes('leadgen')).toBe(false);
    expect(src.toLowerCase().includes('leads_retrieval')).toBe(false);
  });
});
