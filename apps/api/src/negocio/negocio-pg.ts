/**
 * apps/api · NEGOCIO COMO DATO · esquema y repositorio (PostgreSQL = SSOT del negocio).
 *
 * Hasta ahora, incorporar una empresa era escribir un módulo TypeScript y añadir una línea a un array.
 * Aquí el negocio pasa a ser una fila: identidad, perfil comercial, oferta, territorios, restricciones y
 * postura de gobierno viven en la base, y una empresa nueva no necesita código, deploy ni variables.
 *
 * FRONTERA DE SECRETOS: en estas tablas NO entra ningún secreto. Tokens, refresh tokens y claves siguen
 * donde estaban (conexiones OAuth cifradas con KMS, depósito de secretos). El perfil sólo puede referirse a
 * una conexión por su identificador; nunca guarda su valor.
 *
 * IDENTIDAD: `organization_id` es la clave de tenant (el slug que ya usa todo el sistema) y `business_key`
 * es un identificador opaco y estable. El nombre comercial puede cambiar sin tocar ninguno de los dos.
 */
import type { Pool, PoolClient } from 'pg';
import type { Migration } from '@soec/event-store/pg';

export type Queryable = Pool | PoolClient;

/** Cómo se evalúa y se habla del negocio. Abierto a rubros nuevos: es un dato, no una rama de código. */
export type TipoNegocio = 'CLINICA' | 'SAAS' | 'ECOMMERCE' | 'SERVICIOS' | 'LOCAL' | 'OTRO';
export type TipoCliente = 'B2B' | 'B2C' | 'BOTH';
/** Ciclo de vida: nace en DRAFT y sólo llega a ACTIVE cuando el propietario completó lo que falta. */
export type EstadoNegocio = 'DRAFT' | 'CONFIGURING' | 'READY' | 'ACTIVE' | 'SUSPENDED';
/** Ámbito de un territorio: lo que el negocio atiende vs. lo que una plataforma puede ejecutar. */
export type AmbitoGeografico = 'BUSINESS' | 'ADVERTISING' | 'EXCLUSION';
/** Naturaleza de una afirmación: separar el hecho de la restricción y del claim aprobado o prohibido. */
export type TipoRestriccion = 'FACT' | 'RESTRICTION' | 'APPROVED_CLAIM' | 'PROHIBITED_CLAIM';

