import type { Pool } from 'pg';
import type { PolicyState } from '../domain/policy';
import type { AccionState } from '../domain/action';
import type {
  AccionProjectionStore,
  AccionSnapshot,
  PolicyProjectionStore,
  PolicySnapshot,
} from '../projections/projection';

interface PolRow {
  version: number;
  state: PolicyState;
}
interface AccRow {
  version: number;
  state: AccionState;
}

export class PgPolicyProjectionStore implements PolicyProjectionStore {
  constructor(private readonly pool: Pool) {}
  async get(org: string, policyId: string): Promise<PolicySnapshot | null> {
    const { rows } = await this.pool.query<PolRow>(
      `select version, state from proj_policy_current where organization_id = $1 and policy_id = $2`,
      [org, policyId],
    );
    const r = rows[0];
    return r ? { version: r.version, state: r.state } : null;
  }
  async save(org: string, policyId: string, snap: PolicySnapshot): Promise<void> {
    const s = snap.state;
    await this.pool.query(
      `insert into proj_policy_current (organization_id, policy_id, version, estado, vigente, state, updated_at)
       values ($1,$2,$3,$4,$5,$6::jsonb, now())
       on conflict (organization_id, policy_id) do update set
         version = excluded.version, estado = excluded.estado, vigente = excluded.vigente,
         state = excluded.state, updated_at = now()`,
      [org, policyId, snap.version, s.estado, s.vigente, JSON.stringify(s)],
    );
  }
  async list(org: string): Promise<readonly PolicyState[]> {
    const { rows } = await this.pool.query<PolRow>(
      `select version, state from proj_policy_current where organization_id = $1 order by policy_id`,
      [org],
    );
    return rows.map((r) => r.state);
  }
  async deleteAll(): Promise<void> {
    await this.pool.query('truncate table proj_policy_current');
  }
}

export class PgAccionProjectionStore implements AccionProjectionStore {
  constructor(private readonly pool: Pool) {}
  async get(org: string, executionId: string): Promise<AccionSnapshot | null> {
    const { rows } = await this.pool.query<AccRow>(
      `select version, state from proj_accion_current where organization_id = $1 and execution_id = $2`,
      [org, executionId],
    );
    const r = rows[0];
    return r ? { version: r.version, state: r.state } : null;
  }
  async save(org: string, executionId: string, snap: AccionSnapshot): Promise<void> {
    const s = snap.state;
    await this.pool.query(
      `insert into proj_accion_current (organization_id, execution_id, version, policy_id, estado, canal, costo_consumido, state, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb, now())
       on conflict (organization_id, execution_id) do update set
         version = excluded.version, policy_id = excluded.policy_id, estado = excluded.estado,
         canal = excluded.canal, costo_consumido = excluded.costo_consumido, state = excluded.state, updated_at = now()`,
      [org, executionId, snap.version, s.policyId || null, s.estado, s.accion?.canal ?? null, s.costoConsumido, JSON.stringify(s)],
    );
  }
  async list(org: string): Promise<readonly AccionState[]> {
    const { rows } = await this.pool.query<AccRow>(
      `select version, state from proj_accion_current where organization_id = $1 order by execution_id`,
      [org],
    );
    return rows.map((r) => r.state);
  }
  async deleteAll(): Promise<void> {
    await this.pool.query('truncate table proj_accion_current');
  }
}
