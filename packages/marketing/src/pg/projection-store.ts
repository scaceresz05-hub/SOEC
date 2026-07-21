import type { Pool } from 'pg';
import type { ObjetivoState } from '../domain/objetivo';
import type { PlanState } from '../domain/plan';
import type {
  ObjetivoProjectionStore,
  ObjetivoSnapshot,
  PlanProjectionStore,
  PlanSnapshot,
} from '../projections/projection';

interface ObjRow {
  version: number;
  state: ObjetivoState;
}
interface PlanRow {
  version: number;
  state: PlanState;
}

export class PgObjetivoProjectionStore implements ObjetivoProjectionStore {
  constructor(private readonly pool: Pool) {}
  async get(org: string, id: string): Promise<ObjetivoSnapshot | null> {
    const { rows } = await this.pool.query<ObjRow>(`select version, state from proj_objetivo_current where organization_id = $1 and objetivo_id = $2`, [org, id]);
    const r = rows[0];
    return r ? { version: r.version, state: r.state } : null;
  }
  async save(org: string, id: string, snap: ObjetivoSnapshot): Promise<void> {
    await this.pool.query(
      `insert into proj_objetivo_current (organization_id, objetivo_id, version, evaluable, state, updated_at)
       values ($1,$2,$3,$4,$5::jsonb, now())
       on conflict (organization_id, objetivo_id) do update set version = excluded.version, evaluable = excluded.evaluable, state = excluded.state, updated_at = now()`,
      [org, id, snap.version, snap.state.evaluable, JSON.stringify(snap.state)],
    );
  }
  async list(org: string): Promise<readonly ObjetivoState[]> {
    const { rows } = await this.pool.query<ObjRow>(`select version, state from proj_objetivo_current where organization_id = $1 order by objetivo_id`, [org]);
    return rows.map((r) => r.state);
  }
  async deleteAll(): Promise<void> {
    await this.pool.query('truncate table proj_objetivo_current');
  }
}

export class PgPlanProjectionStore implements PlanProjectionStore {
  constructor(private readonly pool: Pool) {}
  async get(org: string, id: string): Promise<PlanSnapshot | null> {
    const { rows } = await this.pool.query<PlanRow>(`select version, state from proj_plan_current where organization_id = $1 and plan_id = $2`, [org, id]);
    const r = rows[0];
    return r ? { version: r.version, state: r.state } : null;
  }
  async save(org: string, id: string, snap: PlanSnapshot): Promise<void> {
    const s = snap.state;
    await this.pool.query(
      `insert into proj_plan_current (organization_id, plan_id, version, plan_version, estado, objetivo_ref, policy_id, state, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb, now())
       on conflict (organization_id, plan_id) do update set version = excluded.version, plan_version = excluded.plan_version, estado = excluded.estado, objetivo_ref = excluded.objetivo_ref, policy_id = excluded.policy_id, state = excluded.state, updated_at = now()`,
      [org, id, snap.version, s.planVersion, s.estado, s.objetivoRef || null, s.policyId || null, JSON.stringify(s)],
    );
  }
  async list(org: string): Promise<readonly PlanState[]> {
    const { rows } = await this.pool.query<PlanRow>(`select version, state from proj_plan_current where organization_id = $1 order by plan_id`, [org]);
    return rows.map((r) => r.state);
  }
  async deleteAll(): Promise<void> {
    await this.pool.query('truncate table proj_plan_current');
  }
}
