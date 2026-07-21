import type { Migration } from '@soec/event-store/pg';

/** Proyecciones de políticas y acciones operativas (auditoría del departamento autónomo). */
export const operacionalMigrations: ReadonlyArray<Migration> = [
  {
    id: '0006_operacional_projection',
    sql: `
      create table if not exists proj_policy_current (
        organization_id text not null,
        policy_id text not null,
        version integer not null,
        estado text,
        vigente integer,
        state jsonb not null,
        updated_at timestamptz(3) not null default now(),
        primary key (organization_id, policy_id)
      );

      create table if not exists proj_accion_current (
        organization_id text not null,
        execution_id text not null,
        version integer not null,
        policy_id text,
        estado text,
        canal text,
        costo_consumido numeric,
        state jsonb not null,
        updated_at timestamptz(3) not null default now(),
        primary key (organization_id, execution_id)
      );
      create index if not exists proj_accion_pol on proj_accion_current (organization_id, policy_id);
      create index if not exists proj_accion_estado on proj_accion_current (organization_id, estado);
    `,
  },
];
