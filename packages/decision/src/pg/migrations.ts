import type { Migration } from '@soec/event-store/pg';

/** Proyección de decisión institucional (vigente + historial) por Org + Departamento. */
export const decisionMigrations: ReadonlyArray<Migration> = [
  {
    id: '0013_objetivo_decision',
    sql: `
      create table if not exists proj_objetivo_decision_current (
        organization_id text not null,
        departamento_id text not null,
        version integer not null,
        tiene_vigente boolean not null default false,
        objetivo_vigente text,
        state jsonb not null,
        updated_at timestamptz(3) not null default now(),
        primary key (organization_id, departamento_id)
      );
    `,
  },
];
