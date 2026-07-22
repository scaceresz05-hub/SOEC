import type { Pool } from 'pg';
import type { PublicationState } from '../domain/publication';
import type { PublicationProjectionStore, PublicationSnapshot } from '../projections/projection';

interface Row {
  version: number;
  state: PublicationState;
}

export class PgPublicationProjectionStore implements PublicationProjectionStore {
  constructor(private readonly pool: Pool) {}
  async get(org: string, id: string): Promise<PublicationSnapshot | null> {
    const { rows } = await this.pool.query<Row>(`select version, state from proj_publicacion_current where organization_id = $1 and publication_id = $2`, [org, id]);
    const r = rows[0];
    return r ? { version: r.version, state: r.state } : null;
  }
  async save(org: string, id: string, snap: PublicationSnapshot): Promise<void> {
    const s = snap.state;
    await this.pool.query(
      `insert into proj_publicacion_current (organization_id, publication_id, version, estado, modo, canal, paquete_ref, external_ref, state, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb, now())
       on conflict (organization_id, publication_id) do update set version = excluded.version, estado = excluded.estado, modo = excluded.modo, canal = excluded.canal, paquete_ref = excluded.paquete_ref, external_ref = excluded.external_ref, state = excluded.state, updated_at = now()`,
      [org, id, snap.version, s.estado, s.modo || null, s.canal || null, s.paqueteRef || null, s.externalRef, JSON.stringify(s)],
    );
  }
  async list(org: string): Promise<readonly PublicationState[]> {
    const { rows } = await this.pool.query<Row>(`select version, state from proj_publicacion_current where organization_id = $1 order by publication_id`, [org]);
    return rows.map((r) => r.state);
  }
  async deleteAll(): Promise<void> {
    await this.pool.query('truncate table proj_publicacion_current');
  }
}
