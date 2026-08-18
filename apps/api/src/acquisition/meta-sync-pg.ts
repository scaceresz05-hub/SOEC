/**
 * apps/api · Persistencia PostgreSQL del SYNC read-only de Meta. Tenant-scoped, `meta_sync_*`.
 *
 * Persiste SÓLO snapshots NORMALIZADOS (resumen: conteos / métricas / identidad whitelisted) y el estado de
 * observabilidad. NUNCA raw Graph, URLs de paging, token ni PII de leads. Idempotencia por upsert sobre
 * (organization_id, connection_id, capability, external_id, period): mismo asset+período no duplica.
 */

import type { Pool } from 'pg';
import type { Migration } from '@soec/event-store/pg';
import type { MetaSyncRepo, SnapshotSync, EstadoSync, ClaseErrorSync, CapacidadSync, EstadoCapacidadSync, ResumenNormalizado } from './meta-sync';
import type { MetaScheduleRepo, ScheduleRow, ConexionElegible } from './meta-scheduler';

export const metaSyncMigrations: ReadonlyArray<Migration> = [
  {
    id: '0002_meta_sync_init',
    sql: `
      create table if not exists meta_sync_snapshot (
        organization_id text not null,
        connection_id   text not null,
        capability      text not null,
        external_id     text not null,
        period          text not null,
        observed_at     timestamptz not null,
        source          text not null default 'meta',
        resumen         jsonb not null,
        primary key (organization_id, connection_id, capability, external_id, period)
      );
      create index if not exists meta_sync_snapshot_org_idx on meta_sync_snapshot (organization_id, connection_id);

      create table if not exists meta_sync_state (
        organization_id           text not null,
        connection_id             text not null,
        last_sync_at              timestamptz not null,
        last_successful_sync_at   timestamptz,
        last_error_class          text not null,
        salud_conexion            text not null,
        capacidades               jsonb not null default '[]'::jsonb,
        primary key (organization_id, connection_id)
      );
    `,
  },
  {
    id: '0003_meta_sync_schedule',
    sql: `
      create table if not exists meta_sync_schedule (
        organization_id         text not null,
        connection_id           text not null,
        sync_enabled            boolean not null default true,
        last_attempt_at         timestamptz,
        last_successful_sync_at timestamptz,
        next_eligible_sync_at   timestamptz,
        consecutive_failures    int not null default 0,
        last_error_class        text not null default 'NONE',
        capabilities_affected   jsonb not null default '[]'::jsonb,
        locked_until            timestamptz,
        primary key (organization_id, connection_id)
      );
      create index if not exists meta_sync_schedule_due_idx on meta_sync_schedule (next_eligible_sync_at);
    `,
  },
];

export class PgMetaSyncRepo implements MetaSyncRepo {
  constructor(private readonly pool: Pool) {}

  async upsertSnapshot(s: SnapshotSync): Promise<void> {
    await this.pool.query(
      `insert into meta_sync_snapshot (organization_id, connection_id, capability, external_id, period, observed_at, source, resumen)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (organization_id, connection_id, capability, external_id, period)
       do update set observed_at = excluded.observed_at, source = excluded.source, resumen = excluded.resumen`,
      [s.organizationId, s.connectionId, s.capability, s.externalId, s.period, s.observedAt, s.source, JSON.stringify(s.resumen)],
    );
  }

  async guardarEstado(e: EstadoSync): Promise<void> {
    await this.pool.query(
      `insert into meta_sync_state (organization_id, connection_id, last_sync_at, last_successful_sync_at, last_error_class, salud_conexion, capacidades)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (organization_id, connection_id)
       do update set last_sync_at = excluded.last_sync_at, last_successful_sync_at = excluded.last_successful_sync_at,
                     last_error_class = excluded.last_error_class, salud_conexion = excluded.salud_conexion, capacidades = excluded.capacidades`,
      [e.organizationId, e.connectionId, e.lastSyncAt, e.lastSuccessfulSyncAt, e.lastErrorClass, e.saludConexion, JSON.stringify(e.capacidades)],
    );
  }

  async obtenerEstado(organizationId: string, connectionId: string): Promise<EstadoSync | null> {
    const r = await this.pool.query('select * from meta_sync_state where organization_id = $1 and connection_id = $2', [organizationId, connectionId]);
    const row = r.rows[0] as
      | { last_sync_at: Date; last_successful_sync_at: Date | null; last_error_class: string; salud_conexion: string; capacidades: unknown }
      | undefined;
    if (!row) return null;
    return {
      organizationId,
      connectionId,
      lastSyncAt: row.last_sync_at.toISOString(),
      lastSuccessfulSyncAt: row.last_successful_sync_at ? row.last_successful_sync_at.toISOString() : null,
      lastErrorClass: row.last_error_class as ClaseErrorSync,
      saludConexion: row.salud_conexion,
      capacidades: (Array.isArray(row.capacidades) ? row.capacidades : []) as EstadoCapacidadSync[],
    };
  }

