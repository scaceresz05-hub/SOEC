/**
 * apps/api · EJECUCIÓN DE CAMPAÑAS · esquema y repositorios.
 *
 * Seis tablas, y cada una existe por una razón incómoda:
 *
 *  · `campaign_execution_request`  la petición es una ENTIDAD con su paquete CONGELADO. Sin esto, «ejecutar»
 *     sería un efecto secundario irrepetible y no se podría decir qué se creó ni con qué autorización.
 *  · `campaign_execution_step`     el libro de ejecución. Es lo que permite reanudar sin duplicar: cada paso
 *     lleva una clave de idempotencia y el identificador externo que devolvió la plataforma.
 *  · `conversion_action_mapping`   la identidad estable (organización + proveedor + evento) que evita crear
 *     «WhatsApp CP 2» y «WhatsApp CP 3» a fuerza de reintentos.
 *  · `tracking_state`              distingue acción creada, medición instalada y medición verificada.
 *  · `creative_asset`              los textos de anuncio que una persona aprobó. Sin aprobación no hay anuncio.
 *  · `execution_reconciliation`    lo que la plataforma dice que existe, comparado con lo que SOEC pidió.
 *
 * NINGUNA de estas tablas puede activar una campaña: no existe un campo para ello.
 */
import type { Pool, PoolClient } from 'pg';
import type { Migration } from '@soec/event-store/pg';
import type { PaqueteDeEjecucion } from './paquete';
import type {
  EstadoAsset,
  EstadoEjecucion,
  EstadoMedicion,
  EstadoVerificacion,
  PasoEjecucion,
  ProveedorEjecucion,
  Reconciliacion,
  ResultadoPaso,
  ResultadoPrerrequisito,
  RolConversion,
  TipoAsset,
  TipoConversionComercial,
  SemanticaValor,
} from './ejecucion-tipos';

export type Queryable = Pool | PoolClient;

export interface AutorizacionEjecucion {
  readonly actor: string;
  readonly autorizadoEn: string;
  readonly accion: string;
  readonly mandatoId: string;
  readonly mandatoTopeMinor: number;
  readonly mandatoMoneda: string;
  readonly modoOperativo: string;
}

export interface PeticionEjecucion {
  readonly organizationId: string;
  readonly id: string;
  readonly proveedor: ProveedorEjecucion;
  readonly planId: string;
  readonly planVersion: number;
  readonly paqueteHash: string;
  readonly estado: EstadoEjecucion;
  readonly actor: string;
  readonly solicitadoEn: string;
  /** El paquete CONGELADO. Se guarda entero: es lo que se ejecutó, no lo que hoy diría el sistema. */
  readonly paquete: PaqueteDeEjecucion;
  readonly prerrequisitos: readonly ResultadoPrerrequisito[];
  readonly autorizacion: AutorizacionEjecucion | null;
  /** Identificadores externos creados, por tipo (`campaign`, `campaignBudget`, `adGroup`…). */
  readonly recursosExternos: Readonly<Record<string, readonly string[]>>;
  readonly reconciliacion: Reconciliacion | null;
  readonly motivo: string | null;
  readonly actualizadoEn: string;
}

export interface PasoRegistrado {
  readonly organizationId: string;
  readonly requestId: string;
  readonly paso: PasoEjecucion;
  readonly clave: string;
  readonly resultado: ResultadoPaso;
  readonly recursoExterno: string | null;
  readonly providerRequestId: string | null;
  readonly detalle: Record<string, unknown>;
  readonly at: string;
}

export interface MapeoConversion {
  readonly organizationId: string;
  readonly proveedor: ProveedorEjecucion;
  readonly eventKey: string;
  readonly tipo: TipoConversionComercial;
  readonly rol: RolConversion;
  readonly nombreExterno: string;
  readonly externalId: string | null;
  readonly externalLabel: string | null;
  readonly semanticaValor: SemanticaValor;
  readonly valor: number | null;
  readonly estado: EstadoMedicion;
  readonly verificacion: EstadoVerificacion;
  readonly verificadaEn: string | null;
  readonly actualizadoEn: string;
}

