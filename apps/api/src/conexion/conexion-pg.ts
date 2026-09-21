/**
 * apps/api · CONEXIONES COMO DATO · esquema y repositorio (PostgreSQL = SSOT de la configuración operativa).
 *
 * Antes, conectar una empresa a su fuente de datos era editar un módulo TypeScript (`plataforma/negocios/…`),
 * declarar la credencial como variable de entorno del despliegue y desplegar. Aquí la conexión es una fila:
 * proveedor, cuenta, configuración pública y REFERENCIA a la credencial. La credencial se guarda cifrada con
 * la misma envoltura KMS que ya protege los tokens de Google Ads y Meta.
 *
 * TRES TABLAS:
 *   · `business_connection`            — una conexión por (organización, proveedor). Sin valores secretos.
 *   · `business_capability`            — qué tiene permitido hacer el negocio. Sustituye `experienciasHabilitadas`.
 *   · `business_connection_ciphertext` — sólo ciphertext + data key envuelta, como `google_ads_ciphertext`.
 *
 * AISLAMIENTO: todo lleva `organization_id` en la clave primaria y toda consulta lo exige. No existe la
 * conexión «global», ni la capacidad «de la plataforma»: pertenecen a un negocio o no existen.
 */
import type { Pool, PoolClient } from 'pg';
import type { Migration } from '@soec/event-store/pg';
import type { CipherBlob, CiphertextStore } from '../acquisition/meta-secret-backend';
import type { TipoFuente } from '../plataforma/tipos';
import { FAMILIA_DE_PROVEEDOR, type CapacidadNegocio, type EstadoConexion, type ProveedorConexion } from './conexion-tipos';

export type Queryable = Pool | PoolClient;

/** Conexión persistida. `secretRef` es SIEMPRE una referencia opaca; jamás el valor de la credencial. */
export interface Conexion {
  readonly organizationId: string;
  readonly provider: ProveedorConexion;
  readonly id: string;
  readonly tipo: TipoFuente;
  readonly estado: EstadoConexion;
  readonly externalAccountId: string | null;
  readonly externalAccountName: string | null;
  readonly loginAccountId: string | null;
  /** Configuración PÚBLICA (endpoint, ruta, allowlist, identificadores). Nunca un secreto. */
  readonly configuracion: Record<string, unknown>;
  readonly secretRef: string | null;
  readonly ultimoError: string | null;
  readonly validadaEn: string | null;
  readonly origen: 'UI' | 'MIGRACION' | 'OAUTH';
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CapacidadPersistida {
  readonly organizationId: string;
  readonly capacidad: CapacidadNegocio;
  readonly habilitada: boolean;
  readonly origen: 'UI' | 'MIGRACION' | 'SISTEMA';
  readonly nota: string | null;
  readonly actor: string | null;
  readonly updatedAt: string;
}

export const conexionMigrations: ReadonlyArray<Migration> = [
  {
    id: '0001_connections_as_data',
    sql: `
      create table if not exists business_connection (
        organization_id       text not null references business_profile(organization_id) on delete cascade,
        provider              text not null,
        id                    text not null,
        tipo                  text not null,
        estado                text not null default 'NOT_CONNECTED',
        external_account_id   text,
        external_account_name text,
        login_account_id      text,
        configuracion         jsonb not null default '{}'::jsonb,
        secret_ref            text,
        ultimo_error          text,
        validada_en           timestamptz,
        origen                text not null default 'UI',
        created_at            timestamptz not null default now(),
        updated_at            timestamptz not null default now(),
        primary key (organization_id, provider)
      );
      create index if not exists ix_business_connection_estado on business_connection (estado, provider);

      create table if not exists business_capability (
        organization_id text not null references business_profile(organization_id) on delete cascade,
        capacidad       text not null,
        habilitada      boolean not null default false,
        origen          text not null default 'UI',
        nota            text,
        actor           text,
        updated_at      timestamptz not null default now(),
        primary key (organization_id, capacidad)
      );
      create index if not exists ix_business_capability_hab on business_capability (capacidad, habilitada);

      create table if not exists business_connection_ciphertext (
        clave            text primary key,
        organization_id  text not null,
        iv               text not null,
        auth_tag         text not null,
        ciphertext       text not null,
        wrapped_data_key text not null,
        version          int  not null default 1,
        updated_at       timestamptz not null default now()
      );
      create index if not exists ix_business_connection_ct_org on business_connection_ciphertext (organization_id);
    `,
  },
];

const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : v === null || v === undefined ? null : String(v));
const texto = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

