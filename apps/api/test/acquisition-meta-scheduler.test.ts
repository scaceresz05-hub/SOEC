/**
 * SCHEDULER AUTÓNOMO READ-ONLY — backoff acotado, cadencia por freshness, tick tenant-aware, claim de
 * concurrencia, fail parcial + backoff, REAUTH, ON/OFF por organización.
 */
import { describe, expect, it } from 'vitest';
import { MetaGraphReadHttpAdapter } from '../src/acquisition/meta-graph-http';
import type { PeticionHttpMeta, RespuestaHttpMeta, TransporteMeta } from '../src/acquisition/meta-http';
import { InMemoryMetaSyncRepo } from '../src/acquisition/meta-sync';
import { backoffMs, proximoElegible, procesarTick, InMemoryMetaScheduleRepo, type DepsScheduler } from '../src/acquisition/meta-scheduler';
import type { ComposicionMetaOAuth } from '../src/acquisition/meta-runtime';
import type { EstadoCapacidadSync } from '../src/acquisition/meta-sync';
import type { BindingMeta } from '../src/acquisition/meta-onboarding';

const IG = '17841432883225770';
const AD = '1037025024374407';
const BINDINGS: BindingMeta[] = [
  { assetType: 'business', externalId: '934186066270538', displayName: null, confirmadoPorHumano: true },
  { assetType: 'instagram', externalId: IG, displayName: null, confirmadoPorHumano: true },
  { assetType: 'adAccount', externalId: AD, displayName: null, confirmadoPorHumano: true },
];

class Transporte implements TransporteMeta {
  readonly esProductivo = false;
  readonly urls: string[] = [];
  constructor(private readonly fail: (u: string) => { code: number; status: number } | null = () => null) {}
  async enviar(req: PeticionHttpMeta): Promise<RespuestaHttpMeta> {
    this.urls.push(req.url);
    const f = this.fail(req.url);
    if (f) return { status: f.status, ok: false, json: { error: { code: f.code, message: 'x' } } };
    return { status: 200, ok: true, json: { data: [{ id: 'x' }], id: IG, username: 'sf', account_id: AD } };
  }
}

function comp(t: TransporteMeta, syncRepo: InMemoryMetaSyncRepo, bindings = BINDINGS): ComposicionMetaOAuth {
  return {
    connRepo: { obtener: async () => ({ conexion: { organizationId: 'o', provider: 'meta', connectionId: 'c', estado: 'CONNECTED_READ_ONLY', salud: 'HEALTHY', bindings, credencialRef: 'file:o/x' }, candidatos: [] }) },
    credRepo: { obtener: async () => ({ provider: 'meta', organizationId: 'o', credentialId: 'c', tokenType: 'USER_LONG_LIVED', secretRef: 'file:o/x', issuedAt: null, expiresAt: null, lastValidatedAt: null, revokedAt: null, status: 'ACTIVE' }) },
    secretWriter: { resolver: async () => ({ usar: async (fn: (t: string) => Promise<unknown>) => fn('TOK_boundary') }) },
    crearGraphRead: (token: string) => new MetaGraphReadHttpAdapter({ graphVersion: 'v26.0', appSecret: 'S' }, t, token),
    syncRepo,
  } as unknown as ComposicionMetaOAuth;
}

function deps(t: TransporteMeta, syncRepo: InMemoryMetaSyncRepo, scheduleRepo: InMemoryMetaScheduleRepo, ahora: string): DepsScheduler {
  return { comp: comp(t, syncRepo), scheduleRepo, ahora: () => ahora, lockMs: 60_000, batch: 20 };
}

const T0 = '2026-08-17T12:00:00.000Z';
const T25H = '2026-08-18T13:00:00.000Z';

describe('scheduler · backoff + proximoElegible', () => {
  it('backoff exponencial acotado; auth/scope ⇒ ventana larga (6h)', () => {
    expect(backoffMs('DEGRADED', 1)).toBe(5 * 60_000);
    expect(backoffMs('DEGRADED', 3)).toBe(20 * 60_000);
    expect(backoffMs('DEGRADED', 99)).toBe(6 * 3600_000); // cap
    expect(backoffMs('AUTH', 1)).toBe(6 * 3600_000);
    expect(backoffMs('SCOPE', 1)).toBe(6 * 3600_000);
  });
  it('proximoElegible: NEVER_SYNCED (observedAt null) ⇒ ahora; si hay snapshot ⇒ min expiry', () => {
    const caps: EstadoCapacidadSync[] = [{ capability: 'INSTAGRAM_INSIGHTS', estado: 'OK', freshness: 'FRESH', observedAt: null }];
    expect(proximoElegible(caps, T0)).toBe(T0);
    const caps2: EstadoCapacidadSync[] = [{ capability: 'INSTAGRAM_INSIGHTS', estado: 'OK', freshness: 'FRESH', observedAt: T0 }];
    expect(Date.parse(proximoElegible(caps2, T0))).toBe(Date.parse(T0) + 3 * 3600_000); // TTL insights 3h
  });
});

