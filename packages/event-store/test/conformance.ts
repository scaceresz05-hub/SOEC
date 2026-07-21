import { describe, expect, it } from 'vitest';
import {
  ActorId,
  type Attribution,
  type EventStore,
  OrganizationId,
  type RequestContext,
  AttributionRequiredError,
  ConcurrencyError,
  ScopeMismatchError,
  ScopeRequiredError,
} from '@soec/contracts';

const attr: Attribution = {
  source: 'test',
  purpose: 'conformance',
  assumptions: [],
  claimType: 'observational',
  regime: 'empirical',
  uncertainty: 'none',
};

function ctxFor(org: string, permissions: string[] = ['events:append', 'events:read']): RequestContext {
  const organizationId = OrganizationId(org);
  return {
    organizationId,
    actor: ActorId('tester'),
    scope: { organizationId, permissions },
    correlationId: `corr-${org}`,
  };
}

const nowIso = (): string => new Date().toISOString();
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface StoreHarness {
  store: EventStore;
  cleanup: () => Promise<void>;
}

/** Batería de conformidad ADR-0002. Se ejecuta idéntica contra cualquier EventStore. */
export function runEventStoreConformance(name: string, setup: () => Promise<StoreHarness>): void {
  describe(`Conformance ADR-0002 — ${name}`, () => {
    it('append + readStream conserva orden, atribución y contexto', async () => {
      const { store, cleanup } = await setup();
      try {
        const ctx = ctxFor('orgA');
        const r = await store.append(ctx, 's1', 0, [
          { type: 'Hecho', payload: { n: 1 }, attribution: attr, occurredAt: nowIso() },
        ]);
        expect(r.version).toBe(1);
        const evs = await store.readStream(ctx, 's1');
        expect(evs).toHaveLength(1);
        expect(evs[0]?.type).toBe('Hecho');
        expect(evs[0]?.organizationId).toBe(ctx.organizationId);
        expect(evs[0]?.attribution.source).toBe('test');
        expect(evs[0]?.recordedAt).toBeTruthy();
        expect(evs[0]?.correlationId).toBe('corr-orgA');
      } finally {
        await cleanup();
      }
    });

    it('rechaza append sin permiso de alcance (C-5)', async () => {
      const { store, cleanup } = await setup();
      try {
        const ctx = ctxFor('orgA', ['events:read']); // sin events:append
        await expect(
          store.append(ctx, 's1', 0, [{ type: 'X', payload: {}, attribution: attr, occurredAt: nowIso() }]),
        ).rejects.toBeInstanceOf(ScopeRequiredError);
      } finally {
        await cleanup();
      }
    });

    it('rechaza contexto con alcance de otra organización (C-5)', async () => {
      const { store, cleanup } = await setup();
      try {
        const organizationId = OrganizationId('orgA');
        const bad: RequestContext = {
          organizationId,
          actor: ActorId('tester'),
          scope: { organizationId: OrganizationId('orgB'), permissions: ['events:read'] },
          correlationId: 'c',
        };
        await expect(store.readStream(bad, 's1')).rejects.toBeInstanceOf(ScopeMismatchError);
      } finally {
        await cleanup();
      }
    });

    it('rechaza append sin atribución (C-2)', async () => {
      const { store, cleanup } = await setup();
      try {
        const ctx = ctxFor('orgA');
        const badAttr: Attribution = { ...attr, source: '' };
        await expect(
          store.append(ctx, 's1', 0, [{ type: 'X', payload: {}, attribution: badAttr, occurredAt: nowIso() }]),
        ).rejects.toBeInstanceOf(AttributionRequiredError);
      } finally {
        await cleanup();
      }
    });

    it('concurrencia optimista: versión obsoleta es rechazada (C-1)', async () => {
      const { store, cleanup } = await setup();
      try {
        const ctx = ctxFor('orgA');
        await store.append(ctx, 's1', 0, [{ type: 'A', payload: {}, attribution: attr, occurredAt: nowIso() }]);
        await expect(
          store.append(ctx, 's1', 0, [{ type: 'B', payload: {}, attribution: attr, occurredAt: nowIso() }]),
        ).rejects.toBeInstanceOf(ConcurrencyError);
      } finally {
        await cleanup();
      }
    });

    it('append-only: los eventos previos no se sobrescriben (C-3)', async () => {
      const { store, cleanup } = await setup();
      try {
        const ctx = ctxFor('orgA');
        const first = await store.append(ctx, 's1', 0, [
          { type: 'A', payload: { v: 1 }, attribution: attr, occurredAt: nowIso() },
        ]);
        const before = await store.readStream(ctx, 's1');
        await store.append(ctx, 's1', 1, [
          { type: 'B', payload: { v: 2 }, attribution: attr, occurredAt: nowIso() },
        ]);
        const after = await store.readStream(ctx, 's1');
        expect(after).toHaveLength(2);
        // El primer evento es idéntico: mismo id, secuencia y tiempo de registro.
        expect(after[0]?.eventId).toBe(before[0]?.eventId);
        expect(after[0]?.eventId).toBe(first.events[0]?.eventId);
        expect(after[0]?.sequence).toBe(1);
        expect(after[0]?.recordedAt).toBe(before[0]?.recordedAt);
        expect(after[1]?.sequence).toBe(2);
      } finally {
        await cleanup();
      }
    });

    it('idempotencia: repetir un lote con la misma clave no duplica (C-1)', async () => {
      const { store, cleanup } = await setup();
      try {
        const ctx = ctxFor('orgA');
        const batch = [
          { type: 'A', payload: { v: 1 }, attribution: attr, occurredAt: nowIso(), idempotencyKey: 'k1' },
        ];
        const r1 = await store.append(ctx, 's1', 0, batch);
        const r2 = await store.append(ctx, 's1', 0, batch); // repetición
        expect(r2.events[0]?.eventId).toBe(r1.events[0]?.eventId);
        const evs = await store.readStream(ctx, 's1');
        expect(evs).toHaveLength(1);
      } finally {
        await cleanup();
      }
    });

    it('reconstrucción temporal: no contamina con conocimiento posterior (C-3/C-4)', async () => {
      const { store, cleanup } = await setup();
      try {
        const ctx = ctxFor('orgA');
        const r1 = await store.append(ctx, 's1', 0, [
          { type: 'A', payload: {}, attribution: attr, occurredAt: nowIso() },
        ]);
        const cutoff = r1.events[0]?.recordedAt as string;
        await sleep(15);
        await store.append(ctx, 's1', 1, [
          { type: 'B', payload: {}, attribution: attr, occurredAt: nowIso() },
        ]);
        const past = await store.reconstructAt(ctx, 's1', cutoff);
        expect(past).toHaveLength(1);
        expect(past[0]?.type).toBe('A');
        const present = await store.readStream(ctx, 's1');
        expect(present).toHaveLength(2);
      } finally {
        await cleanup();
      }
    });

    it('aislamiento organizacional: una organización no ve los streams de otra (C-5)', async () => {
      const { store, cleanup } = await setup();
      try {
        const a = ctxFor('orgA');
        const b = ctxFor('orgB');
        await store.append(a, 'shared', 0, [
          { type: 'A', payload: {}, attribution: attr, occurredAt: nowIso() },
        ]);
        // orgB usa el mismo streamId pero está aislada.
        expect(await store.readStream(b, 'shared')).toHaveLength(0);
        expect(await store.currentVersion(b, 'shared')).toBe(0);
        // orgB puede escribir su propio stream homónimo sin conflicto.
        const rb = await store.append(b, 'shared', 0, [
          { type: 'B', payload: {}, attribution: attr, occurredAt: nowIso() },
        ]);
        expect(rb.version).toBe(1);
        expect(await store.readStream(a, 'shared')).toHaveLength(1);
      } finally {
        await cleanup();
      }
    });
  });
}
