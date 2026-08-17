/**
 * apps/api · Persistencia PostgreSQL del flujo OAuth de Meta (Parte 2). Adapters productivos de los cuatro
 * stores in-memory, tenant-scoped, reusando el `pg.Pool` y el patrón de migraciones del repo.
 *
 * NUNCA se persiste: token plaintext, refresh token, authorization code, app secret, ni raw Graph payload.
 * Sólo: state anti-CSRF (one-time), metadata de credencial con `secretRef` OPACO, máquina de estados de
 * conexión, y el envelope cifrado (iv/tag/ciphertext/wrappedDataKey) — jamás la data key en claro.
 *
 * Consumo de state ATÓMICO: `UPDATE … WHERE consumido_en IS NULL RETURNING` ⇒ con dos callbacks concurrentes
 * exactamente uno gana. La org autoritativa vive en la fila del state; el callback no puede reemplazarla.
 */

import type { Pool } from 'pg';
import type { Migration } from '@soec/event-store/pg';
import type { EstadoOAuth, CandidatoActivo } from './meta-oauth';
import type { CredencialMetaRef, ConexionMeta, EstadoConexionMeta, SaludConexionMeta, EstadoCredencial, TipoTokenMeta, BindingMeta } from './meta-onboarding';
import type { OAuthStateStore, ResultadoConsumo, CredentialRepo, ConnectionRepo, RegistroConexionMeta } from './meta-oauth-flow';
import type { CiphertextStore, CipherBlob } from './meta-secret-backend';

// ---------------------------------------------------------------------------
// Migración (correlativo propio del plano Meta; tablas prefijadas `meta_*`)
// ---------------------------------------------------------------------------

