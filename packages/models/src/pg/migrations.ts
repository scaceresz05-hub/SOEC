import type { Migration } from '@soec/event-store/pg';

/**
 * Migraciones propias del dominio de Modelos: proyecciones actuales de MED y MDM.
 * Tablas SEPARADAS por modelo → la frontera MED ╪ MDM es también física (§8).
 * No viven en la infraestructura común: el event store solo aporta el mecanismo.
 */
export const modelMigrations: ReadonlyArray<Migration> = [
  {
    id: '0002_model_projections',
    sql: `
      create table if not exists proj_med_current (
        organization_id text not null,
        instance_id text not null,
        version integer not null,
        state jsonb not null,
        updated_at timestamptz(3) not null default now(),
        primary key (organization_id, instance_id)
      );

      create table if not exists proj_mdm_current (
        organization_id text not null,
        instance_id text not null,
        version integer not null,
        state jsonb not null,
        updated_at timestamptz(3) not null default now(),
        primary key (organization_id, instance_id)
      );
    `,
  },
];
