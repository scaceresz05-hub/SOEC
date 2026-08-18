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
