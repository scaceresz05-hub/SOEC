import type { Migration } from '@soec/event-store/pg';

/** Proyecciones de objetivos y planes de marketing. */
export const marketingMigrations: ReadonlyArray<Migration> = [
  {
    id: '0007_marketing_projection',
    sql: `
      create table if not exists proj_objetivo_current (
        organization_id text not null,
        objetivo_id text not null,
        version integer not null,
        evaluable boolean,
        state jsonb not null,
        updated_at timestamptz(3) not null default now(),
        primary key (organization_id, objetivo_id)
      );

      create table if not exists proj_plan_current (
        organization_id text not null,
        plan_id text not null,
        version integer not null,
        plan_version integer,
        estado text,
        objetivo_ref text,
        policy_id text,
        state jsonb not null,
        updated_at timestamptz(3) not null default now(),
        primary key (organization_id, plan_id)
      );
      create index if not exists proj_plan_obj on proj_plan_current (organization_id, objetivo_ref);
    `,
  },
];