function aConexion(r: Record<string, unknown>): Conexion {
  const provider = String(r.provider) as ProveedorConexion;
  return {
    organizationId: String(r.organization_id),
    provider,
    id: String(r.id),
    tipo: (texto(r.tipo) ?? FAMILIA_DE_PROVEEDOR[provider] ?? 'GROWTH') as TipoFuente,
    estado: String(r.estado) as EstadoConexion,
    externalAccountId: texto(r.external_account_id),
    externalAccountName: texto(r.external_account_name),
    loginAccountId: texto(r.login_account_id),
    configuracion: (r.configuracion ?? {}) as Record<string, unknown>,
    secretRef: texto(r.secret_ref),
    ultimoError: texto(r.ultimo_error),
    validadaEn: iso(r.validada_en),
    origen: (String(r.origen ?? 'UI') as Conexion['origen']),
    createdAt: iso(r.created_at) ?? '',
    updatedAt: iso(r.updated_at) ?? '',
  };
}

function aCapacidad(r: Record<string, unknown>): CapacidadPersistida {
  return {
    organizationId: String(r.organization_id),
    capacidad: String(r.capacidad) as CapacidadNegocio,
    habilitada: r.habilitada === true,
    origen: String(r.origen ?? 'UI') as CapacidadPersistida['origen'],
    nota: texto(r.nota),
    actor: texto(r.actor),
    updatedAt: iso(r.updated_at) ?? '',
  };
}

/** Lo que se guarda al crear o editar una conexión. `secretRef` ausente ⇒ se conserva el que ya hubiera. */
export interface EntradaConexion {
  readonly organizationId: string;
  readonly provider: ProveedorConexion;
  readonly id: string;
  readonly estado: EstadoConexion;
  readonly externalAccountId?: string | null;
  readonly externalAccountName?: string | null;
  readonly loginAccountId?: string | null;
  readonly configuracion: Record<string, unknown>;
  readonly secretRef?: string | null;
  readonly ultimoError?: string | null;
  readonly validadaEn?: string | null;
  readonly origen: Conexion['origen'];
}

export class RepositorioConexiones {
  constructor(private readonly pool: Pool) {}

  /**
   * Alta o edición de una conexión. `coalesce` en `secret_ref`: guardar la configuración NUNCA borra la
   * credencial ya depositada (editar el endpoint no debe desconectar el negocio en silencio).
   */
  async guardar(q: Queryable, c: EntradaConexion): Promise<void> {
    await q.query(
      `insert into business_connection (organization_id, provider, id, tipo, estado, external_account_id,
         external_account_name, login_account_id, configuracion, secret_ref, ultimo_error, validada_en, origen)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13)
       on conflict (organization_id, provider) do update set
         tipo = excluded.tipo,
         estado = excluded.estado,
         external_account_id = excluded.external_account_id,
         external_account_name = excluded.external_account_name,
         login_account_id = excluded.login_account_id,
         configuracion = excluded.configuracion,
         secret_ref = coalesce(excluded.secret_ref, business_connection.secret_ref),
         ultimo_error = excluded.ultimo_error,
         validada_en = coalesce(excluded.validada_en, business_connection.validada_en),
         updated_at = now()`,
      [
        c.organizationId, c.provider, c.id, FAMILIA_DE_PROVEEDOR[c.provider], c.estado,
        c.externalAccountId ?? null, c.externalAccountName ?? null, c.loginAccountId ?? null,
        JSON.stringify(c.configuracion ?? {}), c.secretRef ?? null, c.ultimoError ?? null,
        c.validadaEn ?? null, c.origen,
      ],
    );
  }

  /** Inserta sólo si no existe. Es la puerta de la MIGRACIÓN: nunca sobrescribe lo que un humano editó. */
  async insertarSiFalta(q: Queryable, c: EntradaConexion): Promise<boolean> {
    const { rowCount } = await q.query(
      `insert into business_connection (organization_id, provider, id, tipo, estado, external_account_id,
         external_account_name, login_account_id, configuracion, secret_ref, validada_en, origen)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12)
       on conflict (organization_id, provider) do nothing`,
      [
        c.organizationId, c.provider, c.id, FAMILIA_DE_PROVEEDOR[c.provider], c.estado,
        c.externalAccountId ?? null, c.externalAccountName ?? null, c.loginAccountId ?? null,
        JSON.stringify(c.configuracion ?? {}), c.secretRef ?? null, c.validadaEn ?? null, c.origen,
      ],
    );
    return (rowCount ?? 0) > 0;
  }

  async buscar(org: string, provider: ProveedorConexion): Promise<Conexion | null> {
    const { rows } = await this.pool.query('select * from business_connection where organization_id = $1 and provider = $2', [org, provider]);
    return rows[0] ? aConexion(rows[0] as Record<string, unknown>) : null;
  }

  async listar(org: string): Promise<readonly Conexion[]> {
    const { rows } = await this.pool.query('select * from business_connection where organization_id = $1 order by provider', [org]);
    return rows.map((r: Record<string, unknown>) => aConexion(r));
  }

  /** TODAS las conexiones del despliegue: es la lectura que alimenta la proyección del runtime. */
  async todas(): Promise<readonly Conexion[]> {
    const { rows } = await this.pool.query('select * from business_connection order by organization_id, provider');
    return rows.map((r: Record<string, unknown>) => aConexion(r));
  }

