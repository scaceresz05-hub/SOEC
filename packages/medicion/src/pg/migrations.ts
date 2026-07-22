import type { Migration } from '@soec/event-store/pg';

/** Proyecciones de medición (por publicación) y de decisiones de optimización. */
export const medicionMigrations: ReadonlyArray<Migration> = [
  {
    id: '0010_medicion_projection',
    sql: `
      create table if not exists proj_medicion_current (
        organization_id text not null,
        publication_id text not null,
        version integer not null,
        campania_ref text,
        objetivo_ref text,
        calidad text,
        clasificacion text,
        state jsonb not null,
        updated_at timestamptz(3) not null default now(),
        primary key (organization_id, publication_id)
      );
      create index if not exists proj_medicion_campania on proj_medicion_current (organization_id, campania_ref);

      create table if not exists proj_optimizacion_current (
        organization_id text not null,
        opt_id text not null,
        version integer not null,
        estado text,
        tipo text,
        state jsonb not null,
        updated_at timestamptz(3) not null default now(),
        primary key (organization_id, opt_id)
      );
      create index if not exists proj_optimizacion_estado on proj_optimizacion_current (organization_id, estado);
    `,
  },
];
