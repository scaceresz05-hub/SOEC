import type { Migration } from '@soec/event-store/pg';

/** Proyecciones de capacidades: definiciones y ejecuciones (tablas propias del dominio). */
export const capMigrations: ReadonlyArray<Migration> = [
  {
    id: '0005_cap_projection',
    sql: `
      create table if not exists proj_capdef_current (
        organization_id text not null,
        capability_id text not null,
        version integer not null,
        vigente integer,
        state jsonb not null,
        updated_at timestamptz(3) not null default now(),
        primary key (organization_id, capability_id)
      );

      create table if not exists proj_capexec_current (
        organization_id text not null,
        execution_id text not null,
        version integer not null,
        capability_id text,
        estado text,
        abstenido boolean,
        state jsonb not null,
        updated_at timestamptz(3) not null default now(),
        primary key (organization_id, execution_id)
      );
      create index if not exists proj_capexec_cap on proj_capexec_current (organization_id, capability_id);
    `,
  },
];
