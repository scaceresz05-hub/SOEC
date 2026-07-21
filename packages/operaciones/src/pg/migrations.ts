import type { Migration } from '@soec/event-store/pg';
import { migracionesHastaEce } from '@soec/ece/pg';

/** Proyección de ejecuciones de operaciones intelectuales (tabla propia del dominio). */
export const oiMigrations: ReadonlyArray<Migration> = [
  {
    id: '0004_oi_projection',
    sql: `
      create table if not exists proj_oi_current (
        organization_id text not null,
        execution_id text not null,
        version integer not null,
        operacion text,
        ece_id text,
        estado text,
        abstenido boolean,
        mecanismo text,
        state jsonb not null,
        updated_at timestamptz(3) not null default now(),
        primary key (organization_id, execution_id)
      );
      create index if not exists proj_oi_op on proj_oi_current (organization_id, operacion);
      create index if not exists proj_oi_ece on proj_oi_current (organization_id, ece_id);
    `,
  },
];

/** Conjunto acumulado hasta las Operaciones (Base + Modelos + ECE + Operaciones). */
export const migracionesHastaOperaciones: ReadonlyArray<Migration> = [...migracionesHastaEce, ...oiMigrations];