export interface EstadoDeMedicion {
  readonly organizationId: string;
  readonly proveedor: ProveedorEjecucion;
  readonly eventKey: string;
  readonly estado: EstadoMedicion;
  readonly metodo: string | null;
  readonly detalle: string | null;
  readonly actualizadoEn: string;
}

export interface AssetCreativo {
  readonly organizationId: string;
  readonly id: string;
  readonly ofertaSlug: string;
  readonly tipo: TipoAsset;
  readonly texto: string;
  readonly url: string | null;
  readonly estado: EstadoAsset;
  readonly aprobadoPor: string | null;
  readonly aprobadoEn: string | null;
  readonly creadoEn: string;
}

export const ejecucionMigrations: ReadonlyArray<Migration> = [
  {
    id: '0001_campaign_execution',
    sql: `
      create table if not exists campaign_execution_request (
        organization_id   text not null references business_profile(organization_id) on delete cascade,
        id                text not null,
        proveedor         text not null default 'GOOGLE_ADS',
        plan_id           text not null,
        plan_version      int  not null,
        paquete_hash      text not null,
        estado            text not null default 'DRAFT',
        actor             text not null,
        solicitado_en     timestamptz not null default now(),
        paquete           jsonb not null,
        prerrequisitos    jsonb not null default '[]'::jsonb,
        autorizacion      jsonb,
        recursos_externos jsonb not null default '{}'::jsonb,
        reconciliacion    jsonb,
        motivo            text,
        actualizado_en    timestamptz not null default now(),
        primary key (organization_id, id)
      );
      create index if not exists ix_cer_org on campaign_execution_request (organization_id, solicitado_en desc);
      -- IDEMPOTENCIA ESTRUCTURAL: un mismo paquete no puede tener dos peticiones vivas. Reintentar reutiliza.
      create unique index if not exists ux_cer_paquete_vivo on campaign_execution_request (organization_id, paquete_hash)
        where estado <> 'CANCELLED' and estado <> 'FAILED';

      create table if not exists campaign_execution_step (
        organization_id     text not null,
        request_id          text not null,
        paso                text not null,
        clave               text not null,
        resultado           text not null,
        recurso_externo     text,
        provider_request_id text,
        detalle             jsonb not null default '{}'::jsonb,
        at                  timestamptz not null default now(),
        primary key (organization_id, request_id, paso, clave)
      );
      create index if not exists ix_ces_request on campaign_execution_step (organization_id, request_id, at);

      create table if not exists conversion_action_mapping (
        organization_id  text not null references business_profile(organization_id) on delete cascade,
        proveedor        text not null,
        event_key        text not null,
        tipo             text not null,
        rol              text not null default 'PRIMARY',
        nombre_externo   text not null,
        external_id      text,
        external_label   text,
        semantica_valor  text not null default 'SIN_VALOR',
        valor            numeric,
        estado           text not null default 'ACTION_MISSING',
        verificacion     text not null default 'NO_VERIFICADA',
        verificada_en    timestamptz,
        actualizado_en   timestamptz not null default now(),
        primary key (organization_id, proveedor, event_key)
      );

      create table if not exists tracking_state (
        organization_id text not null references business_profile(organization_id) on delete cascade,
        proveedor       text not null,
        event_key       text not null,
        estado          text not null default 'TRACKING_MISSING',
        metodo          text,
        detalle         text,
        actualizado_en  timestamptz not null default now(),
        primary key (organization_id, proveedor, event_key)
      );

      create table if not exists creative_asset (
        organization_id text not null references business_profile(organization_id) on delete cascade,
        id              text not null,
        oferta_slug     text not null,
        tipo            text not null,
        texto           text not null,
        url             text,
        estado          text not null default 'PROPUESTO',
        aprobado_por    text,
        aprobado_en     timestamptz,
        creado_en       timestamptz not null default now(),
        primary key (organization_id, id)
      );
      create index if not exists ix_asset_oferta on creative_asset (organization_id, oferta_slug, tipo);

      create table if not exists execution_reconciliation (
        organization_id text not null,
        request_id      text not null,
        at              timestamptz not null default now(),
        coincide        boolean not null,
        divergencias    jsonb not null default '[]'::jsonb,
        remoto          jsonb not null default '{}'::jsonb,
        primary key (organization_id, request_id, at)
      );
    `,
  },
];

