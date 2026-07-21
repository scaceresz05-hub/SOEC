import { type Migration, migrations as baseMigrations } from '@soec/event-store/pg';
import { modelMigrations } from '@soec/models/pg';

/**
 * Migración propia del dominio del ECE: proyección actual.
 * Tabla separada de MED y MDM (el ECE no fusiona los planos, #12).
 * Las columnas de corte permiten detectar invalidación por cambios en MED/MDM.
 */
export const eceMigrations: ReadonlyArray<Migration> = [
  {
    id: '0003_ece_projection',
    sql: `
      create table if not exists proj_ece_current (
        organization_id text not null,
        ece_id text not null,
        version integer not null,
        state jsonb not null,
        med_instance_id text,
        med_corte integer,
        mdm_instance_id text,
        mdm_corte integer,
        vigente boolean not null default true,
        requiere_reconstruccion boolean not null default false,
        updated_at timestamptz(3) not null default now(),
        primary key (organization_id, ece_id)
      );
      create index if not exists proj_ece_med on proj_ece_current (organization_id, med_instance_id);
      create index if not exists proj_ece_mdm on proj_ece_current (organization_id, mdm_instance_id);
    `,
  },
];

/** Conjunto acumulado hasta el ECE (Base Técnica + Modelos + ECE), para componer capas superiores. */
export const migracionesHastaEce: ReadonlyArray<Migration> = [
  ...baseMigrations,
  ...modelMigrations,
  ...eceMigrations,
];
