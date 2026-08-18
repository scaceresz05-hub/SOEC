/**
 * SYNC READ-ONLY + POLÍTICA DE FRESHNESS — normalización, idempotencia, freshness (fresh evita Graph,
 * stale/never sincroniza, force re-lee), fail parcial preserva último snapshot bueno, clasificación de
 * salud, aislamiento por tenant, y no-leak de token/raw/paging.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { MetaGraphReadHttpAdapter } from '../src/acquisition/meta-graph-http';
import type { MetaGraphReadPort } from '../src/acquisition/meta-onboarding';
import type { PeticionHttpMeta, RespuestaHttpMeta, TransporteMeta } from '../src/acquisition/meta-http';
import { ejecutarSync, InMemoryMetaSyncRepo, type MetaSyncRepo } from '../src/acquisition/meta-sync';
import type { BindingMeta } from '../src/acquisition/meta-onboarding';

const IG = '17841432883225770';
const AD = '1037025024374407';
const ORG = 'smileflow';
const CONN = 'meta-smileflow';
const T0 = '2026-08-17T12:00:00.000Z';
const T25H = '2026-08-18T13:00:00.000Z'; // +25h ⇒ supera todos los TTL (máx 24h)

const BINDINGS: BindingMeta[] = [
  { assetType: 'business', externalId: '934186066270538', displayName: null, confirmadoPorHumano: true },
  { assetType: 'page', externalId: '1066708446525633', displayName: null, confirmadoPorHumano: true },
  { assetType: 'instagram', externalId: IG, displayName: null, confirmadoPorHumano: true },
  { assetType: 'adAccount', externalId: AD, displayName: null, confirmadoPorHumano: true },
];

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
    if (u.includes(`/${IG}/insights`)) return ok({ data: [{ name: 'reach', values: [{ value: 321 }] }] });
    if (u.includes(`/${IG}?`)) return ok({ id: IG, username: 'smileflow' });
    if (u.includes(`act_${AD}/campaigns`)) return ok({ data: [{ id: 'c1' }] });
    if (u.includes(`act_${AD}/insights`)) return ok({ data: [{ impressions: '1000', clicks: '20', spend: '12345' }] });
    if (u.includes(`act_${AD}?`)) return ok({ id: `act_${AD}`, account_id: AD, currency: 'CLP', account_status: 1 });
    return ok({ data: [] });
  }
}

function resolverGraphDe(t: TransporteMeta): <T>(uso: (g: MetaGraphReadPort) => Promise<T>) => Promise<T> {
  const g = new MetaGraphReadHttpAdapter({ graphVersion: 'v26.0', appSecret: 'S' }, t, 'SYNTH_TOKEN_boundary');
  return (uso) => uso(g);
}
function deps(t: TransporteMeta, repo: MetaSyncRepo, ahora: string) {
  return { resolverGraph: resolverGraphDe(t), repo, ahora: () => ahora };
}

describe('meta sync · normalización + idempotencia', () => {
  it('8 snapshots normalizados; estado OK/HEALTHY; source/observedAt/period', async () => {
    const repo = new InMemoryMetaSyncRepo();
    const est = await ejecutarSync(deps(new TransporteSync(), repo, T0), ORG, CONN, BINDINGS);
    expect(est.lastErrorClass).toBe('NONE');
    expect(est.saludConexion).toBe('HEALTHY');
    expect(est.lastSuccessfulSyncAt).toBe(T0);
    const snaps = await repo.listarSnapshots(ORG, CONN);
    expect(snaps).toHaveLength(8);
    expect(snaps.find((s) => s.capability === 'INSTAGRAM_MEDIA')!.resumen.count).toBe(3);
    expect(snaps.find((s) => s.capability === 'ADS_INSIGHTS')!.resumen.metrics).toEqual({ impressions: 1000, clicks: 20, spend: 12345 });
    for (const s of snaps) { expect(s.source).toBe('meta'); expect(s.observedAt).toBe(T0); expect(s.period).toBe('CURRENT'); }
  });

  it('sin token ni raw Graph ni paging en lo persistido', async () => {
    const repo = new InMemoryMetaSyncRepo();
    await ejecutarSync(deps(new TransporteSync(), repo, T0), ORG, CONN, BINDINGS);
    const s = JSON.stringify(await repo.listarSnapshots(ORG, CONN));
    expect(s).not.toContain('SYNTH_TOKEN_boundary');
    expect(s.toLowerCase()).not.toContain('access_token');
    expect(s).not.toContain('graph.facebook.com');
    expect(s.toLowerCase()).not.toContain('paging');
  });

  it('tenant isolation: snapshots de una org no aparecen en otra', async () => {
    const repo = new InMemoryMetaSyncRepo();
    await ejecutarSync(deps(new TransporteSync(), repo, T0), ORG, CONN, BINDINGS);
    expect(await repo.listarSnapshots('otra-org', 'meta-otra-org')).toHaveLength(0);
  });
});

describe('meta sync · política de freshness', () => {
  it('FRESH evita nueva llamada Graph (segunda sync inmediata NO toca Graph)', async () => {
    const repo = new InMemoryMetaSyncRepo();
    await ejecutarSync(deps(new TransporteSync(), repo, T0), ORG, CONN, BINDINGS); // NEVER_SYNCED ⇒ sincroniza
    const t2 = new TransporteSync();
    const est = await ejecutarSync(deps(t2, repo, T0), ORG, CONN, BINDINGS); // mismo instante ⇒ todo FRESH
    expect(t2.urls).toHaveLength(0); // cero llamadas Graph
    expect(est.capacidades.every((c) => c.estado === 'SKIPPED_FRESH')).toBe(true);
    expect(est.capacidades.every((c) => c.freshness === 'FRESH')).toBe(true);
    expect(await repo.listarSnapshots(ORG, CONN)).toHaveLength(8);
  });

  it('STALE (pasado el TTL) SÍ sincroniza', async () => {
    const repo = new InMemoryMetaSyncRepo();
    await ejecutarSync(deps(new TransporteSync(), repo, T0), ORG, CONN, BINDINGS);
    const t2 = new TransporteSync();
    await ejecutarSync(deps(t2, repo, T25H), ORG, CONN, BINDINGS); // +25h ⇒ todo STALE
    expect(t2.urls.length).toBeGreaterThan(0);
    expect((await repo.listarSnapshots(ORG, CONN)).every((s) => s.observedAt === T25H)).toBe(true);
  });

  it('NEVER_SYNCED sincroniza; force re-lee aun estando FRESH', async () => {
    const repo = new InMemoryMetaSyncRepo();
    const t1 = new TransporteSync();
    await ejecutarSync(deps(t1, repo, T0), ORG, CONN, BINDINGS);
    expect(t1.urls.length).toBeGreaterThan(0); // never-synced ⇒ llamó
    const t2 = new TransporteSync();
    await ejecutarSync(deps(t2, repo, T0), ORG, CONN, BINDINGS, { force: true }); // FRESH pero force
    expect(t2.urls.length).toBeGreaterThan(0);
  });

  it('fail parcial PRESERVA el último snapshot bueno (no lo sobrescribe)', async () => {
    const repo = new InMemoryMetaSyncRepo();
    await ejecutarSync(deps(new TransporteSync(), repo, T0), ORG, CONN, BINDINGS); // IG insights bueno en T0
    // +25h todo STALE; IG insights ahora falla auth.
    const t2 = new TransporteSync((u) => (u.includes(`/${IG}/insights`) ? { code: 190, status: 401 } : null));
    const est = await ejecutarSync(deps(t2, repo, T25H), ORG, CONN, BINDINGS);
    expect(est.capacidades.find((c) => c.capability === 'INSTAGRAM_INSIGHTS')!.estado).toBe('AUTH_FAILED');
    expect(est.saludConexion).toBe('TOKEN_EXPIRED');
    // El snapshot de IG insights sigue siendo el bueno de T0 (no se perdió).
    const snap = (await repo.listarSnapshots(ORG, CONN)).find((s) => s.capability === 'INSTAGRAM_INSIGHTS')!;
    expect(snap.observedAt).toBe(T0);
    expect(snap.resumen.metrics).toEqual({ reach: 321 });
  });
});

describe('meta sync · clasificación de salud + arquitectura', () => {
  it('Ads insights permission failure (10) ⇒ SCOPE_MISSING; el resto continúa', async () => {
    const repo = new InMemoryMetaSyncRepo();
    const t = new TransporteSync((u) => (u.includes(`act_${AD}/insights`) ? { code: 10, status: 403 } : null));
    const est = await ejecutarSync(deps(t, repo, T0), ORG, CONN, BINDINGS);
    expect(est.capacidades.find((c) => c.capability === 'ADS_INSIGHTS')!.estado).toBe('SCOPE_MISSING');
    expect(est.capacidades.find((c) => c.capability === 'ADS_ACCOUNT')!.estado).toBe('OK');
    expect(est.lastErrorClass).toBe('SCOPE');
    expect(est.saludConexion).toBe('SCOPE_MISSING');
    expect(est.lastSuccessfulSyncAt).toBeNull();
  });

  it('zero-write: el módulo de sync no usa verbos de escritura ni gestión de anuncios ni lee leads', () => {
    const src = readFileSync(new URL('../src/acquisition/meta-sync.ts', import.meta.url), 'utf8');
    for (const verbo of ['publish', 'create', 'update', 'pause', 'delete', 'assign', 'budget']) {
      expect(new RegExp(`(?<![.\\w])${verbo}\\s*\\(`, 'i').test(src)).toBe(false);
    }
    expect(src.includes('ads_management')).toBe(false);
    expect(src.toLowerCase().includes('leadgen')).toBe(false);
    expect(src.toLowerCase().includes('leads_retrieval')).toBe(false);
  });
});