const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : v === null || v === undefined ? null : String(v));
const texto = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

function aPeticion(r: Record<string, unknown>): PeticionEjecucion {
  return {
    organizationId: String(r.organization_id),
    id: String(r.id),
    proveedor: String(r.proveedor) as ProveedorEjecucion,
    planId: String(r.plan_id),
    planVersion: Number(r.plan_version),
    paqueteHash: String(r.paquete_hash),
    estado: String(r.estado) as EstadoEjecucion,
    actor: String(r.actor),
    solicitadoEn: iso(r.solicitado_en) ?? '',
    paquete: r.paquete as PaqueteDeEjecucion,
    prerrequisitos: (Array.isArray(r.prerrequisitos) ? r.prerrequisitos : []) as readonly ResultadoPrerrequisito[],
    autorizacion: (r.autorizacion ?? null) as AutorizacionEjecucion | null,
    recursosExternos: (r.recursos_externos ?? {}) as Readonly<Record<string, readonly string[]>>,
    reconciliacion: (r.reconciliacion ?? null) as Reconciliacion | null,
    motivo: texto(r.motivo),
    actualizadoEn: iso(r.actualizado_en) ?? '',
  };
}

function aMapeo(r: Record<string, unknown>): MapeoConversion {
  return {
    organizationId: String(r.organization_id),
    proveedor: String(r.proveedor) as ProveedorEjecucion,
    eventKey: String(r.event_key),
    tipo: String(r.tipo) as TipoConversionComercial,
    rol: String(r.rol) as RolConversion,
    nombreExterno: String(r.nombre_externo),
    externalId: texto(r.external_id),
    externalLabel: texto(r.external_label),
    semanticaValor: String(r.semantica_valor) as SemanticaValor,
    valor: r.valor === null || r.valor === undefined ? null : Number(r.valor),
    estado: String(r.estado) as EstadoMedicion,
    verificacion: String(r.verificacion) as EstadoVerificacion,
    verificadaEn: iso(r.verificada_en),
    actualizadoEn: iso(r.actualizado_en) ?? '',
  };
}

function aAsset(r: Record<string, unknown>): AssetCreativo {
  return {
    organizationId: String(r.organization_id),
    id: String(r.id),
    ofertaSlug: String(r.oferta_slug),
    tipo: String(r.tipo) as TipoAsset,
    texto: String(r.texto),
    url: texto(r.url),
    estado: String(r.estado) as EstadoAsset,
    aprobadoPor: texto(r.aprobado_por),
    aprobadoEn: iso(r.aprobado_en),
    creadoEn: iso(r.creado_en) ?? '',
  };
}

export class RepositorioEjecucion {
  constructor(private readonly pool: Pool) {}

  // ── PETICIONES ────────────────────────────────────────────────────────────────────────────────

  async crear(q: Queryable, p: PeticionEjecucion): Promise<void> {
    await q.query(
      `insert into campaign_execution_request (organization_id, id, proveedor, plan_id, plan_version, paquete_hash,
         estado, actor, solicitado_en, paquete, prerrequisitos, autorizacion, recursos_externos, reconciliacion, motivo, actualizado_en)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb,$15,$16)`,
      [p.organizationId, p.id, p.proveedor, p.planId, p.planVersion, p.paqueteHash, p.estado, p.actor,
        p.solicitadoEn, JSON.stringify(p.paquete), JSON.stringify(p.prerrequisitos),
        p.autorizacion === null ? null : JSON.stringify(p.autorizacion), JSON.stringify(p.recursosExternos),
        p.reconciliacion === null ? null : JSON.stringify(p.reconciliacion), p.motivo, p.actualizadoEn],
    );
  }

