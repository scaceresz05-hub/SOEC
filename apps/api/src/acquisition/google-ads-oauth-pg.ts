/**
 * apps/api · Persistencia PostgreSQL del provider Google Ads (OAuth + conexión + envelope). Tablas propias
 * `google_ads_*` (aisladas de Meta ⇒ rollback independiente; provider isolation por construcción).
 *
 * NUNCA se persiste: refresh_token/access_token/authorization_code/client_secret/developer_token plaintext,
 * ni raw payload del proveedor. Sólo: state anti-CSRF provider-bound (one-time), metadata de credencial con
 * `secret_ref` OPACO, la conexión (estado + cuenta seleccionada), y el envelope cifrado (iv/tag/ciphertext/
 * wrappedDataKey) — jamás la data key en claro.
 *
 * Consumo de state ATÓMICO: `UPDATE … WHERE consumido_en IS NULL RETURNING` ⇒ exactamente un ganador.
 */

import type { Pool } from 'pg';
import { runMigrations, type Migration } from '@soec/event-store/pg';
import type { CipherBlob, CiphertextStore } from './meta-secret-backend';
import type { EstadoOAuthGoogleAds } from './google-ads-oauth';
import { PROVIDER_GOOGLE_ADS } from './google-ads-oauth';
import type { ConexionGoogleAds, CredencialGoogleAdsRef, EstadoConexionGoogleAds, SaludConexionGoogleAds, EstadoCredencialGoogleAds } from './google-ads-connection';

// ---------------------------------------------------------------------------
// Migración (tablas prefijadas `google_ads_*`, todas organization_id-scoped)
// ---------------------------------------------------------------------------

export const googleAdsOAuthMigrations: ReadonlyArray<Migration> = [
  {
    id: '0001_google_ads_oauth_init',
    sql: `
      create table if not exists google_ads_oauth_state (
        valor           text primary key,
        provider        text not null default 'google-ads',
        organization_id text not null,
        actor_id        text not null,
        creado_en       timestamptz not null,
        expira_en       timestamptz not null,
        consumido_en    timestamptz
      );
      create index if not exists google_ads_oauth_state_org_idx on google_ads_oauth_state (organization_id);
      create index if not exists google_ads_oauth_state_expira_idx on google_ads_oauth_state (expira_en);

      create table if not exists google_ads_credential (
        organization_id   text not null,
        credential_id     text not null,
        provider          text not null default 'google-ads',
        secret_ref        text not null,
        issued_at         timestamptz,
        last_validated_at timestamptz,
        revoked_at        timestamptz,
        status            text not null,
        primary key (organization_id, credential_id)
      );

      create table if not exists google_ads_connection (
        organization_id    text not null,
        connection_id      text not null,
        provider           text not null default 'google-ads',
        estado             text not null,
        salud              text not null,
        customer_id        text,
        login_customer_id  text,
        descriptive_name   text,
        time_zone          text,
        currency_code      text,
        credencial_ref     text,
        needs_reauth       boolean not null default false,
        created_at         timestamptz not null,
        updated_at         timestamptz not null,
        primary key (organization_id, connection_id)
      );
      create index if not exists google_ads_connection_estado_idx on google_ads_connection (estado);

      create table if not exists google_ads_ciphertext (
        clave            text primary key,
        organization_id  text not null,
        iv               text not null,
        auth_tag         text not null,
        ciphertext       text not null,
        wrapped_data_key text not null,
        version          integer not null,
        created_at       timestamptz not null default now()
      );
      create index if not exists google_ads_ciphertext_org_idx on google_ads_ciphertext (organization_id);
    `,
  },
  {
    // Lease de sincronización: exclusión distribuida por conexión (single-flight entre réplicas de la API).
    id: '0002_google_ads_sync_lease',
    sql: `
      create table if not exists google_ads_sync_lease (
        connection_key text primary key,
        holder         text not null,
        acquired_at    timestamptz not null,
        expires_at     timestamptz not null
      );
      create index if not exists google_ads_sync_lease_exp_idx on google_ads_sync_lease (expires_at);
    `,
  },
];