  /** Cambia el estado (y el último error) sin tocar configuración ni credencial. */
  async fijarEstado(org: string, provider: ProveedorConexion, estado: EstadoConexion, ultimoError: string | null, validadaEn?: string | null): Promise<void> {
    await this.pool.query(
      `update business_connection set estado = $3, ultimo_error = $4,
         validada_en = coalesce($5, validada_en), updated_at = now()
       where organization_id = $1 and provider = $2`,
      [org, provider, estado, ultimoError, validadaEn ?? null],
    );
  }

  /** Olvida la credencial: deja la conexión declarada pero sin poder leer. No borra la fila ni su historia. */
  async olvidarCredencial(org: string, provider: ProveedorConexion): Promise<void> {
    await this.pool.query(
      `update business_connection set secret_ref = null, estado = 'DISABLED', updated_at = now()
       where organization_id = $1 and provider = $2`,
      [org, provider],
    );
  }

  // ── CAPACIDADES ────────────────────────────────────────────────────────────────────────────────

  async fijarCapacidad(q: Queryable, c: Omit<CapacidadPersistida, 'updatedAt'>): Promise<void> {
    await q.query(
      `insert into business_capability (organization_id, capacidad, habilitada, origen, nota, actor)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (organization_id, capacidad) do update set
         habilitada = excluded.habilitada, origen = excluded.origen, nota = excluded.nota,
         actor = excluded.actor, updated_at = now()`,
      [c.organizationId, c.capacidad, c.habilitada, c.origen, c.nota, c.actor],
    );
  }

  /** Alta que NO pisa lo existente: la migración declara el punto de partida, no la decisión vigente. */
  async fijarCapacidadSiFalta(q: Queryable, c: Omit<CapacidadPersistida, 'updatedAt'>): Promise<boolean> {
    const { rowCount } = await q.query(
      `insert into business_capability (organization_id, capacidad, habilitada, origen, nota, actor)
       values ($1,$2,$3,$4,$5,$6) on conflict (organization_id, capacidad) do nothing`,
      [c.organizationId, c.capacidad, c.habilitada, c.origen, c.nota, c.actor],
    );
    return (rowCount ?? 0) > 0;
  }

  async capacidades(org: string): Promise<readonly CapacidadPersistida[]> {
    const { rows } = await this.pool.query('select * from business_capability where organization_id = $1 order by capacidad', [org]);
    return rows.map((r: Record<string, unknown>) => aCapacidad(r));
  }

  async todasLasCapacidades(): Promise<readonly CapacidadPersistida[]> {
    const { rows } = await this.pool.query('select * from business_capability order by organization_id, capacidad');
    return rows.map((r: Record<string, unknown>) => aCapacidad(r));
  }

  /** Organizaciones con una capacidad HABILITADA. Es el descubrimiento que usan los bucles de fondo. */
  async organizacionesCon(capacidad: CapacidadNegocio): Promise<readonly string[]> {
    const { rows } = await this.pool.query(
      'select organization_id from business_capability where capacidad = $1 and habilitada = true order by organization_id',
      [capacidad],
    );
    return rows.map((r: { organization_id: string }) => r.organization_id);
  }
}

/**
 * Depósito de ciphertext de las credenciales de conexión. Tabla propia —no se mezcla con la de Google Ads—
 * pero MISMO patrón: nunca se guarda plaintext y la data key viaja envuelta por el KMS.
 */
export class PgConexionCiphertextStore implements CiphertextStore {
  constructor(private readonly pool: Pool) {}

  async put(clave: string, blob: CipherBlob): Promise<void> {
    await this.pool.query(
      `insert into business_connection_ciphertext (clave, organization_id, iv, auth_tag, ciphertext, wrapped_data_key, version)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (clave) do update set organization_id = excluded.organization_id, iv = excluded.iv,
         auth_tag = excluded.auth_tag, ciphertext = excluded.ciphertext,
         wrapped_data_key = excluded.wrapped_data_key, version = excluded.version, updated_at = now()`,
      [clave, blob.organizationId, blob.iv, blob.authTag, blob.ciphertext, blob.wrappedDataKey, blob.version],
    );
  }

  async get(clave: string): Promise<CipherBlob | null> {
    const { rows } = await this.pool.query('select * from business_connection_ciphertext where clave = $1', [clave]);
    const r = rows[0] as Record<string, unknown> | undefined;
    if (!r) return null;
    return {
      organizationId: String(r.organization_id),
      iv: String(r.iv),
      authTag: String(r.auth_tag),
      ciphertext: String(r.ciphertext),
      wrappedDataKey: String(r.wrapped_data_key),
      version: Number(r.version ?? 1),
    };
  }

  async del(clave: string): Promise<void> {
    await this.pool.query('delete from business_connection_ciphertext where clave = $1', [clave]);
  }
}
