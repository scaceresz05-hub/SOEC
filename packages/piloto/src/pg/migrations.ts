import type { Migration } from '@soec/event-store/pg';

/** Proyecciones de preparación de piloto: organización, expediente y ensayos. */
export const pilotoMigrations: ReadonlyArray<Migration> = [
  {
    id: '0012_piloto_projection',
    sql: `
      create table if not exists proj_org_current (
        organization_id text not null,
        org_id text not null,
        version integer not null,
        estado text,
        departamento_piloto text,
        state jsonb not null,
        updated_at timestamptz(3) not null default now(),
        primary key (organization_id, org_id)
      );

      create table if not exists proj_expediente_current (
        organization_id text not null,
        exp_id text not null,
        version integer not null,
        estado text,
        entorno text,
        readiness text,
        org_ref text,
        state jsonb not null,
        updated_at timestamptz(3) not null default now(),
        primary key (organization_id, exp_id)
      );
      create index if not exists proj_expediente_org on proj_expediente_current (organization_id, org_ref);

      create table if not exists proj_ensayo_current (
        organization_id text not null,
        ens_id text not null,
        version integer not null,
        escenario text,
        resultado text,
        org_ref text,
        state jsonb not null,
        updated_at timestamptz(3) not null default now(),
        primary key (organization_id, ens_id)
      );
      create index if not exists proj_ensayo_org on proj_ensayo_current (organization_id, org_ref);
    `,
  },
];