  /**
   * Cambia estado y campos derivados. NUNCA toca el paquete: una petición congelada no se re-congela, y el
   * `where` sobre el estado esperado evita pisar una ejecución que avanzó en otro proceso.
   */
  async actualizar(
    q: Queryable,
    org: string,
    id: string,
    cambios: {
      readonly estado?: EstadoEjecucion;
      readonly prerrequisitos?: readonly ResultadoPrerrequisito[];
      readonly autorizacion?: AutorizacionEjecucion | null;
      readonly recursosExternos?: Readonly<Record<string, readonly string[]>>;
      readonly reconciliacion?: Reconciliacion | null;
      readonly motivo?: string | null;
      readonly ahora: string;
    },
  ): Promise<void> {
    await q.query(
      `update campaign_execution_request set
         estado = coalesce($3, estado),
         prerrequisitos = coalesce($4::jsonb, prerrequisitos),
         autorizacion = case when $5::text = 'set' then $6::jsonb else autorizacion end,
         recursos_externos = coalesce($7::jsonb, recursos_externos),
         reconciliacion = case when $8::text = 'set' then $9::jsonb else reconciliacion end,
         motivo = case when $10::text = 'set' then $11 else motivo end,
         actualizado_en = $12
       where organization_id = $1 and id = $2`,
      [org, id, cambios.estado ?? null,
        cambios.prerrequisitos === undefined ? null : JSON.stringify(cambios.prerrequisitos),
        cambios.autorizacion === undefined ? 'keep' : 'set',
        cambios.autorizacion === undefined || cambios.autorizacion === null ? null : JSON.stringify(cambios.autorizacion),
        cambios.recursosExternos === undefined ? null : JSON.stringify(cambios.recursosExternos),
        cambios.reconciliacion === undefined ? 'keep' : 'set',
        cambios.reconciliacion === undefined || cambios.reconciliacion === null ? null : JSON.stringify(cambios.reconciliacion),
        cambios.motivo === undefined ? 'keep' : 'set', cambios.motivo ?? null, cambios.ahora],
    );
  }

  async peticion(org: string, id: string): Promise<PeticionEjecucion | null> {
    const { rows } = await this.pool.query('select * from campaign_execution_request where organization_id = $1 and id = $2', [org, id]);
    return rows[0] ? aPeticion(rows[0] as Record<string, unknown>) : null;
  }

  async porPaquete(org: string, hash: string): Promise<PeticionEjecucion | null> {
    const { rows } = await this.pool.query(
      `select * from campaign_execution_request where organization_id = $1 and paquete_hash = $2
       and estado not in ('CANCELLED','FAILED') order by solicitado_en desc limit 1`, [org, hash]);
    return rows[0] ? aPeticion(rows[0] as Record<string, unknown>) : null;
  }

  async ultima(org: string): Promise<PeticionEjecucion | null> {
    const { rows } = await this.pool.query('select * from campaign_execution_request where organization_id = $1 order by solicitado_en desc limit 1', [org]);
    return rows[0] ? aPeticion(rows[0] as Record<string, unknown>) : null;
  }

  async peticiones(org: string, limite = 20): Promise<readonly PeticionEjecucion[]> {
    const { rows } = await this.pool.query('select * from campaign_execution_request where organization_id = $1 order by solicitado_en desc limit $2', [org, limite]);
    return rows.map((r: Record<string, unknown>) => aPeticion(r));
  }

  // ── LIBRO DE EJECUCIÓN ────────────────────────────────────────────────────────────────────────