/**
 * Clave fija del advisory lock que serializa el arranque de las migraciones Google Ads entre réplicas.
 * Evita la carrera del ledger `schema_migrations` (dos boots ⇒ `insert` de id duplicado ⇒ un boot falla)
 * SIN modificar la infraestructura compartida `runMigrations` (Meta y demás intactos).
 */
export const GOOGLE_ADS_MIGRATION_LOCK_KEY = 809055250186;

/**
 * Ejecuta las migraciones Google Ads bajo advisory lock de sesión: dos instancias arrancando a la vez
 * se serializan; la segunda ve las migraciones ya aplicadas y las saltea. Idempotente y crash-safe (el
 * lock se libera al cerrar la conexión). CONCURRENT_MIGRATION_BOOT seguro por diseño.
 */
export async function runGoogleAdsMigrationsSeguro(pool: Pool): Promise<string[]> {
  const client = await pool.connect();
  try {
    await client.query('select pg_advisory_lock($1)', [GOOGLE_ADS_MIGRATION_LOCK_KEY]);
    return await runMigrations(pool, googleAdsOAuthMigrations);
  } finally {
    await client.query('select pg_advisory_unlock($1)', [GOOGLE_ADS_MIGRATION_LOCK_KEY]).catch(() => undefined);
    client.release();
  }
}

function aIso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

// ---------------------------------------------------------------------------
// State store — consumo atómico one-time, provider-bound
// ---------------------------------------------------------------------------

export type ResultadoConsumoState = 'CONSUMED' | 'ALREADY_CONSUMED' | 'NOT_FOUND';

export class PgGoogleAdsStateStore {
  constructor(private readonly pool: Pool) {}

  async guardar(e: EstadoOAuthGoogleAds): Promise<void> {
    await this.pool.query(
      `insert into google_ads_oauth_state (valor, provider, organization_id, actor_id, creado_en, expira_en, consumido_en)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (valor) do update set
         provider = excluded.provider, organization_id = excluded.organization_id, actor_id = excluded.actor_id,
         creado_en = excluded.creado_en, expira_en = excluded.expira_en, consumido_en = excluded.consumido_en`,
      [e.valor, e.provider, e.organizationId, e.actorId, e.creadoEn, e.expiraEn, e.consumido ? new Date().toISOString() : null],
    );
  }

  async obtener(valor: string): Promise<EstadoOAuthGoogleAds | null> {
    const r = await this.pool.query('select * from google_ads_oauth_state where valor = $1', [valor]);
    const row = r.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      valor: String(row['valor']),
      provider: String(row['provider']) === PROVIDER_GOOGLE_ADS ? PROVIDER_GOOGLE_ADS : (String(row['provider']) as typeof PROVIDER_GOOGLE_ADS),
      organizationId: String(row['organization_id']),
      actorId: String(row['actor_id']),
      creadoEn: aIso(row['creado_en'])!,
      expiraEn: aIso(row['expira_en'])!,
      consumido: row['consumido_en'] !== null && row['consumido_en'] !== undefined,
    };
  }

  /** Sección crítica ATÓMICA: sólo el primer UPDATE con consumido_en IS NULL gana (anti-replay). */
  async consumir(valor: string): Promise<ResultadoConsumoState> {
    const upd = await this.pool.query('update google_ads_oauth_state set consumido_en = now() where valor = $1 and consumido_en is null returning valor', [valor]);
    if ((upd.rowCount ?? 0) === 1) return 'CONSUMED';
    const existe = await this.pool.query('select 1 from google_ads_oauth_state where valor = $1', [valor]);
    return (existe.rowCount ?? 0) > 0 ? 'ALREADY_CONSUMED' : 'NOT_FOUND';
  }
}

// ---------------------------------------------------------------------------
// Credential repo — sólo metadata + secretRef opaco
// ---------------------------------------------------------------------------

export class PgGoogleAdsCredentialRepo {
  constructor(private readonly pool: Pool) {}

