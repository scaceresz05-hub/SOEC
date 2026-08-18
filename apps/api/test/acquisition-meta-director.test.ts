/**
 * DIRECTOR READ MODEL — el Director consume SÓLO snapshots normalizados + metadata (capturedAt, freshness,
 * source, lastSuccessfulSyncAt, health). Nunca token/secretRef/ciphertext/raw/paging/PII. Recalcula
 * freshness con el `ahora` actual (FRESH puede caducar). No llama a Graph.
 */
import { describe, expect, it } from 'vitest';
import { construirVistaDirector } from '../src/acquisition/meta-director';
import { InMemoryMetaSyncRepo, type SnapshotSync, type EstadoSync } from '../src/acquisition/meta-sync';
import type { BindingMeta } from '../src/acquisition/meta-onboarding';

const IG = '17841432883225770';
const AD = '1037025024374407';
const ORG = 'smileflow';
const CONN = 'meta-smileflow';
const T0 = '2026-08-17T12:00:00.000Z';

const BINDINGS: BindingMeta[] = [
  { assetType: 'business', externalId: '934186066270538', displayName: null, confirmadoPorHumano: true },
  { assetType: 'instagram', externalId: IG, displayName: null, confirmadoPorHumano: true },
  { assetType: 'adAccount', externalId: AD, displayName: null, confirmadoPorHumano: true },
];

async function repoConSnapshot(observedAt: string): Promise<InMemoryMetaSyncRepo> {
  const repo = new InMemoryMetaSyncRepo();
  const snap: SnapshotSync = { organizationId: ORG, connectionId: CONN, capability: 'INSTAGRAM_IDENTITY', externalId: IG, period: 'CURRENT', observedAt, source: 'meta', resumen: { kind: 'INSTAGRAM_IDENTITY', identity: { id: IG, username: 'smileflow' } } };
  await repo.upsertSnapshot(snap);
  const estado: EstadoSync = { organizationId: ORG, connectionId: CONN, lastSyncAt: observedAt, lastSuccessfulSyncAt: observedAt, lastErrorClass: 'NONE', saludConexion: 'HEALTHY', capacidades: [] };
  await repo.guardarEstado(estado);
  return repo;
}

describe('director read model', () => {
  it('expone capacidades con capturedAt/freshness/source/resumen + lastSuccessfulSyncAt + health', async () => {
    const repo = await repoConSnapshot(T0);
    const v = await construirVistaDirector(repo, ORG, CONN, BINDINGS, T0);
    expect(v.lastSuccessfulSyncAt).toBe(T0);
    expect(v.health).toBe('HEALTHY');
    const ig = v.capacidades.find((c) => c.capability === 'INSTAGRAM_IDENTITY')!;
    expect(ig.source).toBe('meta');
    expect(ig.capturedAt).toBe(T0);
    expect(ig.freshness).toBe('FRESH');
    expect(ig.resumen).toEqual({ kind: 'INSTAGRAM_IDENTITY', identity: { id: IG, username: 'smileflow' } });
  });

  it('capacidad sin snapshot ⇒ NEVER_SYNCED, capturedAt null, resumen null', async () => {
    const repo = await repoConSnapshot(T0);
    const v = await construirVistaDirector(repo, ORG, CONN, BINDINGS, T0);
    const biz = v.capacidades.find((c) => c.capability === 'BUSINESS_IDENTITY')!;
    expect(biz.freshness).toBe('NEVER_SYNCED');
    expect(biz.capturedAt).toBeNull();
    expect(biz.resumen).toBeNull();
  });

  it('freshness caduca con el tiempo: mismo snapshot pasa a STALE al superar el TTL', async () => {
    const repo = await repoConSnapshot(T0);
    const v = await construirVistaDirector(repo, ORG, CONN, BINDINGS, '2026-08-18T13:00:00.000Z'); // +25h
    expect(v.capacidades.find((c) => c.capability === 'INSTAGRAM_IDENTITY')!.freshness).toBe('STALE');
  });

  it('nunca expone secretos ni raw: la vista serializada no contiene token/secretRef/ciphertext/paging', async () => {
    const repo = await repoConSnapshot(T0);
    const v = await construirVistaDirector(repo, ORG, CONN, BINDINGS, T0);
    const s = JSON.stringify(v).toLowerCase();
    for (const prohibido of ['access_token', 'secretref', 'ciphertext', 'wrappeddatakey', 'paging', 'graph.facebook.com', 'file:', 'eaab']) {
      expect(s.includes(prohibido)).toBe(false);
    }
  });
});
