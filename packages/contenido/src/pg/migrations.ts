import type { Migration } from '@soec/event-store/pg';

/** Proyecciones de briefs y paquetes publicables de la fábrica de contenido. */
export const contenidoMigrations: ReadonlyArray<Migration> = [
  {
    id: '0008_contenido_projection',
    sql: `
      create table if not exists proj_brief_current (
        organization_id text not null,
        brief_id text not null,
        version integer not null,
        estado text,
        actividad_ref text,
        state jsonb not null,
        updated_at timestamptz(3) not null default now(),
        primary key (organization_id, brief_id)
      );

      create table if not exists proj_paquete_current (
        organization_id text not null,
        paquete_id text not null,
        version integer not null,
        estado text,
        resultado text,
        canal text,
        plan_ref text,
        actividad_ref text,
        state jsonb not null,
        updated_at timestamptz(3) not null default now(),
        primary key (organization_id, paquete_id)
      );
      create index if not exists proj_paquete_actividad on proj_paquete_current (organization_id, actividad_ref);
      create index if not exists proj_paquete_estado on proj_paquete_current (organization_id, estado);
    `,
  },
];