  async guardar(c: CredencialGoogleAdsRef): Promise<void> {
    await this.pool.query(
      `insert into google_ads_credential (organization_id, credential_id, provider, secret_ref, issued_at, last_validated_at, revoked_at, status)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (organization_id, credential_id) do update set
         secret_ref = excluded.secret_ref, issued_at = excluded.issued_at, last_validated_at = excluded.last_validated_at,
         revoked_at = excluded.revoked_at, status = excluded.status`,
      [c.organizationId, c.credentialId, c.provider, c.secretRef, c.issuedAt, c.lastValidatedAt, c.revokedAt, c.status],
    );
  }

  async obtener(organizationId: string, credentialId: string): Promise<CredencialGoogleAdsRef | null> {
    const r = await this.pool.query('select * from google_ads_credential where organization_id = $1 and credential_id = $2', [organizationId, credentialId]);
    const row = r.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      provider: PROVIDER_GOOGLE_ADS,
      organizationId: String(row['organization_id']),
      credentialId: String(row['credential_id']),
      secretRef: String(row['secret_ref']),
      issuedAt: aIso(row['issued_at']),
      lastValidatedAt: aIso(row['last_validated_at']),
      revokedAt: aIso(row['revoked_at']),
      status: String(row['status']) as EstadoCredencialGoogleAds,
    };
  }
}

// ---------------------------------------------------------------------------
// Connection repo — estado + cuenta seleccionada
// ---------------------------------------------------------------------------

export class PgGoogleAdsConnectionRepo {
  constructor(private readonly pool: Pool) {}

  async guardar(c: ConexionGoogleAds): Promise<void> {
    await this.pool.query(
      `insert into google_ads_connection
         (organization_id, connection_id, provider, estado, salud, customer_id, login_customer_id, descriptive_name, time_zone, currency_code, credencial_ref, needs_reauth, created_at, updated_at)
       values ($1,$2,'google-ads',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       on conflict (organization_id, connection_id) do update set
         estado = excluded.estado, salud = excluded.salud, customer_id = excluded.customer_id,
         login_customer_id = excluded.login_customer_id, descriptive_name = excluded.descriptive_name,
         time_zone = excluded.time_zone, currency_code = excluded.currency_code, credencial_ref = excluded.credencial_ref,
         needs_reauth = excluded.needs_reauth, updated_at = excluded.updated_at`,
      [c.organizationId, c.connectionId, c.estado, c.salud, c.customerId, c.loginCustomerId, c.descriptiveName, c.timeZone, c.currencyCode, c.credencialRef, c.needsReauth, c.createdAt, c.updatedAt],
    );
  }

  async obtener(organizationId: string, connectionId: string): Promise<ConexionGoogleAds | null> {
    const r = await this.pool.query('select * from google_ads_connection where organization_id = $1 and connection_id = $2', [organizationId, connectionId]);
    return this.fila(r.rows[0] as Record<string, unknown> | undefined);
  }

  /** Todas las conexiones CONNECTED de TODOS los tenants (para el scheduler multi-tenant). */
  async listarConectadas(): Promise<readonly ConexionGoogleAds[]> {
    const r = await this.pool.query("select * from google_ads_connection where estado = 'CONNECTED'");
    return (r.rows as Array<Record<string, unknown>>).map((row) => this.fila(row)!).filter(Boolean);
  }

  private fila(row: Record<string, unknown> | undefined): ConexionGoogleAds | null {
    if (!row) return null;
    return {
      organizationId: String(row['organization_id']),
      connectionId: String(row['connection_id']),
      estado: String(row['estado']) as EstadoConexionGoogleAds,
      salud: String(row['salud']) as SaludConexionGoogleAds,
      customerId: row['customer_id'] != null ? String(row['customer_id']) : null,
      loginCustomerId: row['login_customer_id'] != null ? String(row['login_customer_id']) : null,
      descriptiveName: row['descriptive_name'] != null ? String(row['descriptive_name']) : null,
      timeZone: row['time_zone'] != null ? String(row['time_zone']) : null,
      currencyCode: row['currency_code'] != null ? String(row['currency_code']) : null,
      credencialRef: row['credencial_ref'] != null ? String(row['credencial_ref']) : null,
      needsReauth: row['needs_reauth'] === true,
      createdAt: aIso(row['created_at'])!,
      updatedAt: aIso(row['updated_at'])!,
    };
  }
}

