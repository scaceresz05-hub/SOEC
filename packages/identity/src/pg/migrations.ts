/**
 * @soec/identity · migraciones PostgreSQL del plano de identidad. Se añaden al `migrate-cli` de la
 * cadena. Nunca se modifica una migración aplicada; se agregan nuevas. Tablas prefijadas
 * `identity_*` para no colisionar con el event-store.
 */
export interface Migration {
  readonly id: string;
  readonly sql: string;
}

export const identityMigrations: ReadonlyArray<Migration> = [
  {
    id: '0001_identity_init',
    sql: `
      create table if not exists identity_users (
        id uuid primary key,
        email text not null unique,
        display_name text not null,
        password_hash text not null,
        status text not null default 'ACTIVE',
        email_verified_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );

      create table if not exists identity_organizations (
        id uuid primary key,
        slug text not null unique,
        name text not null,
        status text not null default 'ACTIVE',
        operational_mode text not null default 'PILOT',
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );

      create table if not exists identity_memberships (
        id uuid primary key,
        user_id uuid not null references identity_users(id) on delete cascade,
        organization_id uuid not null references identity_organizations(id) on delete cascade,
        role text not null,
        status text not null default 'ACTIVE',
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique (user_id, organization_id)
      );
      create index if not exists idx_identity_memberships_user on identity_memberships(user_id);
      create index if not exists idx_identity_memberships_org on identity_memberships(organization_id);

      create table if not exists identity_sessions (
        id uuid primary key,
        user_id uuid not null references identity_users(id) on delete cascade,
        token_hash text not null unique,
        expires_at timestamptz not null,
        revoked_at timestamptz,
        created_at timestamptz not null default now(),
        last_seen_at timestamptz not null default now()
      );
      create index if not exists idx_identity_sessions_user on identity_sessions(user_id);

      create table if not exists identity_invitations (
        id uuid primary key,
        organization_id uuid not null references identity_organizations(id) on delete cascade,
        email text not null,
        role text not null,
        token_hash text not null unique,
        expires_at timestamptz not null,
        accepted_at timestamptz,
        revoked_at timestamptz,
        invited_by uuid not null references identity_users(id),
        created_at timestamptz not null default now()
      );
      create index if not exists idx_identity_invitations_org on identity_invitations(organization_id);

      create table if not exists identity_audit_events (
        id uuid primary key,
        organization_id uuid,
        actor_user_id uuid,
        action text not null,
        resource_type text,
        resource_id text,
        result text not null,
        metadata jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now()
      );
      create index if not exists idx_identity_audit_org on identity_audit_events(organization_id, created_at desc);
    `,
  },
];