export interface PerfilNegocio {
  readonly organizationId: string;
  readonly businessKey: string;
  readonly displayName: string;
  readonly legalName: string | null;
  readonly businessType: TipoNegocio;
  readonly description: string | null;
  readonly website: string | null;
  readonly country: string;
  readonly currency: string;
  readonly timezone: string;
  readonly language: string;
  readonly customerType: TipoCliente;
  readonly primaryObjective: string | null;
  readonly status: EstadoNegocio;
  /** De dónde salió la fila: creada por una persona o migrada del registro TypeScript histórico. */
  readonly origen: 'UI' | 'MIGRACION';
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface OfertaNegocio {
  readonly organizationId: string;
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
  readonly category: string | null;
  readonly status: 'ACTIVE' | 'PAUSED' | 'RETIRED';
  readonly landingUrl: string | null;
  readonly priority: number;
  readonly geographicScope: string | null;
  /** Si puede promocionarse y bajo qué condición. `NOT_ELIGIBLE` con motivo es una respuesta válida. */
  readonly advertisingEligibility: 'ELIGIBLE' | 'NOT_ELIGIBLE' | 'REQUIRES_APPROVAL';
  readonly restrictions: readonly string[];
}

export interface TerritorioNegocio {
  readonly organizationId: string;
  readonly id: string;
  readonly ambito: AmbitoGeografico;
  readonly country: string;
  readonly region: string | null;
  readonly province: string | null;
  readonly localities: readonly string[];
  /** Cómo se interpreta la ubicación en la plataforma (p. ej. presencia física). */
  readonly criterio: string | null;
  readonly nota: string | null;
}

export interface RestriccionNegocio {
  readonly organizationId: string;
  readonly id: string;
  readonly tipo: TipoRestriccion;
  readonly texto: string;
  readonly alcance: string | null;
}

/** Postura de gobierno del negocio. Toda empresa nueva nace con TODO apagado. */
export interface GobiernoNegocio {
  readonly organizationId: string;
  readonly externalMutations: boolean;
  readonly autonomousSpend: boolean;
  readonly automaticSafetyPause: boolean;
  readonly campaignExecution: boolean;
  readonly updatedAt: string;
}

export interface NegocioCompleto {
  readonly perfil: PerfilNegocio;
  readonly objetivosSecundarios: readonly string[];
  readonly oferta: readonly OfertaNegocio[];
  readonly territorios: readonly TerritorioNegocio[];
  readonly restricciones: readonly RestriccionNegocio[];
  readonly gobierno: GobiernoNegocio;
}

export const negocioMigrations: ReadonlyArray<Migration> = [
  {
    id: '0001_business_as_data',
    sql: `
      create table if not exists business_profile (
        organization_id   text primary key,
        business_key      text not null unique,
        display_name      text not null,
        legal_name        text,
        business_type     text not null,
        description       text,
        website           text,
        country           text not null,
        currency          text not null,
        timezone          text not null,
        language          text not null default 'es',
        customer_type     text not null default 'B2C',
        primary_objective text,
        status            text not null default 'DRAFT',
        origen            text not null default 'UI',
        created_at        timestamptz not null default now(),
        updated_at        timestamptz not null default now()
      );

      create table if not exists business_objective (
        organization_id text not null references business_profile(organization_id) on delete cascade,
        orden           int  not null,
        texto           text not null,
        primary key (organization_id, orden)
      );

      create table if not exists business_offering (
        organization_id text not null references business_profile(organization_id) on delete cascade,
        id              text not null,
        slug            text not null,
        name            text not null,
        description     text,
        category        text,
        status          text not null default 'ACTIVE',
        landing_url     text,
        priority        int  not null default 100,
        geographic_scope text,
        advertising_eligibility text not null default 'REQUIRES_APPROVAL',
        restrictions    jsonb not null default '[]'::jsonb,
        primary key (organization_id, id),
        unique (organization_id, slug)
      );

      create table if not exists business_geo_scope (
        organization_id text not null references business_profile(organization_id) on delete cascade,
        id              text not null,
        ambito          text not null,
        country         text not null,
        region          text,
        province        text,
        localities      jsonb not null default '[]'::jsonb,
        criterio        text,
        nota            text,
        primary key (organization_id, id)
      );

      create table if not exists business_restriction (
        organization_id text not null references business_profile(organization_id) on delete cascade,
        id              text not null,
        tipo            text not null,
        texto           text not null,
        alcance         text,
        primary key (organization_id, id)
      );

      create table if not exists business_governance (
        organization_id       text primary key references business_profile(organization_id) on delete cascade,
        external_mutations    boolean not null default false,
        autonomous_spend      boolean not null default false,
        automatic_safety_pause boolean not null default false,
        campaign_execution    boolean not null default false,
        updated_at            timestamptz not null default now()
      );

      create table if not exists business_audit (
        id              bigserial primary key,
        organization_id text not null,
        actor           text not null,
        action          text not null,
        changed_fields  jsonb not null default '{}'::jsonb,
        at              timestamptz not null default now()
      );
      create index if not exists ix_business_audit_org on business_audit (organization_id, at desc);
    `,
  },
];

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v ?? ''));
const texto = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const lista = (v: unknown): readonly string[] => (Array.isArray(v) ? v.map((x) => String(x)) : []);