export const metaOAuthMigrations: ReadonlyArray<Migration> = [
  {
    id: '0001_meta_oauth_init',
    sql: `
      create table if not exists meta_oauth_state (
        valor           text primary key,
        organization_id text not null,
        actor_id        text not null,
        creado_en       timestamptz not null,
        expira_en       timestamptz not null,
        consumido_en    timestamptz
      );
      create index if not exists meta_oauth_state_org_idx on meta_oauth_state (organization_id);
      create index if not exists meta_oauth_state_expira_idx on meta_oauth_state (expira_en);

      create table if not exists meta_credential (
        organization_id  text not null,
        credential_id    text not null,
        provider         text not null default 'meta',
        token_type       text not null,
        secret_ref       text not null,
        issued_at        timestamptz,
        expires_at       timestamptz,
        last_validated_at timestamptz,
        revoked_at       timestamptz,
        status           text not null,
        primary key (organization_id, credential_id)
      );

      create table if not exists meta_connection (
        organization_id text not null,
        connection_id   text not null,
        provider        text not null default 'meta',
        estado          text not null,
        salud           text not null,
        credencial_ref  text,
        bindings        jsonb not null default '[]'::jsonb,
        candidatos      jsonb not null default '[]'::jsonb,
        primary key (organization_id, connection_id)
      );

      create table if not exists meta_ciphertext (
        clave            text primary key,
        organization_id  text not null,
        iv               text not null,
        auth_tag         text not null,
        ciphertext       text not null,
        wrapped_data_key text not null,
        version          integer not null,
        created_at       timestamptz not null default now()
      );
      create index if not exists meta_ciphertext_org_idx on meta_ciphertext (organization_id);
    `,
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function aIso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

// ---------------------------------------------------------------------------
// PgOAuthStateStore — consumo atómico one-time
// ---------------------------------------------------------------------------

export class PgOAuthStateStore implements OAuthStateStore {
  constructor(private readonly pool: Pool) {}

  async guardar(e: EstadoOAuth): Promise<void> {
    await this.pool.query(
      `insert into meta_oauth_state (valor, organization_id, actor_id, creado_en, expira_en, consumido_en)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (valor) do update set
         organization_id = excluded.organization_id, actor_id = excluded.actor_id,
         creado_en = excluded.creado_en, expira_en = excluded.expira_en, consumido_en = excluded.consumido_en`,
      [e.valor, e.organizationId, e.actorId, e.creadoEn, e.expiraEn, e.consumido ? new Date().toISOString() : null],
    );
  }

  async obtener(valor: string): Promise<EstadoOAuth | null> {
    const r = await this.pool.query('select * from meta_oauth_state where valor = $1', [valor]);
    const row = r.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      valor: String(row['valor']),
      organizationId: String(row['organization_id']),
      actorId: String(row['actor_id']),
      creadoEn: aIso(row['creado_en'])!,
      expiraEn: aIso(row['expira_en'])!,
      consumido: row['consumido_en'] !== null && row['consumido_en'] !== undefined,
    };
  }

  /** Sección crítica ATÓMICA en el motor PG: sólo el primer UPDATE con consumido_en IS NULL gana. */
  async consumir(valor: string): Promise<ResultadoConsumo> {
    const upd = await this.pool.query('update meta_oauth_state set consumido_en = now() where valor = $1 and consumido_en is null returning valor', [valor]);
    if ((upd.rowCount ?? 0) === 1) return 'CONSUMED';
    const existe = await this.pool.query('select 1 from meta_oauth_state where valor = $1', [valor]);
    return (existe.rowCount ?? 0) > 0 ? 'ALREADY_CONSUMED' : 'NOT_FOUND';
  }
}

// ---------------------------------------------------------------------------
// PgCredentialRepo — sólo metadata + secretRef opaco (nunca token/code/secret)
// ---------------------------------------------------------------------------

export class PgCredentialRepo implements CredentialRepo {
  constructor(private readonly pool: Pool) {}

  async guardar(c: CredencialMetaRef): Promise<void> {
    await this.pool.query(
      `insert into meta_credential
         (organization_id, credential_id, provider, token_type, secret_ref, issued_at, expires_at, last_validated_at, revoked_at, status)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       on conflict (organization_id, credential_id) do update set
         token_type = excluded.token_type, secret_ref = excluded.secret_ref, issued_at = excluded.issued_at,
         expires_at = excluded.expires_at, last_validated_at = excluded.last_validated_at,
         revoked_at = excluded.revoked_at, status = excluded.status`,
      [c.organizationId, c.credentialId, c.provider, c.tokenType, c.secretRef, c.issuedAt, c.expiresAt, c.lastValidatedAt, c.revokedAt, c.status],
    );
  }

  async obtener(organizationId: string, credentialId: string): Promise<CredencialMetaRef | null> {
    const r = await this.pool.query('select * from meta_credential where organization_id = $1 and credential_id = $2', [organizationId, credentialId]);
    const row = r.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      provider: 'meta',
      organizationId: String(row['organization_id']),
      credentialId: String(row['credential_id']),
      tokenType: String(row['token_type']) as TipoTokenMeta,
      secretRef: String(row['secret_ref']),
      issuedAt: aIso(row['issued_at']),
      expiresAt: aIso(row['expires_at']),
      lastValidatedAt: aIso(row['last_validated_at']),
      revokedAt: aIso(row['revoked_at']),
      status: String(row['status']) as EstadoCredencial,
    };
  }
}

// ---------------------------------------------------------------------------
// PgConnectionRepo — máquina de estados + candidatos (jsonb)
// ---------------------------------------------------------------------------

export class PgConnectionRepo implements ConnectionRepo {
  constructor(private readonly pool: Pool) {}

  async guardar(r: RegistroConexionMeta): Promise<void> {
    const c = r.conexion;
    await this.pool.query(
      `insert into meta_connection (organization_id, connection_id, provider, estado, salud, credencial_ref, bindings, candidatos)
       values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb)
       on conflict (organization_id, connection_id) do update set
         estado = excluded.estado, salud = excluded.salud, credencial_ref = excluded.credencial_ref,
         bindings = excluded.bindings, candidatos = excluded.candidatos`,
      [c.organizationId, c.connectionId, c.provider, c.estado, c.salud, c.credencialRef, JSON.stringify(c.bindings), JSON.stringify(r.candidatos)],
    );
  }