  /** Registra un paso. Si ya existía esa clave, NO se duplica: el primer registro manda. */
  async registrarPaso(q: Queryable, p: PasoRegistrado): Promise<void> {
    await q.query(
      `insert into campaign_execution_step (organization_id, request_id, paso, clave, resultado, recurso_externo,
         provider_request_id, detalle, at)
       values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
       on conflict (organization_id, request_id, paso, clave) do nothing`,
      [p.organizationId, p.requestId, p.paso, p.clave, p.resultado, p.recursoExterno, p.providerRequestId,
        JSON.stringify(p.detalle), p.at],
    );
  }

  async pasos(org: string, requestId: string): Promise<readonly PasoRegistrado[]> {
    const { rows } = await this.pool.query('select * from campaign_execution_step where organization_id = $1 and request_id = $2 order by at, paso', [org, requestId]);
    return rows.map((r: Record<string, unknown>) => ({
      organizationId: String(r.organization_id), requestId: String(r.request_id), paso: String(r.paso) as PasoEjecucion,
      clave: String(r.clave), resultado: String(r.resultado) as ResultadoPaso, recursoExterno: texto(r.recurso_externo),
      providerRequestId: texto(r.provider_request_id), detalle: (r.detalle ?? {}) as Record<string, unknown>,
      at: iso(r.at) ?? '',
    }));
  }

  /** ¿Este paso ya se completó con éxito? Es la pregunta que evita crear dos veces lo mismo. */
  async pasoCompletado(org: string, requestId: string, paso: PasoEjecucion, clave: string): Promise<PasoRegistrado | null> {
    const { rows } = await this.pool.query(
      `select * from campaign_execution_step where organization_id = $1 and request_id = $2 and paso = $3
       and clave = $4 and resultado <> 'FAILED' limit 1`, [org, requestId, paso, clave]);
    const r = rows[0] as Record<string, unknown> | undefined;
    return r === undefined ? null : {
      organizationId: String(r.organization_id), requestId: String(r.request_id), paso: String(r.paso) as PasoEjecucion,
      clave: String(r.clave), resultado: String(r.resultado) as ResultadoPaso, recursoExterno: texto(r.recurso_externo),
      providerRequestId: texto(r.provider_request_id), detalle: (r.detalle ?? {}) as Record<string, unknown>,
      at: iso(r.at) ?? '',
    };
  }

  // ── CONVERSIONES Y MEDICIÓN ───────────────────────────────────────────────────────────────────

  async guardarMapeo(q: Queryable, m: MapeoConversion): Promise<void> {
    await q.query(
      `insert into conversion_action_mapping (organization_id, proveedor, event_key, tipo, rol, nombre_externo,
         external_id, external_label, semantica_valor, valor, estado, verificacion, verificada_en, actualizado_en)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       on conflict (organization_id, proveedor, event_key) do update set tipo = excluded.tipo, rol = excluded.rol,
         nombre_externo = excluded.nombre_externo,
         -- El id externo NUNCA se borra por un reintento: si ya hay acción creada, se conserva.
         external_id = coalesce(excluded.external_id, conversion_action_mapping.external_id),
         external_label = coalesce(excluded.external_label, conversion_action_mapping.external_label),
         semantica_valor = excluded.semantica_valor, valor = excluded.valor, estado = excluded.estado,
         verificacion = excluded.verificacion, verificada_en = coalesce(excluded.verificada_en, conversion_action_mapping.verificada_en),
         actualizado_en = excluded.actualizado_en`,
      [m.organizationId, m.proveedor, m.eventKey, m.tipo, m.rol, m.nombreExterno, m.externalId, m.externalLabel,
        m.semanticaValor, m.valor, m.estado, m.verificacion, m.verificadaEn, m.actualizadoEn],
    );
  }

  async mapeo(org: string, proveedor: ProveedorEjecucion, eventKey: string): Promise<MapeoConversion | null> {
    const { rows } = await this.pool.query(
      'select * from conversion_action_mapping where organization_id = $1 and proveedor = $2 and event_key = $3',
      [org, proveedor, eventKey]);
    return rows[0] ? aMapeo(rows[0] as Record<string, unknown>) : null;
  }