function aPerfil(r: Record<string, unknown>): PerfilNegocio {
  return {
    organizationId: String(r.organization_id),
    businessKey: String(r.business_key),
    displayName: String(r.display_name),
    legalName: texto(r.legal_name),
    businessType: String(r.business_type) as TipoNegocio,
    description: texto(r.description),
    website: texto(r.website),
    country: String(r.country),
    currency: String(r.currency),
    timezone: String(r.timezone),
    language: String(r.language ?? 'es'),
    customerType: String(r.customer_type ?? 'B2C') as TipoCliente,
    primaryObjective: texto(r.primary_objective),
    status: String(r.status) as EstadoNegocio,
    origen: String(r.origen ?? 'UI') === 'MIGRACION' ? 'MIGRACION' : 'UI',
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

/** Campos del perfil que una edición puede cambiar. La identidad (`organizationId`, `businessKey`) no. */
export interface CambiosPerfil {
  readonly displayName?: string;
  readonly legalName?: string | null;
  readonly businessType?: TipoNegocio;
  readonly description?: string | null;
  readonly website?: string | null;
  readonly country?: string;
  readonly currency?: string;
  readonly timezone?: string;
  readonly language?: string;
  readonly customerType?: TipoCliente;
  readonly primaryObjective?: string | null;
  readonly status?: EstadoNegocio;
}

const COLUMNAS_EDITABLES: Record<keyof CambiosPerfil, string> = {
  displayName: 'display_name', legalName: 'legal_name', businessType: 'business_type',
  description: 'description', website: 'website', country: 'country', currency: 'currency',
  timezone: 'timezone', language: 'language', customerType: 'customer_type',
  primaryObjective: 'primary_objective', status: 'status',
};

export class RepositorioNegocios {
  constructor(private readonly pool: Pool) {}

  async insertarPerfil(q: Queryable, p: Omit<PerfilNegocio, 'createdAt' | 'updatedAt'>): Promise<void> {
    await q.query(
      `insert into business_profile (organization_id, business_key, display_name, legal_name, business_type, description,
        website, country, currency, timezone, language, customer_type, primary_objective, status, origen)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [p.organizationId, p.businessKey, p.displayName, p.legalName, p.businessType, p.description, p.website,
        p.country, p.currency, p.timezone, p.language, p.customerType, p.primaryObjective, p.status, p.origen],
    );
  }

  async insertarGobierno(q: Queryable, g: Omit<GobiernoNegocio, 'updatedAt'>): Promise<void> {
    await q.query(
      `insert into business_governance (organization_id, external_mutations, autonomous_spend, automatic_safety_pause, campaign_execution)
       values ($1,$2,$3,$4,$5) on conflict (organization_id) do nothing`,
      [g.organizationId, g.externalMutations, g.autonomousSpend, g.automaticSafetyPause, g.campaignExecution],
    );
  }

  /**
   * Cambia la POSTURA DE GOBIERNO del negocio. Sólo tres interruptores, y `autonomous_spend` NO está entre
   * ellos: que SOEC gaste por su cuenta no se enciende desde una pantalla de marketing — vive en el mandato
   * financiero y en una fase que todavía no existe.
   */
  async actualizarGobierno(
    q: Queryable,
    org: string,
    cambios: { readonly externalMutations?: boolean; readonly campaignExecution?: boolean; readonly automaticSafetyPause?: boolean },
  ): Promise<void> {
    await q.query(
      `insert into business_governance (organization_id, external_mutations, autonomous_spend, automatic_safety_pause, campaign_execution)
       values ($1, coalesce($2, false), false, coalesce($3, false), coalesce($4, false))
       on conflict (organization_id) do update set
         external_mutations = coalesce($2, business_governance.external_mutations),
         automatic_safety_pause = coalesce($3, business_governance.automatic_safety_pause),
         campaign_execution = coalesce($4, business_governance.campaign_execution),
         updated_at = now()`,
      [org, cambios.externalMutations ?? null, cambios.automaticSafetyPause ?? null, cambios.campaignExecution ?? null],
    );
  }

  async registrarAuditoria(q: Queryable, e: { organizationId: string; actor: string; action: string; changedFields?: Record<string, unknown> }): Promise<void> {
    await q.query('insert into business_audit (organization_id, actor, action, changed_fields) values ($1,$2,$3,$4)',
      [e.organizationId, e.actor, e.action, JSON.stringify(e.changedFields ?? {})]);
  }

  async perfil(org: string): Promise<PerfilNegocio | null> {
    const { rows } = await this.pool.query('select * from business_profile where organization_id = $1', [org]);
    return rows[0] ? aPerfil(rows[0] as Record<string, unknown>) : null;
  }

  async existeBusinessKey(q: Queryable, businessKey: string): Promise<boolean> {
    const { rows } = await q.query('select 1 from business_profile where business_key = $1', [businessKey]);
    return rows.length > 0;
  }

  /** Perfiles de las organizaciones indicadas (para listar sólo lo que el usuario puede ver). */
  async perfilesDe(orgs: readonly string[]): Promise<readonly PerfilNegocio[]> {
    if (orgs.length === 0) return [];
    const { rows } = await this.pool.query('select * from business_profile where organization_id = any($1::text[]) order by display_name', [orgs]);
    return rows.map((r: Record<string, unknown>) => aPerfil(r));
  }

  /** TODAS las organizaciones con perfil persistido: es el descubrimiento que usan los runtimes. */
  async listarTodos(): Promise<readonly PerfilNegocio[]> {
    const { rows } = await this.pool.query('select * from business_profile order by organization_id');
    return rows.map((r: Record<string, unknown>) => aPerfil(r));
  }

  async gobierno(org: string): Promise<GobiernoNegocio | null> {
    const { rows } = await this.pool.query('select * from business_governance where organization_id = $1', [org]);
    const r = rows[0] as Record<string, unknown> | undefined;
    return r
      ? {
          organizationId: String(r.organization_id), externalMutations: r.external_mutations === true,
          autonomousSpend: r.autonomous_spend === true, automaticSafetyPause: r.automatic_safety_pause === true,
          campaignExecution: r.campaign_execution === true, updatedAt: iso(r.updated_at),
        }
      : null;
  }

  /**
   * Edita el perfil. `q` permite hacerlo DENTRO de una transacción ajena (el asistente de incorporación
   * escribe perfil, oferta y territorio en un solo movimiento); sin `q` usa el pool, como siempre.
   */
  async actualizarPerfil(org: string, cambios: CambiosPerfil, q: Queryable = this.pool): Promise<PerfilNegocio | null> {
    const entradas = Object.entries(cambios).filter(([, v]) => v !== undefined) as Array<[keyof CambiosPerfil, unknown]>;
    if (entradas.length === 0) return this.perfil(org);
    const sets = entradas.map(([k], i) => `${COLUMNAS_EDITABLES[k]} = $${i + 2}`);
    const { rows } = await q.query(
      `update business_profile set ${sets.join(', ')}, updated_at = now() where organization_id = $1 returning *`,
      [org, ...entradas.map(([, v]) => v)],
    );
    return rows[0] ? aPerfil(rows[0] as Record<string, unknown>) : null;
  }

  async reemplazarObjetivosSecundarios(q: Queryable, org: string, objetivos: readonly string[]): Promise<void> {
    await q.query('delete from business_objective where organization_id = $1', [org]);
    for (const [i, texto] of objetivos.entries()) {
      await q.query('insert into business_objective (organization_id, orden, texto) values ($1,$2,$3)', [org, i, texto]);
    }
  }

  async objetivosSecundarios(org: string): Promise<readonly string[]> {
    const { rows } = await this.pool.query('select texto from business_objective where organization_id = $1 order by orden', [org]);
    return rows.map((r: { texto: string }) => r.texto);
  }

  async guardarOferta(q: Queryable, o: OfertaNegocio): Promise<void> {
    await q.query(
      `insert into business_offering (organization_id, id, slug, name, description, category, status, landing_url, priority, geographic_scope, advertising_eligibility, restrictions)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       on conflict (organization_id, id) do update set slug = excluded.slug, name = excluded.name, description = excluded.description,
         category = excluded.category, status = excluded.status, landing_url = excluded.landing_url, priority = excluded.priority,
         geographic_scope = excluded.geographic_scope, advertising_eligibility = excluded.advertising_eligibility, restrictions = excluded.restrictions`,
      [o.organizationId, o.id, o.slug, o.name, o.description, o.category, o.status, o.landingUrl, o.priority,
        o.geographicScope, o.advertisingEligibility, JSON.stringify(o.restrictions)],
    );
  }

  async oferta(org: string): Promise<readonly OfertaNegocio[]> {
    const { rows } = await this.pool.query('select * from business_offering where organization_id = $1 order by priority, name', [org]);
    return rows.map((r: Record<string, unknown>) => ({
      organizationId: String(r.organization_id), id: String(r.id), slug: String(r.slug), name: String(r.name),
      description: texto(r.description), category: texto(r.category), status: String(r.status) as OfertaNegocio['status'],
      landingUrl: texto(r.landing_url), priority: Number(r.priority), geographicScope: texto(r.geographic_scope),
      advertisingEligibility: String(r.advertising_eligibility) as OfertaNegocio['advertisingEligibility'],
      restrictions: lista(r.restrictions),
    }));
  }

  async guardarTerritorio(q: Queryable, t: TerritorioNegocio): Promise<void> {
    await q.query(
      `insert into business_geo_scope (organization_id, id, ambito, country, region, province, localities, criterio, nota)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       on conflict (organization_id, id) do update set ambito = excluded.ambito, country = excluded.country, region = excluded.region,
         province = excluded.province, localities = excluded.localities, criterio = excluded.criterio, nota = excluded.nota`,
      [t.organizationId, t.id, t.ambito, t.country, t.region, t.province, JSON.stringify(t.localities), t.criterio, t.nota],
    );
  }

  async territorios(org: string): Promise<readonly TerritorioNegocio[]> {
    const { rows } = await this.pool.query('select * from business_geo_scope where organization_id = $1 order by ambito, id', [org]);
    return rows.map((r: Record<string, unknown>) => ({
      organizationId: String(r.organization_id), id: String(r.id), ambito: String(r.ambito) as AmbitoGeografico,
      country: String(r.country), region: texto(r.region), province: texto(r.province),
      localities: lista(r.localities), criterio: texto(r.criterio), nota: texto(r.nota),
    }));
  }

  async guardarRestriccion(q: Queryable, x: RestriccionNegocio): Promise<void> {
    await q.query(
      `insert into business_restriction (organization_id, id, tipo, texto, alcance) values ($1,$2,$3,$4,$5)
       on conflict (organization_id, id) do update set tipo = excluded.tipo, texto = excluded.texto, alcance = excluded.alcance`,
      [x.organizationId, x.id, x.tipo, x.texto, x.alcance],
    );
  }

  /** Retira una restricción del negocio. Sólo de ESTE tenant: el `organization_id` va en el WHERE. */
  async borrarRestriccion(q: Queryable, org: string, id: string): Promise<void> {
    await q.query('delete from business_restriction where organization_id = $1 and id = $2', [org, id]);
  }

  async restricciones(org: string): Promise<readonly RestriccionNegocio[]> {
    const { rows } = await this.pool.query('select * from business_restriction where organization_id = $1 order by tipo, id', [org]);
    return rows.map((r: Record<string, unknown>) => ({
      organizationId: String(r.organization_id), id: String(r.id), tipo: String(r.tipo) as TipoRestriccion,
      texto: String(r.texto), alcance: texto(r.alcance),
    }));
  }

  /** Vista completa del negocio, tal como la consume la API y el panel. */
  async completo(org: string): Promise<NegocioCompleto | null> {
    const perfil = await this.perfil(org);
    if (perfil === null) return null;
    const [objetivosSecundarios, oferta, territorios, restricciones, gob] = await Promise.all([
      this.objetivosSecundarios(org), this.oferta(org), this.territorios(org), this.restricciones(org), this.gobierno(org),
    ]);
    const gobierno: GobiernoNegocio = gob ?? {
      organizationId: org, externalMutations: false, autonomousSpend: false,
      automaticSafetyPause: false, campaignExecution: false, updatedAt: perfil.updatedAt,
    };
    return { perfil, objetivosSecundarios, oferta, territorios, restricciones, gobierno };
  }
}
