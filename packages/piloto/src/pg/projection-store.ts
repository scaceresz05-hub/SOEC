import type { Pool } from 'pg';
import type { EnsayoState } from '../domain/ensayo';
import type { ExpedienteState } from '../domain/expediente';
import type { OrgState } from '../domain/organizacion';
import type { EnsProjectionStore, ExpProjectionStore, OrgProjectionStore, Snap } from '../projections/projection';

export class PgOrgProjectionStore implements OrgProjectionStore {
  constructor(private readonly pool: Pool) {}
  async get(org: string, id: string): Promise<Snap<OrgState> | null> {
    const { rows } = await this.pool.query<{ version: number; state: OrgState }>(`select version, state from proj_org_current where organization_id = $1 and org_id = $2`, [org, id]);
    return rows[0] ? { version: rows[0].version, state: rows[0].state } : null;
  }
  async save(org: string, id: string, s: Snap<OrgState>): Promise<void> {
    await this.pool.query(
      `insert into proj_org_current (organization_id, org_id, version, estado, departamento_piloto, state, updated_at) values ($1,$2,$3,$4,$5,$6::jsonb, now())
       on conflict (organization_id, org_id) do update set version = excluded.version, estado = excluded.estado, departamento_piloto = excluded.departamento_piloto, state = excluded.state, updated_at = now()`,
      [org, id, s.version, s.state.estado, s.state.perfil?.departamentoPiloto ?? null, JSON.stringify(s.state)],
    );
  }
  async list(org: string): Promise<readonly OrgState[]> {
    const { rows } = await this.pool.query<{ state: OrgState }>(`select state from proj_org_current where organization_id = $1 order by org_id`, [org]);
    return rows.map((r) => r.state);
  }
  async deleteAll(): Promise<void> {
    await this.pool.query('truncate table proj_org_current');
  }
}

export class PgExpProjectionStore implements ExpProjectionStore {
  constructor(private readonly pool: Pool) {}
  async get(org: string, id: string): Promise<Snap<ExpedienteState> | null> {
    const { rows } = await this.pool.query<{ version: number; state: ExpedienteState }>(`select version, state from proj_expediente_current where organization_id = $1 and exp_id = $2`, [org, id]);
    return rows[0] ? { version: rows[0].version, state: rows[0].state } : null;
  }
  async save(org: string, id: string, s: Snap<ExpedienteState>): Promise<void> {
    await this.pool.query(
      `insert into proj_expediente_current (organization_id, exp_id, version, estado, entorno, readiness, org_ref, state, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb, now())
       on conflict (organization_id, exp_id) do update set version = excluded.version, estado = excluded.estado, entorno = excluded.entorno, readiness = excluded.readiness, org_ref = excluded.org_ref, state = excluded.state, updated_at = now()`,
      [org, id, s.version, s.state.estado, s.state.entorno, s.state.readiness, s.state.orgRef || null, JSON.stringify(s.state)],
    );
  }
  async list(org: string): Promise<readonly ExpedienteState[]> {
    const { rows } = await this.pool.query<{ state: ExpedienteState }>(`select state from proj_expediente_current where organization_id = $1 order by exp_id`, [org]);
    return rows.map((r) => r.state);
  }
  async deleteAll(): Promise<void> {
    await this.pool.query('truncate table proj_expediente_current');
  }
}

export class PgEnsProjectionStore implements EnsProjectionStore {
  constructor(private readonly pool: Pool) {}
  async get(org: string, id: string): Promise<Snap<EnsayoState> | null> {
    const { rows } = await this.pool.query<{ version: number; state: EnsayoState }>(`select version, state from proj_ensayo_current where organization_id = $1 and ens_id = $2`, [org, id]);
    return rows[0] ? { version: rows[0].version, state: rows[0].state } : null;
  }
  async save(org: string, id: string, s: Snap<EnsayoState>): Promise<void> {
    await this.pool.query(
      `insert into proj_ensayo_current (organization_id, ens_id, version, escenario, resultado, org_ref, state, updated_at) values ($1,$2,$3,$4,$5,$6,$7::jsonb, now())
       on conflict (organization_id, ens_id) do update set version = excluded.version, escenario = excluded.escenario, resultado = excluded.resultado, org_ref = excluded.org_ref, state = excluded.state, updated_at = now()`,
      [org, id, s.version, s.state.escenario, s.state.resultado, s.state.orgRef || null, JSON.stringify(s.state)],
    );
  }
  async list(org: string): Promise<readonly EnsayoState[]> {
    const { rows } = await this.pool.query<{ state: EnsayoState }>(`select state from proj_ensayo_current where organization_id = $1 order by ens_id`, [org]);
    return rows.map((r) => r.state);
  }
  async deleteAll(): Promise<void> {
    await this.pool.query('truncate table proj_ensayo_current');
  }
}
