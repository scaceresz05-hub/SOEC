import type { Pool } from 'pg';

/** Migraciones versionadas. Nunca se modifica una ya aplicada; se agregan nuevas. */
export const migrations: ReadonlyArray<{ id: string; sql: string }> = [
  {
    id: '0001_init',
    sql: `
      create table if not exists events (
        event_id uuid primary key,
        stream_id text not null,
        sequence integer not null,
        organization_id text not null,
        actor_id text not null,
        type text not null,
        payload jsonb not null,
        attribution jsonb not null,
        occurred_at timestamptz(3) not null,
        recorded_at timestamptz(3) not null default now(),
        correlation_id text not null,
        causation_id text,
        idempotency_key text,
        constraint events_org_stream_seq unique (organization_id, stream_id, sequence)
      );
      create unique index if not exists events_idem
        on events (organization_id, stream_id, idempotency_key)
        where idempotency_key is not null;
      create index if not exists events_org_stream on events (organization_id, stream_id);
      create index if not exists events_recorded on events (organization_id, stream_id, recorded_at);

      create table if not exists outbox (
        id uuid primary key default gen_random_uuid(),
        event_id uuid not null references events (event_id),
        created_at timestamptz not null default now(),
        processed_at timestamptz
      );
      create index if not exists outbox_pending on outbox (created_at) where processed_at is null;

      create table if not exists projection_checkpoints (
        projection text primary key,
        last_recorded_at timestamptz,
        last_event_id uuid,
        updated_at timestamptz not null default now()
      );
    `,
  },
];

/** Aplica las migraciones pendientes de forma transaccional e idempotente. */
export async function runMigrations(pool: Pool): Promise<string[]> {
  const applied: string[] = [];
  await pool.query(
    `create table if not exists schema_migrations (
       id text primary key,
       applied_at timestamptz not null default now()
     )`,
  );
  for (const m of migrations) {
    const existing = await pool.query('select 1 from schema_migrations where id = $1', [m.id]);
    if ((existing.rowCount ?? 0) > 0) continue;
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(m.sql);
      await client.query('insert into schema_migrations (id) values ($1)', [m.id]);
      await client.query('commit');
      applied.push(m.id);
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  }
  return applied;
}