describe('scheduler · tick tenant-aware + cadencia por freshness', () => {
  it('procesa una conexión elegible (NEVER_SYNCED), persiste snapshots y programa nextEligible futuro', async () => {
    const syncRepo = new InMemoryMetaSyncRepo();
    const sched = new InMemoryMetaScheduleRepo();
    sched.marcarConectada('o', 'c');
    const t = new Transporte();
    const n = await procesarTick(deps(t, syncRepo, sched, T0));
    expect(n).toBe(1);
    expect((await syncRepo.listarSnapshots('o', 'c')).length).toBeGreaterThan(0);
    const row = await sched.obtener('o', 'c');
    expect(row!.lastErrorClass).toBe('NONE');
    expect(row!.consecutiveFailures).toBe(0);
    expect(row!.lockedUntil).toBeNull(); // lock liberado
    expect(Date.parse(row!.nextEligibleSyncAt!)).toBeGreaterThan(Date.parse(T0)); // no elegible aún
  });

  it('segundo tick inmediato NO reprocesa (FRESH ⇒ nextEligible futuro) y no llama Graph', async () => {
    const syncRepo = new InMemoryMetaSyncRepo();
    const sched = new InMemoryMetaScheduleRepo();
    sched.marcarConectada('o', 'c');
    await procesarTick(deps(new Transporte(), syncRepo, sched, T0));
    const t2 = new Transporte();
    const n = await procesarTick(deps(t2, syncRepo, sched, T0));
    expect(n).toBe(0);
    expect(t2.urls).toHaveLength(0);
  });

  it('pasado el TTL vuelve a ser elegible y re-sincroniza', async () => {
    const syncRepo = new InMemoryMetaSyncRepo();
    const sched = new InMemoryMetaScheduleRepo();
    sched.marcarConectada('o', 'c');
    await procesarTick(deps(new Transporte(), syncRepo, sched, T0));
    const n = await procesarTick(deps(new Transporte(), syncRepo, sched, T25H));
    expect(n).toBe(1);
  });
});

describe('scheduler · fallos + concurrencia + tenant on/off', () => {
  it('fallo (auth) ⇒ consecutiveFailures++, lastErrorClass AUTH, backoff largo (6h)', async () => {
    const syncRepo = new InMemoryMetaSyncRepo();
    const sched = new InMemoryMetaScheduleRepo();
    sched.marcarConectada('o', 'c');
    const t = new Transporte(() => ({ code: 190, status: 401 })); // todo falla auth
    await procesarTick(deps(t, syncRepo, sched, T0));
    const row = await sched.obtener('o', 'c');
    expect(row!.lastErrorClass).toBe('AUTH');
    expect(row!.consecutiveFailures).toBe(1);
    expect(Date.parse(row!.nextEligibleSyncAt!)).toBe(Date.parse(T0) + 6 * 3600_000);
    expect(row!.capabilitiesAffected.length).toBeGreaterThan(0);
  });

  it('claim de concurrencia: dos reclamos ⇒ exactamente uno gana', async () => {
    const sched = new InMemoryMetaScheduleRepo();
    const [a, b] = await Promise.all([sched.reclamar('o', 'c', T0, 60_000), sched.reclamar('o', 'c', T0, 60_000)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });

  it('ON/OFF por organización: deshabilitada ⇒ no elegible', async () => {
    const sched = new InMemoryMetaScheduleRepo();
    sched.marcarConectada('o', 'c');
    await sched.configurar('o', 'c', false);
    expect(await sched.listarElegibles(T0, 20)).toHaveLength(0);
    await sched.configurar('o', 'c', true);
    expect((await sched.listarElegibles(T0, 20)).length).toBe(1);
  });

  it('tenant isolation: sólo procesa conexiones marcadas conectadas', async () => {
    const syncRepo = new InMemoryMetaSyncRepo();
    const sched = new InMemoryMetaScheduleRepo();
    sched.marcarConectada('org-a', 'meta-org-a'); // sólo org-a
    const n = await procesarTick(deps(new Transporte(), syncRepo, sched, T0));
    expect(n).toBe(1);
    expect(await sched.obtener('org-b', 'meta-org-b')).toBeNull();
  });
});
