import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makePool } from '../../src/pg/pool';
import { runMigrations, migrations } from '../../src/pg/migrate';
import { PgEventStore } from '../../src/pg/pg-event-store';
import { PgOutbox } from '../../src/pg/pg-outbox';
import { runEventStoreConformance } from '../conformance';
import {
  ActorId,
  type Attribution,
  OrganizationId,
  type RequestContext,
} from '@soec/contracts';

const CONN = process.env.DATABASE_URL ?? 'postgres://soec:soec@localhost:5544/soec';
const pool = makePool(CONN);

beforeAll(async () => {
  await runMigrations(pool);
});

afterAll(async () => {
  await pool.end();
});

async function truncate(): Promise<void> {
  await pool.query('truncate table events, outbox, projection_checkpoints restart identity cascade');
}

// Misma batería de conformidad, ahora contra PostgreSQL real → demuestra sustituibilidad.
runEventStoreConformance('PostgreSQL', async () => {
  await truncate();
  return { store: new PgEventStore(pool), cleanup: async () => undefined };
});

const attr: Attribution = {
  source: 'test',
  purpose: 'pg',
  assumptions: [],
  claimType: 'observational',
  regime: 'empirical',
  uncertainty: 'none',
};

function ctxFor(org: string): RequestContext {
  const organizationId = OrganizationId(org);
  return {
    organizationId,
    actor: ActorId('tester'),
    scope: { organizationId, permissions: ['events:append', 'events:read'] },
    correlationId: `corr-${org}`,
  };
}

describe('PostgreSQL — migración e infraestructura', () => {
  it('migra desde base vacía de forma idempotente', async () => {
    // Ya migrado en beforeAll; re-ejecutar no debe aplicar nada nuevo.
    const applied = await runMigrations(pool);
    expect(applied).toEqual([]);
    expect(migrations.length).toBeGreaterThan(0);
  });

  it('outbox: un evento registrado queda pendiente y se procesa idempotentemente', async () => {
    await truncate();
    const store = new PgEventStore(pool);
    const outbox = new PgOutbox(pool);
    const ctx = ctxFor('orgA');
    await store.append(ctx, 's-outbox', 0, [
      { type: 'A', payload: { n: 1 }, attribution: attr, occurredAt: new Date().toISOString() },
    ]);
    const pending = await outbox.pending(10);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.event.type).toBe('A');

    const id = pending[0]!.id;
    await outbox.markProcessed(id);
    await outbox.markProcessed(id); // idempotente
    expect(await outbox.pending(10)).toHaveLength(0);
  });
});