// ---------------------------------------------------------------------------
// Ciphertext store — tabla google_ads_ciphertext (envelope; nunca data key en claro)
// ---------------------------------------------------------------------------

export class PgGoogleAdsCiphertextStore implements CiphertextStore {
  constructor(private readonly pool: Pool) {}

  async put(clave: string, blob: CipherBlob): Promise<void> {
    await this.pool.query(
      `insert into google_ads_ciphertext (clave, organization_id, iv, auth_tag, ciphertext, wrapped_data_key, version)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (clave) do update set
         organization_id = excluded.organization_id, iv = excluded.iv, auth_tag = excluded.auth_tag,
         ciphertext = excluded.ciphertext, wrapped_data_key = excluded.wrapped_data_key, version = excluded.version`,
      [clave, blob.organizationId, blob.iv, blob.authTag, blob.ciphertext, blob.wrappedDataKey, blob.version],
    );
  }

  async get(clave: string): Promise<CipherBlob | null> {
    const r = await this.pool.query('select * from google_ads_ciphertext where clave = $1', [clave]);
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
    await this.pool.query('delete from google_ads_ciphertext where clave = $1', [clave]);
  }
}

// ---------------------------------------------------------------------------
// Sync lease — exclusión distribuida por conexión (single-flight entre réplicas)
// ---------------------------------------------------------------------------

/**
 * Lease atómico por conexión. `adquirir` gana SÓLO si no hay lease vigente (INSERT) o si el previo EXPIRÓ
 * (UPDATE condicional). Dos procesos concurrentes sobre la misma conexión ⇒ exactamente uno adquiere (el
 * row-lock de PG serializa el conflicto; el perdedor re-evalúa la condición ya vencida ⇒ 0 filas). Crash del
 * holder ⇒ el lease expira y otro lo recupera. TWO_API_REPLICAS_DUPLICATE_SYNC imposible por diseño.
 */
export class PgGoogleAdsSyncLease {
  constructor(private readonly pool: Pool, private readonly ttlMs: number = 10 * 60 * 1000) {}

  async adquirir(connectionKey: string, holder: string, ahora: string): Promise<boolean> {
    const expira = new Date(Date.parse(ahora) + this.ttlMs).toISOString();
    const r = await this.pool.query(
      `insert into google_ads_sync_lease (connection_key, holder, acquired_at, expires_at)
       values ($1,$2,$3,$4)
       on conflict (connection_key) do update
         set holder = excluded.holder, acquired_at = excluded.acquired_at, expires_at = excluded.expires_at
         where google_ads_sync_lease.expires_at < $3
       returning holder`,
      [connectionKey, holder, ahora, expira],
    );
    return (r.rowCount ?? 0) === 1;
  }

  async liberar(connectionKey: string, holder: string): Promise<void> {
    await this.pool.query('delete from google_ads_sync_lease where connection_key = $1 and holder = $2', [connectionKey, holder]);
  }
}

export interface RepositoriosGoogleAdsPg {
  readonly stateStore: PgGoogleAdsStateStore;
  readonly credRepo: PgGoogleAdsCredentialRepo;
  readonly connRepo: PgGoogleAdsConnectionRepo;
  readonly ciphertextStore: PgGoogleAdsCiphertextStore;
  readonly syncLease: PgGoogleAdsSyncLease;
}

export function crearRepositoriosGoogleAdsPg(pool: Pool): RepositoriosGoogleAdsPg {
  return {
    stateStore: new PgGoogleAdsStateStore(pool),
    credRepo: new PgGoogleAdsCredentialRepo(pool),
    connRepo: new PgGoogleAdsConnectionRepo(pool),
    ciphertextStore: new PgGoogleAdsCiphertextStore(pool),
    syncLease: new PgGoogleAdsSyncLease(pool),
  };
}
