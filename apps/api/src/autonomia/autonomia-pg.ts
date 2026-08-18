/**
 * apps/api · V2-C · Persistencia PostgreSQL del SHADOW MODE. Tenant-scoped, `autonomia_shadow_run`.
 * Registro append-only de qué HABRÍA hecho el ciclo autónomo, por qué, cuánto habría comprometido (0 real) y
 * la evidencia. No compromete gasto real ni escribe a Meta: es observabilidad de la autonomía en sombra.
 */
import type { Pool } from 'pg';
import type { Migration } from '@soec/event-store/pg';
import type { ShadowRun, ShadowRunRepo } from './autonomous-loop';

export const autonomiaMigrations: ReadonlyArray<Migration> = [
  {
    id: '0001_autonomia_shadow_init',
    sql: `
      create table if not exists autonomia_shadow_run (
        id               text primary key,
        organization_id  text not null,
        mandato_id       text not null,
        ran_at           timestamptz not null,
        modo             text not null,
        meta_write_calls int not null default 0,
        gasto_real_minor bigint not null default 0,
        payload          jsonb not null,
        created_at       timestamptz not null default now()
      );
      create index if not exists autonomia_shadow_run_idx on autonomia_shadow_run (organization_id, mandato_id, ran_at desc);
    `,
  },
];

export class PgShadowRunRepo implements ShadowRunRepo {
  constructor(private readonly pool: Pool, private readonly nuevoId: () => string) {}
  async guardar(run: ShadowRun): Promise<void> {
    await this.pool.query(
      `insert into autonomia_shadow_run (id, organization_id, mandato_id, ran_at, modo, meta_write_calls, gasto_real_minor, payload)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [this.nuevoId(), run.organizationId, run.mandatoId, run.ranAt, run.modo, run.metaWriteCallsReales, run.gastoRealComprometidoMinor, JSON.stringify(run)],
    );
  }
  async ultimos(org: string, mandatoId: string, limite = 20): Promise<readonly ShadowRun[]> {
    const r = await this.pool.query('select payload from autonomia_shadow_run where organization_id=$1 and mandato_id=$2 order by ran_at desc limit $3', [org, mandatoId, limite]);
    return r.rows.map((x) => (x as { payload: ShadowRun }).payload);
  }
}