  async mapeos(org: string, proveedor: ProveedorEjecucion): Promise<readonly MapeoConversion[]> {
    const { rows } = await this.pool.query(
      'select * from conversion_action_mapping where organization_id = $1 and proveedor = $2 order by rol, event_key',
      [org, proveedor]);
    return rows.map((r: Record<string, unknown>) => aMapeo(r));
  }

  async guardarMedicion(q: Queryable, e: EstadoDeMedicion): Promise<void> {
    await q.query(
      `insert into tracking_state (organization_id, proveedor, event_key, estado, metodo, detalle, actualizado_en)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (organization_id, proveedor, event_key) do update set estado = excluded.estado,
         metodo = excluded.metodo, detalle = excluded.detalle, actualizado_en = excluded.actualizado_en`,
      [e.organizationId, e.proveedor, e.eventKey, e.estado, e.metodo, e.detalle, e.actualizadoEn],
    );
  }

  async medicion(org: string, proveedor: ProveedorEjecucion): Promise<readonly EstadoDeMedicion[]> {
    const { rows } = await this.pool.query('select * from tracking_state where organization_id = $1 and proveedor = $2 order by event_key', [org, proveedor]);
    return rows.map((r: Record<string, unknown>) => ({
      organizationId: String(r.organization_id), proveedor: String(r.proveedor) as ProveedorEjecucion,
      eventKey: String(r.event_key), estado: String(r.estado) as EstadoMedicion, metodo: texto(r.metodo),
      detalle: texto(r.detalle), actualizadoEn: iso(r.actualizado_en) ?? '',
    }));
  }

  // ── MATERIAL DE ANUNCIOS ──────────────────────────────────────────────────────────────────────

  async guardarAsset(q: Queryable, a: AssetCreativo): Promise<void> {
    await q.query(
      `insert into creative_asset (organization_id, id, oferta_slug, tipo, texto, url, estado, aprobado_por, aprobado_en, creado_en)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       on conflict (organization_id, id) do update set texto = excluded.texto, url = excluded.url,
         estado = excluded.estado, aprobado_por = excluded.aprobado_por, aprobado_en = excluded.aprobado_en`,
      [a.organizationId, a.id, a.ofertaSlug, a.tipo, a.texto, a.url, a.estado, a.aprobadoPor, a.aprobadoEn, a.creadoEn],
    );
  }

  async assets(org: string): Promise<readonly AssetCreativo[]> {
    const { rows } = await this.pool.query('select * from creative_asset where organization_id = $1 order by oferta_slug, tipo, creado_en', [org]);
    return rows.map((r: Record<string, unknown>) => aAsset(r));
  }

  async borrarAsset(q: Queryable, org: string, id: string): Promise<void> {
    await q.query('delete from creative_asset where organization_id = $1 and id = $2', [org, id]);
  }

  // ── RECONCILIACIÓN ────────────────────────────────────────────────────────────────────────────

  async guardarReconciliacion(q: Queryable, org: string, requestId: string, r: Reconciliacion, remoto: Record<string, unknown>): Promise<void> {
    await q.query(
      `insert into execution_reconciliation (organization_id, request_id, at, coincide, divergencias, remoto)
       values ($1,$2,$3,$4,$5::jsonb,$6::jsonb)
       on conflict (organization_id, request_id, at) do nothing`,
      [org, requestId, r.observadoEn, r.coincide, JSON.stringify(r.divergencias), JSON.stringify(remoto)],
    );
  }

  async reconciliaciones(org: string, requestId: string, limite = 10): Promise<readonly Reconciliacion[]> {
    const { rows } = await this.pool.query(
      'select * from execution_reconciliation where organization_id = $1 and request_id = $2 order by at desc limit $3',
      [org, requestId, limite]);
    return rows.map((r: Record<string, unknown>) => ({
      coincide: r.coincide === true,
      divergencias: (Array.isArray(r.divergencias) ? r.divergencias : []) as Reconciliacion['divergencias'],
      observadoEn: iso(r.at) ?? '',
    }));
  }
}
