import type { Pool } from 'pg';
import type { MedState } from '../domain/med';
import type { OptimizacionState } from '../domain/optimization';
import type { MedProjectionStore, MedSnapshot, OptProjectionStore, OptSnapshot } from '../projections/projection';

interface MedRow {
  version: number;
  state: MedState;
}
interface OptRow {
  version: number;
  state: OptimizacionState;
}

export class PgMedProjectionStore implements MedProjectionStore {
  constructor(private readonly pool: Pool) {}
  async get(org: string, id: string): Promise<MedSnapshot | null> {
    const { rows } = await this.pool.query<MedRow>(`select version, state from proj_medicion_current where organization_id = $1 and publication_id = $2`, [org, id]);
    const r = rows[0];
    return r ? { version: r.version, state: r.state } : null;
  }
  async save(org: string, id: string, snap: MedSnapshot): Promise<void> {
    const s = snap.state;
    await this.pool.query(
      `insert into proj_medicion_current (organization_id, publication_id, version, campania_ref, objetivo_ref, calidad, clasificacion, state, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb, now())
       on conflict (organization_id, publication_id) do update set version = excluded.version, campania_ref = excluded.campania_ref, objetivo_ref = excluded.objetivo_ref, calidad = excluded.calidad, clasificacion = excluded.clasificacion, state = excluded.state, updated_at = now()`,
      [org, id, snap.version, s.campaniaRef || null, s.objetivoRef || null, s.calidad, s.evaluacion?.clasificacion ?? null, JSON.stringify(s)],
    );
  }
  async list(org: string): Promise<readonly MedState[]> {
    const { rows } = await this.pool.query<MedRow>(`select version, state from proj_medicion_current where organization_id = $1 order by publication_id`, [org]);
    return rows.map((r) => r.state);
  }
  async deleteAll(): Promise<void> {
    await this.pool.query('truncate table proj_medicion_current');
  }
}

export class PgOptProjectionStore implements OptProjectionStore {
  constructor(private readonly pool: Pool) {}
  async get(org: string, id: string): Promise<OptSnapshot | null> {
    const { rows } = await this.pool.query<OptRow>(`select version, state from proj_optimizacion_current where organization_id = $1 and opt_id = $2`, [org, id]);
    const r = rows[0];
    return r ? { version: r.version, state: r.state } : null;
  }
  async save(org: string, id: string, snap: OptSnapshot): Promise<void> {
    const s = snap.state;
    await this.pool.query(
      `insert into proj_optimizacion_current (organization_id, opt_id, version, estado, tipo, state, updated_at)
       values ($1,$2,$3,$4,$5,$6::jsonb, now())
       on conflict (organization_id, opt_id) do update set version = excluded.version, estado = excluded.estado, tipo = excluded.tipo, state = excluded.state, updated_at = now()`,
      [org, id, snap.version, s.estado, s.decision?.tipo ?? null, JSON.stringify(s)],
    );
  }
  async list(org: string): Promise<readonly OptimizacionState[]> {
    const { rows } = await this.pool.query<OptRow>(`select version, state from proj_optimizacion_current where organization_id = $1 order by opt_id`, [org]);
    return rows.map((r) => r.state);
  }
  async deleteAll(): Promise<void> {
    await this.pool.query('truncate table proj_optimizacion_current');
  }
}