  async listarSnapshots(organizationId: string, connectionId: string): Promise<readonly SnapshotSync[]> {
    const r = await this.pool.query('select * from meta_sync_snapshot where organization_id = $1 and connection_id = $2 order by capability, external_id', [organizationId, connectionId]);
    return r.rows.map((row: { capability: string; external_id: string; period: string; observed_at: Date; source: string; resumen: unknown }) => ({
      organizationId,
      connectionId,
      capability: row.capability as CapacidadSync,
      externalId: row.external_id,
      period: row.period,
      observedAt: row.observed_at.toISOString(),
      source: row.source as 'meta',
      resumen: row.resumen as ResumenNormalizado,
    }));
  }
}

export function crearMetaSyncRepo(pool: Pool): PgMetaSyncRepo {
  return new PgMetaSyncRepo(pool);
}

// ---------------------------------------------------------------------------
// Scheduler: elegibilidad + claim atómico + observabilidad
// ---------------------------------------------------------------------------

function mapSchedule(row: Record<string, unknown> | undefined, org: string, conn: string): ScheduleRow | null {
  if (!row) return null;
  const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : null);
  return {
    organizationId: org,
    connectionId: conn,
    syncEnabled: row['sync_enabled'] === true,
    lastAttemptAt: iso(row['last_attempt_at']),
    lastSuccessfulSyncAt: iso(row['last_successful_sync_at']),
    nextEligibleSyncAt: iso(row['next_eligible_sync_at']),
    consecutiveFailures: typeof row['consecutive_failures'] === 'number' ? (row['consecutive_failures'] as number) : 0,
    lastErrorClass: String(row['last_error_class'] ?? 'NONE') as ScheduleRow['lastErrorClass'],
    capabilitiesAffected: (Array.isArray(row['capabilities_affected']) ? row['capabilities_affected'] : []) as ScheduleRow['capabilitiesAffected'],
    lockedUntil: iso(row['locked_until']),
  };
}

export class PgMetaScheduleRepo implements MetaScheduleRepo {
  constructor(private readonly pool: Pool) {}

  async listarElegibles(ahora: string, limite: number): Promise<readonly ConexionElegible[]> {
    const r = await this.pool.query(
      `select c.organization_id, c.connection_id
         from meta_connection c
         left join meta_sync_schedule s on s.organization_id = c.organization_id and s.connection_id = c.connection_id
        where c.estado = 'CONNECTED_READ_ONLY'
          and coalesce(s.sync_enabled, true) = true
          and (s.next_eligible_sync_at is null or s.next_eligible_sync_at <= $1)
          and (s.locked_until is null or s.locked_until < $1)
        order by s.next_eligible_sync_at asc nulls first
        limit $2`,
      [ahora, limite],
    );
    return r.rows.map((row: { organization_id: string; connection_id: string }) => ({ organizationId: row.organization_id, connectionId: row.connection_id }));
  }

  async reclamar(organizationId: string, connectionId: string, ahora: string, lockMs: number): Promise<boolean> {
    const lockedUntil = new Date(Date.parse(ahora) + lockMs).toISOString();
    const r = await this.pool.query(
      `insert into meta_sync_schedule (organization_id, connection_id, last_attempt_at, locked_until)
       values ($1,$2,$3,$4)
       on conflict (organization_id, connection_id) do update
         set locked_until = excluded.locked_until, last_attempt_at = excluded.last_attempt_at
         where meta_sync_schedule.locked_until is null or meta_sync_schedule.locked_until < $3
       returning organization_id`,
      [organizationId, connectionId, ahora, lockedUntil],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async actualizar(row: ScheduleRow): Promise<void> {
    await this.pool.query(
      `insert into meta_sync_schedule (organization_id, connection_id, sync_enabled, last_attempt_at, last_successful_sync_at, next_eligible_sync_at, consecutive_failures, last_error_class, capabilities_affected, locked_until)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       on conflict (organization_id, connection_id) do update
         set sync_enabled = excluded.sync_enabled, last_attempt_at = excluded.last_attempt_at, last_successful_sync_at = excluded.last_successful_sync_at,
             next_eligible_sync_at = excluded.next_eligible_sync_at, consecutive_failures = excluded.consecutive_failures,
             last_error_class = excluded.last_error_class, capabilities_affected = excluded.capabilities_affected, locked_until = excluded.locked_until`,
      [row.organizationId, row.connectionId, row.syncEnabled, row.lastAttemptAt, row.lastSuccessfulSyncAt, row.nextEligibleSyncAt, row.consecutiveFailures, row.lastErrorClass, JSON.stringify(row.capabilitiesAffected), row.lockedUntil],
    );
  }

  async obtener(organizationId: string, connectionId: string): Promise<ScheduleRow | null> {
    const r = await this.pool.query('select * from meta_sync_schedule where organization_id = $1 and connection_id = $2', [organizationId, connectionId]);
    return mapSchedule(r.rows[0] as Record<string, unknown> | undefined, organizationId, connectionId);
  }

  async configurar(organizationId: string, connectionId: string, enabled: boolean): Promise<void> {
    await this.pool.query(
      `insert into meta_sync_schedule (organization_id, connection_id, sync_enabled)
       values ($1,$2,$3)
       on conflict (organization_id, connection_id) do update set sync_enabled = excluded.sync_enabled`,
      [organizationId, connectionId, enabled],
    );
  }
}

export function crearMetaScheduleRepo(pool: Pool): PgMetaScheduleRepo {
  return new PgMetaScheduleRepo(pool);
}
