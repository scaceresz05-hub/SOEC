import type { Pool } from 'pg';
import type { DecisionState } from '../domain/decision';
import type { DecisionProjectionStore, Snap } from '../projections/projection';

export class PgDecisionProjectionStore implements DecisionProjectionStore {
  constructor(private readonly pool: Pool) {}

  async get(org: string, departamentoId: string): Promise<Snap<DecisionState> | null> {
    const { rows } = await this.pool.query<{ version: number; state: DecisionState }>(
      `select version, state from proj_objetivo_decision_current where organization_id = $1 and departamento_id = $2`,
      [org, departamentoId],
    );
    return rows[0] ? { version: rows[0].version, state: rows[0].state } : null;
  }

  async save(org: string, departamentoId: string, s: Snap<DecisionState>): Promise<void> {
    await this.pool.query(
      `insert into proj_objetivo_decision_current (organization_id, departamento_id, version, tiene_vigente, objetivo_vigente, state, updated_at)
       values ($1,$2,$3,$4,$5,$6::jsonb, now())
       on conflict (organization_id, departamento_id) do update set version = excluded.version, tiene_vigente = excluded.tiene_vigente, objetivo_vigente = excluded.objetivo_vigente, state = excluded.state, updated_at = now()`,
      [
        org,
        departamentoId,
        s.version,
        s.state.vigente !== null,
        s.state.vigente?.candidato.objetivoId ?? null,
        JSON.stringify(s.state),
      ],
    );
  }

  async list(org: string): Promise<readonly DecisionState[]> {
    const { rows } = await this.pool.query<{ state: DecisionState }>(
      `select state from proj_objetivo_decision_current where organization_id = $1 order by departamento_id`,
      [org],
    );
    return rows.map((r) => r.state);
  }

  async deleteAll(): Promise<void> {
    await this.pool.query('truncate table proj_objetivo_decision_current');
  }
}
