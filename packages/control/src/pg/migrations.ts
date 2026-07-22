import type { Migration } from '@soec/event-store/pg';

/** Proyecciones del Centro de Control: pausa, decisiones y buzón (alertas/notificaciones). */
export const controlMigrations: ReadonlyArray<Migration> = [
  {
    id: '0011_control_projection',
    sql: `
      create table if not exists proj_pausa_current (
        organization_id text not null primary key,
        version integer not null,
        pausa_total boolean not null default false,
        state jsonb not null,
        updated_at timestamptz(3) not null default now()
      );

      create table if not exists proj_decision_current (
        organization_id text not null,
        dec_id text not null,
        version integer not null,
        estado text,
        tipo text,
        riesgo text,
        state jsonb not null,
        updated_at timestamptz(3) not null default now(),
        primary key (organization_id, dec_id)
      );
      create index if not exists proj_decision_estado on proj_decision_current (organization_id, estado);

      create table if not exists proj_inbox_current (
        organization_id text not null primary key,
        version integer not null,
        state jsonb not null,
        updated_at timestamptz(3) not null default now()
      );
    `,
  },
];
