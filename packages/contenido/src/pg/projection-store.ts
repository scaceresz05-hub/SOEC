import type { Pool } from 'pg';
import type { BriefState } from '../domain/brief';
import type { PaqueteState } from '../domain/paquete';
import type {
  BriefProjectionStore,
  BriefSnapshot,
  PaqueteProjectionStore,
  PaqueteSnapshot,
} from '../projections/projection';

interface BriefRow {
  version: number;
  state: BriefState;
}
interface PaqueteRow {
  version: number;
  state: PaqueteState;
}

export class PgBriefProjectionStore implements BriefProjectionStore {
  constructor(private readonly pool: Pool) {}
  async get(org: string, id: string): Promise<BriefSnapshot | null> {
    const { rows } = await this.pool.query<BriefRow>(`select version, state from proj_brief_current where organization_id = $1 and brief_id = $2`, [org, id]);
    const r = rows[0];
    return r ? { version: r.version, state: r.state } : null;
  }
  async save(org: string, id: string, snap: BriefSnapshot): Promise<void> {
    const s = snap.state;
    await this.pool.query(
      `insert into proj_brief_current (organization_id, brief_id, version, estado, actividad_ref, state, updated_at)
       values ($1,$2,$3,$4,$5,$6::jsonb, now())
       on conflict (organization_id, brief_id) do update set version = excluded.version, estado = excluded.estado, actividad_ref = excluded.actividad_ref, state = excluded.state, updated_at = now()`,
      [org, id, snap.version, s.estado, s.contenido?.actividadId ?? null, JSON.stringify(s)],
    );
  }
  async list(org: string): Promise<readonly BriefState[]> {
    const { rows } = await this.pool.query<BriefRow>(`select version, state from proj_brief_current where organization_id = $1 order by brief_id`, [org]);
    return rows.map((r) => r.state);
  }
  async deleteAll(): Promise<void> {
    await this.pool.query('truncate table proj_brief_current');
  }
}

export class PgPaqueteProjectionStore implements PaqueteProjectionStore {
  constructor(private readonly pool: Pool) {}
  async get(org: string, id: string): Promise<PaqueteSnapshot | null> {
    const { rows } = await this.pool.query<PaqueteRow>(`select version, state from proj_paquete_current where organization_id = $1 and paquete_id = $2`, [org, id]);
    const r = rows[0];
    return r ? { version: r.version, state: r.state } : null;
  }
  async save(org: string, id: string, snap: PaqueteSnapshot): Promise<void> {
    const s = snap.state;
    await this.pool.query(
      `insert into proj_paquete_current (organization_id, paquete_id, version, estado, resultado, canal, plan_ref, actividad_ref, state, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb, now())
       on conflict (organization_id, paquete_id) do update set version = excluded.version, estado = excluded.estado, resultado = excluded.resultado, canal = excluded.canal, plan_ref = excluded.plan_ref, actividad_ref = excluded.actividad_ref, state = excluded.state, updated_at = now()`,
      [org, id, snap.version, s.estado, s.resultadoProduccion, s.canal || null, s.planRef || null, s.actividadRef || null, JSON.stringify(s)],
    );
  }
  async list(org: string): Promise<readonly PaqueteState[]> {
    const { rows } = await this.pool.query<PaqueteRow>(`select version, state from proj_paquete_current where organization_id = $1 order by paquete_id`, [org]);
    return rows.map((r) => r.state);
  }
  async deleteAll(): Promise<void> {
    await this.pool.query('truncate table proj_paquete_current');
  }
}