  async obtener(organizationId: string, connectionId: string): Promise<RegistroConexionMeta | null> {
    const res = await this.pool.query('select * from meta_connection where organization_id = $1 and connection_id = $2', [organizationId, connectionId]);
    const row = res.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    const conexion: ConexionMeta = {
      organizationId: String(row['organization_id']),
      provider: 'meta',
      connectionId: String(row['connection_id']),
      estado: String(row['estado']) as EstadoConexionMeta,
      salud: String(row['salud']) as SaludConexionMeta,
      bindings: (row['bindings'] as BindingMeta[]) ?? [],
      credencialRef: row['credencial_ref'] === null || row['credencial_ref'] === undefined ? null : String(row['credencial_ref']),
    };
    const candidatos = (row['candidatos'] as CandidatoActivo[]) ?? [];
    return { conexion, candidatos };
  }
}

// ---------------------------------------------------------------------------
// PgCiphertextStore — envelope material (nunca data key en claro; clave incluye la org)
// ---------------------------------------------------------------------------

export class PgCiphertextStore implements CiphertextStore {
  constructor(private readonly pool: Pool) {}

  async put(clave: string, blob: CipherBlob): Promise<void> {
    await this.pool.query(
      `insert into meta_ciphertext (clave, organization_id, iv, auth_tag, ciphertext, wrapped_data_key, version)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (clave) do update set
         organization_id = excluded.organization_id, iv = excluded.iv, auth_tag = excluded.auth_tag,
         ciphertext = excluded.ciphertext, wrapped_data_key = excluded.wrapped_data_key, version = excluded.version`,
      [clave, blob.organizationId, blob.iv, blob.authTag, blob.ciphertext, blob.wrappedDataKey, blob.version],
    );
  }

  async get(clave: string): Promise<CipherBlob | null> {
    const r = await this.pool.query('select * from meta_ciphertext where clave = $1', [clave]);
    const row = r.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      organizationId: String(row['organization_id']),
      iv: String(row['iv']),
      authTag: String(row['auth_tag']),
      ciphertext: String(row['ciphertext']),
      wrappedDataKey: String(row['wrapped_data_key']),
      version: Number(row['version']),
    };
  }

  async del(clave: string): Promise<void> {
    await this.pool.query('delete from meta_ciphertext where clave = $1', [clave]);
  }
}

// ---------------------------------------------------------------------------
// Factory de composición productiva (persistencia). HTTP Meta NO cableado aún.
// ---------------------------------------------------------------------------

export interface RepositoriosMetaPg {
  readonly stateStore: PgOAuthStateStore;
  readonly credRepo: PgCredentialRepo;
  readonly connRepo: PgConnectionRepo;
  readonly ciphertextStore: PgCiphertextStore;
}

export function crearRepositoriosMetaPg(pool: Pool): RepositoriosMetaPg {
  return {
    stateStore: new PgOAuthStateStore(pool),
    credRepo: new PgCredentialRepo(pool),
    connRepo: new PgConnectionRepo(pool),
    ciphertextStore: new PgCiphertextStore(pool),
  };
}

/** Estado de madurez de la persistencia Meta (separado del HTTP). */
export type MetaPersistenceStatus = 'READY' | 'NOT_READY';
export const META_PERSISTENCE_STATUS: MetaPersistenceStatus = 'READY';
export type MetaOAuthHttpStatus = 'IMPLEMENTED' | 'NOT_IMPLEMENTED';
export const META_OAUTH_HTTP_STATUS: MetaOAuthHttpStatus = 'NOT_IMPLEMENTED';
