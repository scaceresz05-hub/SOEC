import type { Migration } from '@soec/event-store/pg';

/** Proyección de publicaciones del plano de canales. */
export const canalesMigrations: ReadonlyArray<Migration> = [
  {
    id: '0009_canales_projection',
    sql: `
      create table if not exists proj_publicacion_current (
        organization_id text not null,
        publication_id text not null,
        version integer not null,
        estado text,
        modo text,
        canal text,
        paquete_ref text,
        external_ref text,
        state jsonb not null,
        updated_at timestamptz(3) not null default now(),
        primary key (organization_id, publication_id)
      );
      create index if not exists proj_pub_paquete on proj_publicacion_current (organization_id, paquete_ref);
      create index if not exists proj_pub_external on proj_publicacion_current (organization_id, external_ref);
      create index if not exists proj_pub_estado on proj_publicacion_current (organization_id, estado);
    `,
  },
];
