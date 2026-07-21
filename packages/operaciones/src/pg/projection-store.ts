import type { Pool } from 'pg';
import type { OiState } from '../domain/aggregate';
import type { OiProjectionStore, OiSnapshot } from '../projections/projection';

interface ProjRow {
  version: number;
  state: OiState;
}

/** Proyección de operaciones respaldada por PostgreSQL. */
export class PgOiProjectionStore implements OiProjectionStore {
  constructor(private readonly pool: Pool) {}

  async get(org: string, executionId: string): Promise<OiSnapshot | null> {
    const { rows } = await this.pool.query<ProjRow>(
      `select version, state from proj_oi_current where organization_id = $1 and execution_id = $2`,
      [org, executionId],
    );
    const row = rows[0];
    return row ? { version: row.version, state: row.state } : null;
  }

  async save(org: string, executionId: string, snapshot: OiSnapshot): Promise<void> {
    const s = snapshot.state;
    await this.pool.query(
      `insert into proj_oi_current
         (organization_id, execution_id, version, operacion, ece_id, estado, abstenido, mecanismo, state, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb, now())
       on conflict (organization_id, execution_id) do update set
         version = excluded.version, operacion = excluded.operacion, ece_id = excluded.ece_id,
         estado = excluded.estado, abstenido = excluded.abstenido, mecanismo = excluded.mecanismo,
         state = excluded.state, updated_at = now()`,
      [
        org,
        executionId,
        snapshot.version,
        s.operacion,
        s.eceId || null,
        s.estado,
        s.producto?.abstenido ?? null,
        s.mecanismo || null,
        JSON.stringify(s),
      ],
    );
  }

  async list(org: string): Promise<readonly OiState[]> {
    const { rows } = await this.pool.query<ProjRow>(
      `select version, state from proj_oi_current where organization_id = $1 order by execution_id`,
      [org],
    );
    return rows.map((r) => r.state);
  }

  async deleteAll(): Promise<void> {
    await this.pool.query('truncate table proj_oi_current');
  }
}
