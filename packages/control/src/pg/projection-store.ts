import type { Pool } from 'pg';
import type { DecisionState } from '../domain/decision';
import type { InboxState } from '../domain/inbox';
import { pausaTotalActiva, type PausaState } from '../domain/pausa';
import type { DecisionProjectionStore, InboxProjectionStore, PausaProjectionStore, Snapshot } from '../projections/projection';

export class PgPausaProjectionStore implements PausaProjectionStore {
  constructor(private readonly pool: Pool) {}
  async get(org: string): Promise<Snapshot<PausaState> | null> {
    const { rows } = await this.pool.query<{ version: number; state: PausaState }>(`select version, state from proj_pausa_current where organization_id = $1`, [org]);
    return rows[0] ? { version: rows[0].version, state: rows[0].state } : null;
  }
  async save(org: string, snap: Snapshot<PausaState>): Promise<void> {
    await this.pool.query(
      `insert into proj_pausa_current (organization_id, version, pausa_total, state, updated_at) values ($1,$2,$3,$4::jsonb, now())
       on conflict (organization_id) do update set version = excluded.version, pausa_total = excluded.pausa_total, state = excluded.state, updated_at = now()`,
      [org, snap.version, pausaTotalActiva(snap.state), JSON.stringify(snap.state)],
    );
  }
  async deleteAll(): Promise<void> {
    await this.pool.query('truncate table proj_pausa_current');
  }
}

export class PgDecisionProjectionStore implements DecisionProjectionStore {
  constructor(private readonly pool: Pool) {}
  async get(org: string, id: string): Promise<Snapshot<DecisionState> | null> {
    const { rows } = await this.pool.query<{ version: number; state: DecisionState }>(`select version, state from proj_decision_current where organization_id = $1 and dec_id = $2`, [org, id]);
    return rows[0] ? { version: rows[0].version, state: rows[0].state } : null;
  }
  async save(org: string, id: string, snap: Snapshot<DecisionState>): Promise<void> {
    const s = snap.state;
    await this.pool.query(
      `insert into proj_decision_current (organization_id, dec_id, version, estado, tipo, riesgo, state, updated_at) values ($1,$2,$3,$4,$5,$6,$7::jsonb, now())
       on conflict (organization_id, dec_id) do update set version = excluded.version, estado = excluded.estado, tipo = excluded.tipo, riesgo = excluded.riesgo, state = excluded.state, updated_at = now()`,
      [org, id, snap.version, s.estado, s.contenido?.tipo ?? null, s.contenido?.riesgo ?? null, JSON.stringify(s)],
    );
  }
  async list(org: string): Promise<readonly DecisionState[]> {
    const { rows } = await this.pool.query<{ state: DecisionState }>(`select state from proj_decision_current where organization_id = $1 order by dec_id`, [org]);
    return rows.map((r) => r.state);
  }
  async deleteAll(): Promise<void> {
    await this.pool.query('truncate table proj_decision_current');
  }
}

export class PgInboxProjectionStore implements InboxProjectionStore {
  constructor(private readonly pool: Pool) {}
  async get(org: string): Promise<Snapshot<InboxState> | null> {
    const { rows } = await this.pool.query<{ version: number; state: InboxState }>(`select version, state from proj_inbox_current where organization_id = $1`, [org]);
    return rows[0] ? { version: rows[0].version, state: rows[0].state } : null;
  }
  async save(org: string, snap: Snapshot<InboxState>): Promise<void> {
    await this.pool.query(
      `insert into proj_inbox_current (organization_id, version, state, updated_at) values ($1,$2,$3::jsonb, now())
       on conflict (organization_id) do update set version = excluded.version, state = excluded.state, updated_at = now()`,
      [org, snap.version, JSON.stringify(snap.state)],
    );
  }
  async deleteAll(): Promise<void> {
    await this.pool.query('truncate table proj_inbox_current');
  }
}
