import type { Pool } from 'pg';
import type { EceState } from '../domain/ece';
import type { EceAfectado, EceProjectionStore, EceSnapshot } from '../projections/projection';

interface ProjRow {
  version: number;
  state: EceState;
}
interface AfectadoRow {
  ece_id: string;
  corte: number;
}

/** Proyección del ECE respaldada por PostgreSQL. */
export class PgEceProjectionStore implements EceProjectionStore {
  constructor(private readonly pool: Pool) {}

  async get(org: string, eceId: string): Promise<EceSnapshot | null> {
    const { rows } = await this.pool.query<ProjRow>(
      `select version, state from proj_ece_current where organization_id = $1 and ece_id = $2`,
      [org, eceId],
    );
    const row = rows[0];
    return row ? { version: row.version, state: row.state } : null;
  }

  async save(org: string, eceId: string, snapshot: EceSnapshot): Promise<void> {
    const s = snapshot.state;
    await this.pool.query(
      `insert into proj_ece_current
         (organization_id, ece_id, version, state, med_instance_id, med_corte,
          mdm_instance_id, mdm_corte, vigente, requiere_reconstruccion, updated_at)
       values ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10, now())
       on conflict (organization_id, ece_id) do update set
         version = excluded.version, state = excluded.state,
         med_instance_id = excluded.med_instance_id, med_corte = excluded.med_corte,
         mdm_instance_id = excluded.mdm_instance_id, mdm_corte = excluded.mdm_corte,
         vigente = excluded.vigente, requiere_reconstruccion = excluded.requiere_reconstruccion,
         updated_at = now()`,
      [
        org,
        eceId,
        snapshot.version,
        JSON.stringify(s),
        s.medCorte?.instanceId ?? null,
        s.medCorte?.version ?? null,
        s.mdmCorte?.instanceId ?? null,
        s.mdmCorte?.version ?? null,
        s.vigente,
        s.requiereReconstruccion,
      ],
    );
  }

  async list(org: string): Promise<readonly EceState[]> {
    const { rows } = await this.pool.query<ProjRow>(
      `select version, state from proj_ece_current where organization_id = $1 order by ece_id`,
      [org],
    );
    return rows.map((r) => r.state);
  }

  async afectadosPorModelo(
    org: string,
    modelo: 'MED' | 'MDM',
    instanceId: string,
    sequence: number,
  ): Promise<readonly EceAfectado[]> {
    const col = modelo === 'MED' ? ['med_instance_id', 'med_corte'] : ['mdm_instance_id', 'mdm_corte'];
    const { rows } = await this.pool.query<AfectadoRow>(
      `select ece_id, ${col[1]} as corte from proj_ece_current
        where organization_id = $1 and ${col[0]} = $2 and ${col[1]} < $3
          and vigente = true and requiere_reconstruccion = false`,
      [org, instanceId, sequence],
    );
    return rows.map((r) => ({ eceId: r.ece_id, corteVersion: r.corte }));
  }

  async deleteAll(): Promise<void> {
    await this.pool.query('truncate table proj_ece_current');
  }
}
