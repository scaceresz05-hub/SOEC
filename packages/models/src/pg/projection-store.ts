import type { Pool } from 'pg';
import type { ModelInstanceState, ModelType } from '../domain/model';
import type { ModelProjectionStore, ProjectionSnapshot } from '../projections/projection';

function tabla(modelType: ModelType): string {
  // Tablas separadas por modelo: la frontera MED ╪ MDM también es física (§8).
  return modelType === 'MED' ? 'proj_med_current' : 'proj_mdm_current';
}

interface ProjRow {
  version: number;
  state: ModelInstanceState;
}

/** Proyecciones de modelo respaldadas por PostgreSQL, una tabla por modelo. */
export class PgProjectionStore implements ModelProjectionStore {
  constructor(private readonly pool: Pool) {}

  async get(modelType: ModelType, org: string, instanceId: string): Promise<ProjectionSnapshot | null> {
    const { rows } = await this.pool.query<ProjRow>(
      `select version, state from ${tabla(modelType)} where organization_id = $1 and instance_id = $2`,
      [org, instanceId],
    );
    const row = rows[0];
    return row ? { version: row.version, state: row.state } : null;
  }

  async save(modelType: ModelType, org: string, instanceId: string, snapshot: ProjectionSnapshot): Promise<void> {
    await this.pool.query(
      `insert into ${tabla(modelType)} (organization_id, instance_id, version, state, updated_at)
         values ($1, $2, $3, $4::jsonb, now())
       on conflict (organization_id, instance_id)
         do update set version = excluded.version, state = excluded.state, updated_at = now()`,
      [org, instanceId, snapshot.version, JSON.stringify(snapshot.state)],
    );
  }

  async list(modelType: ModelType, org: string): Promise<readonly ModelInstanceState[]> {
    const { rows } = await this.pool.query<ProjRow>(
      `select version, state from ${tabla(modelType)} where organization_id = $1 order by instance_id`,
      [org],
    );
    return rows.map((r) => r.state);
  }

  async deleteAll(): Promise<void> {
    await this.pool.query('truncate table proj_med_current, proj_mdm_current');
  }
}
