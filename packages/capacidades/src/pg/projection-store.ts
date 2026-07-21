import type { Pool } from 'pg';
import type { CapDefState } from '../domain/aggregate-definition';
import type { CapExecState } from '../domain/aggregate-execution';
import type {
  CapDefProjectionStore,
  CapDefSnapshot,
  CapExecProjectionStore,
  CapExecSnapshot,
} from '../projections/projection';

interface DefRow {
  version: number;
  state: CapDefState;
}
interface ExecRow {
  version: number;
  state: CapExecState;
}

export class PgCapDefProjectionStore implements CapDefProjectionStore {
  constructor(private readonly pool: Pool) {}
  async get(org: string, capabilityId: string): Promise<CapDefSnapshot | null> {
    const { rows } = await this.pool.query<DefRow>(
      `select version, state from proj_capdef_current where organization_id = $1 and capability_id = $2`,
      [org, capabilityId],
    );
    const r = rows[0];
    return r ? { version: r.version, state: r.state } : null;
  }
  async save(org: string, capabilityId: string, snap: CapDefSnapshot): Promise<void> {
    await this.pool.query(
      `insert into proj_capdef_current (organization_id, capability_id, version, vigente, state, updated_at)
       values ($1,$2,$3,$4,$5::jsonb, now())
       on conflict (organization_id, capability_id) do update set
         version = excluded.version, vigente = excluded.vigente, state = excluded.state, updated_at = now()`,
      [org, capabilityId, snap.version, snap.state.vigente, JSON.stringify(snap.state)],
    );
  }
  async list(org: string): Promise<readonly CapDefState[]> {
    const { rows } = await this.pool.query<DefRow>(
      `select version, state from proj_capdef_current where organization_id = $1 order by capability_id`,
      [org],
    );
    return rows.map((r) => r.state);
  }
  async deleteAll(): Promise<void> {
    await this.pool.query('truncate table proj_capdef_current');
  }
}

export class PgCapExecProjectionStore implements CapExecProjectionStore {
  constructor(private readonly pool: Pool) {}
  async get(org: string, executionId: string): Promise<CapExecSnapshot | null> {
    const { rows } = await this.pool.query<ExecRow>(
      `select version, state from proj_capexec_current where organization_id = $1 and execution_id = $2`,
      [org, executionId],
    );
    const r = rows[0];
    return r ? { version: r.version, state: r.state } : null;
  }
  async save(org: string, executionId: string, snap: CapExecSnapshot): Promise<void> {
    const s = snap.state;
    await this.pool.query(
      `insert into proj_capexec_current (organization_id, execution_id, version, capability_id, estado, abstenido, state, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7::jsonb, now())
       on conflict (organization_id, execution_id) do update set
         version = excluded.version, capability_id = excluded.capability_id, estado = excluded.estado,
         abstenido = excluded.abstenido, state = excluded.state, updated_at = now()`,
      [org, executionId, snap.version, s.capabilityId || null, s.estado, s.producto?.abstenido ?? null, JSON.stringify(s)],
    );
  }
  async list(org: string): Promise<readonly CapExecState[]> {
    const { rows } = await this.pool.query<ExecRow>(
      `select version, state from proj_capexec_current where organization_id = $1 order by execution_id`,
      [org],
    );
    return rows.map((r) => r.state);
  }
  async deleteAll(): Promise<void> {
    await this.pool.query('truncate table proj_capexec_current');
  }
}
