/**
 * apps/api · INVESTIGACIÓN AUTÓNOMA · esquema y repositorio.
 *
 * Una corrida de investigación es una ENTIDAD, no un efecto secundario: se puede consultar, repetir, comparar y
 * envejecer. Y cada cosa que descubre queda con su fuente y su fecha, porque un número sin procedencia no sirve
 * para decidir nada.
 *
 * SIETE TABLAS:
 *   · `research_run`        la corrida: alcance pedido, estado, fuentes usadas y fallidas, frescura.
 *   · `research_evidence`   el dato bruto con su clase, su fuente, su período y su geografía.
 *   · `research_finding`    la frase con sentido de negocio, apuntando a las evidencias que la sostienen.
 *   · `research_keyword`    términos con sus métricas observadas, su intención y su elegibilidad.
 *   · `research_geo_target` qué parte del territorio comercial es ejecutable en la plataforma.
 *   · `research_channel`    veredicto por canal, con motivos.
 *   · `research_landing`    compatibilidad de cada oferta prioritaria con su landing.
 *
 * Y una octava, de vida más larga que una corrida: `research_competitor`.
 *
 * NADA DE ESTO ES POLÍTICA DEL NEGOCIO. La investigación observa; decidir qué se hace con lo observado es del
 * planificador, y autorizar el gasto sigue siendo de una persona.
 */
import type { Pool, PoolClient } from 'pg';
import type { Migration } from '@soec/event-store/pg';
import type {
  AreaImpacto,
  CanalEvaluado,
  ClaseEvidencia,
  Confianza,
  ElegibilidadTermino,
  EstadoDeFuente,
  EstadoInvestigacion,
  EstadoLanding,
  FuenteEvidencia,
  IntencionBusqueda,
  MetodoClasificacion,
  TipoHallazgo,
  VeredictoCanal,
} from './investigacion-tipos';

export type Queryable = Pool | PoolClient;

export interface CorridaInvestigacion {
  readonly organizationId: string;
  readonly id: string;
  readonly estado: EstadoInvestigacion;
  /** Qué se pidió investigar (ofertas, territorio, canales). Se guarda para poder repetir lo mismo. */
  readonly alcance: Record<string, unknown>;
  readonly fuentes: readonly EstadoDeFuente[];
  readonly fallos: readonly string[];
  readonly frescuraHoras: number;
  readonly version: number;
  readonly motivoStale: string | null;
  readonly iniciadoEn: string;
  readonly completadoEn: string | null;
}

export interface Evidencia {
  readonly organizationId: string;
  readonly id: string;
  readonly runId: string;
  readonly clase: ClaseEvidencia;
  readonly fuente: FuenteEvidencia;
  /** Qué dice el dato, en una frase. El detalle numérico va en `datos`. */
  readonly statement: string;
  readonly datos: Record<string, unknown>;
  readonly periodo: string | null;
  readonly geografia: string | null;
  readonly observadoEn: string;
}

export interface Hallazgo {
  readonly organizationId: string;
  readonly id: string;
  readonly runId: string;
  readonly tipo: TipoHallazgo;
  readonly statement: string;
  readonly evidenciaIds: readonly string[];
  readonly confianza: Confianza;
  readonly areaImpacto: AreaImpacto;
  readonly descubiertoEn: string;
  readonly expiraEn: string | null;
}

export interface TerminoInvestigado {
  readonly organizationId: string;
  readonly id: string;
  readonly runId: string;
  readonly termino: string;
  readonly terminoNormalizado: string;
  readonly intencion: IntencionBusqueda;
  readonly intencionMetodo: MetodoClasificacion;
  readonly intencionConfianza: Confianza;
  readonly intencionEvidencia: string | null;
  readonly ofertaSlug: string | null;
  readonly geografia: string | null;
  readonly idioma: string;
  readonly metricas: Record<string, unknown>;
  readonly clase: ClaseEvidencia;
  readonly fuente: FuenteEvidencia;
  readonly elegibilidad: ElegibilidadTermino;
  readonly motivoExclusion: string | null;
  readonly observadoEn: string;
}

export interface GeoEjecutable {
  readonly organizationId: string;
  readonly id: string;
  readonly runId: string;
  readonly solicitado: string;
  readonly disponible: boolean;
  readonly targetId: string | null;
  readonly targetTipo: string | null;
  readonly nombreCanonico: string | null;
  readonly aproximacion: boolean;
  readonly riesgoDerrame: string;
}

export interface EvaluacionCanal {
  readonly organizationId: string;
  readonly runId: string;
  readonly canal: CanalEvaluado;
  readonly veredicto: VeredictoCanal;
  readonly motivos: readonly string[];
  readonly evidenciaIds: readonly string[];
}

export interface CompatibilidadLanding {
  readonly organizationId: string;
  readonly runId: string;
  readonly ofertaSlug: string;
  readonly estado: EstadoLanding;
  readonly url: string | null;
  readonly motivos: readonly string[];
}

export interface Competidor {
  readonly organizationId: string;
  readonly id: string;
  readonly nombre: string;
  readonly dominio: string;
  readonly evidencia: string;
  readonly metodoDescubrimiento: string;
  readonly observadoEn: string;
}

export const investigacionMigrations: ReadonlyArray<Migration> = [
  {
    id: '0001_autonomous_research',
    sql: `
      create table if not exists research_run (
        organization_id text not null references business_profile(organization_id) on delete cascade,
        id              text not null,
        estado          text not null default 'QUEUED',
        alcance         jsonb not null default '{}'::jsonb,
        fuentes         jsonb not null default '[]'::jsonb,
        fallos          jsonb not null default '[]'::jsonb,
        frescura_horas  int  not null default 168,
        version         int  not null default 1,
        motivo_stale    text,
        iniciado_en     timestamptz not null default now(),
        completado_en   timestamptz,
        primary key (organization_id, id)
      );
      create index if not exists ix_research_run_org on research_run (organization_id, iniciado_en desc);
      create index if not exists ix_research_run_estado on research_run (estado);

      create table if not exists research_evidence (
        organization_id text not null,
        id              text not null,
        run_id          text not null,
        clase           text not null,
        fuente          text not null,
        statement       text not null,
        datos           jsonb not null default '{}'::jsonb,
        periodo         text,
        geografia       text,
        observado_en    timestamptz not null default now(),
        primary key (organization_id, id)
      );
      create index if not exists ix_research_evidence_run on research_evidence (organization_id, run_id);

      create table if not exists research_finding (
        organization_id text not null,
        id              text not null,
        run_id          text not null,
        tipo            text not null,
        statement       text not null,
        evidencia_ids   jsonb not null default '[]'::jsonb,
        confianza       text not null,
        area_impacto    text not null,
        descubierto_en  timestamptz not null default now(),
        expira_en       timestamptz,
        primary key (organization_id, id)
      );
      create index if not exists ix_research_finding_run on research_finding (organization_id, run_id);

      create table if not exists research_keyword (
        organization_id     text not null,
        id                  text not null,
        run_id              text not null,
        termino             text not null,
        termino_normalizado text not null,
        intencion           text not null,
        intencion_metodo    text not null,
        intencion_confianza text not null,
        intencion_evidencia text,
        oferta_slug         text,
        geografia           text,
        idioma              text not null default 'es',
        metricas            jsonb not null default '{}'::jsonb,
        clase               text not null,
        fuente              text not null,
        elegibilidad        text not null,
        motivo_exclusion    text,
        observado_en        timestamptz not null default now(),
        primary key (organization_id, id)
      );
      create index if not exists ix_research_keyword_run on research_keyword (organization_id, run_id, elegibilidad);

      create table if not exists research_geo_target (
        organization_id  text not null,
        id               text not null,
        run_id           text not null,
        solicitado       text not null,
        disponible       boolean not null default false,
        target_id        text,
        target_tipo      text,
        nombre_canonico  text,
        aproximacion     boolean not null default false,
        riesgo_derrame   text not null default 'UNKNOWN',
        primary key (organization_id, id)
      );
      create index if not exists ix_research_geo_run on research_geo_target (organization_id, run_id);

      create table if not exists research_channel (
        organization_id text not null,
        run_id          text not null,
        canal           text not null,
        veredicto       text not null,
        motivos         jsonb not null default '[]'::jsonb,
        evidencia_ids   jsonb not null default '[]'::jsonb,
        primary key (organization_id, run_id, canal)
      );

      create table if not exists research_landing (
        organization_id text not null,
        run_id          text not null,
        oferta_slug     text not null,
        estado          text not null,
        url             text,
        motivos         jsonb not null default '[]'::jsonb,
        primary key (organization_id, run_id, oferta_slug)
      );

      create table if not exists research_competitor (
        organization_id       text not null references business_profile(organization_id) on delete cascade,
        id                    text not null,
        nombre                text not null,
        dominio               text not null,
        evidencia             text not null,
        metodo_descubrimiento text not null,
        observado_en          timestamptz not null default now(),
        primary key (organization_id, id)
      );
    `,
  },
];

const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : v === null || v === undefined ? null : String(v));
const texto = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const lista = (v: unknown): readonly string[] => (Array.isArray(v) ? v.map((x) => String(x)) : []);
const obj = (v: unknown): Record<string, unknown> => (v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {});

function aCorrida(r: Record<string, unknown>): CorridaInvestigacion {
  return {
    organizationId: String(r.organization_id),
    id: String(r.id),
    estado: String(r.estado) as EstadoInvestigacion,
    alcance: obj(r.alcance),
    fuentes: (Array.isArray(r.fuentes) ? r.fuentes : []) as readonly EstadoDeFuente[],
    fallos: lista(r.fallos),
    frescuraHoras: Number(r.frescura_horas ?? 168),
    version: Number(r.version ?? 1),
    motivoStale: texto(r.motivo_stale),
    iniciadoEn: iso(r.iniciado_en) ?? '',
    completadoEn: iso(r.completado_en),
  };
}

export class RepositorioInvestigacion {
  constructor(private readonly pool: Pool) {}

  // ── CORRIDAS ────────────────────────────────────────────────────────────────────────────────────

  async crearCorrida(q: Queryable, c: Omit<CorridaInvestigacion, 'iniciadoEn' | 'completadoEn'>): Promise<void> {
    await q.query(
      `insert into research_run (organization_id, id, estado, alcance, fuentes, fallos, frescura_horas, version, motivo_stale)
       values ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7,$8,$9)`,
      [c.organizationId, c.id, c.estado, JSON.stringify(c.alcance), JSON.stringify(c.fuentes), JSON.stringify(c.fallos),
        c.frescuraHoras, c.version, c.motivoStale],
    );
  }

  async actualizarCorrida(
    q: Queryable,
    org: string,
    id: string,
    cambios: { readonly estado?: EstadoInvestigacion; readonly fuentes?: readonly EstadoDeFuente[]; readonly fallos?: readonly string[]; readonly completadoEn?: string | null; readonly motivoStale?: string | null },
  ): Promise<void> {
    await q.query(
      `update research_run set
         estado = coalesce($3, estado),
         fuentes = coalesce($4::jsonb, fuentes),
         fallos = coalesce($5::jsonb, fallos),
         completado_en = coalesce($6::timestamptz, completado_en),
         motivo_stale = coalesce($7, motivo_stale)
       where organization_id = $1 and id = $2`,
      [org, id, cambios.estado ?? null, cambios.fuentes ? JSON.stringify(cambios.fuentes) : null,
        cambios.fallos ? JSON.stringify(cambios.fallos) : null, cambios.completadoEn ?? null, cambios.motivoStale ?? null],
    );
  }

  async corrida(org: string, id: string): Promise<CorridaInvestigacion | null> {
    const { rows } = await this.pool.query('select * from research_run where organization_id = $1 and id = $2', [org, id]);
    return rows[0] ? aCorrida(rows[0] as Record<string, unknown>) : null;
  }

  /** Última corrida de la organización, en cualquier estado. Es la que la interfaz muestra. */
  async ultimaCorrida(org: string): Promise<CorridaInvestigacion | null> {
    const { rows } = await this.pool.query('select * from research_run where organization_id = $1 order by iniciado_en desc limit 1', [org]);
    return rows[0] ? aCorrida(rows[0] as Record<string, unknown>) : null;
  }

  /** Última corrida APROVECHABLE (completa o parcial y no marcada como vieja). Base de la frescura. */
  async ultimaAprovechable(org: string): Promise<CorridaInvestigacion | null> {
    const { rows } = await this.pool.query(
      `select * from research_run where organization_id = $1 and estado in ('COMPLETE','PARTIAL')
       order by iniciado_en desc limit 1`,
      [org],
    );
    return rows[0] ? aCorrida(rows[0] as Record<string, unknown>) : null;
  }

  async corridas(org: string, limite = 20): Promise<readonly CorridaInvestigacion[]> {
    const { rows } = await this.pool.query('select * from research_run where organization_id = $1 order by iniciado_en desc limit $2', [org, limite]);
    return rows.map((r: Record<string, unknown>) => aCorrida(r));
  }

  /** Corridas en marcha en TODO el despliegue: gobierna la concurrencia (la investigación cuesta cuota). */
  async corridasEnMarcha(): Promise<number> {
    const { rows } = await this.pool.query("select count(*)::int as n from research_run where estado = 'RUNNING'");
    return Number((rows[0] as { n: number }).n);
  }

  /** Marca como vieja la investigación vigente cuando cambian los datos que la sostenían. */
  async marcarStale(q: Queryable, org: string, motivo: string): Promise<number> {
    const { rowCount } = await q.query(
      `update research_run set estado = 'STALE', motivo_stale = $2
       where organization_id = $1 and estado in ('COMPLETE','PARTIAL')`,
      [org, motivo],
    );
    return rowCount ?? 0;
  }

  // ── EVIDENCIA, HALLAZGOS Y DERIVADOS ────────────────────────────────────────────────────────────

  async guardarEvidencia(q: Queryable, e: Evidencia): Promise<void> {
    await q.query(
      `insert into research_evidence (organization_id, id, run_id, clase, fuente, statement, datos, periodo, geografia, observado_en)
       values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)
       -- Re-observar un dato lo ADSCRIBE A LA CORRIDA NUEVA y refresca su procedencia. Sin esto, una evidencia
       -- vista otra vez seguiría colgando de la corrida vieja y desaparecería de la investigación recién hecha.
       on conflict (organization_id, id) do update set run_id = excluded.run_id, clase = excluded.clase,
         fuente = excluded.fuente, statement = excluded.statement, datos = excluded.datos, periodo = excluded.periodo,
         geografia = excluded.geografia, observado_en = excluded.observado_en`,
      [e.organizationId, e.id, e.runId, e.clase, e.fuente, e.statement, JSON.stringify(e.datos), e.periodo, e.geografia, e.observadoEn],
    );
  }

  async evidencias(org: string, runId: string): Promise<readonly Evidencia[]> {
    const { rows } = await this.pool.query('select * from research_evidence where organization_id = $1 and run_id = $2 order by id', [org, runId]);
    return rows.map((r: Record<string, unknown>) => ({
      organizationId: String(r.organization_id), id: String(r.id), runId: String(r.run_id),
      clase: String(r.clase) as ClaseEvidencia, fuente: String(r.fuente) as FuenteEvidencia,
      statement: String(r.statement), datos: obj(r.datos), periodo: texto(r.periodo), geografia: texto(r.geografia),
      observadoEn: iso(r.observado_en) ?? '',
    }));
  }

  async guardarHallazgo(q: Queryable, h: Hallazgo): Promise<void> {
    await q.query(
      `insert into research_finding (organization_id, id, run_id, tipo, statement, evidencia_ids, confianza, area_impacto, descubierto_en, expira_en)
       values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10)
       on conflict (organization_id, id) do update set run_id = excluded.run_id, tipo = excluded.tipo,
         statement = excluded.statement, evidencia_ids = excluded.evidencia_ids, confianza = excluded.confianza,
         area_impacto = excluded.area_impacto, descubierto_en = excluded.descubierto_en, expira_en = excluded.expira_en`,
      [h.organizationId, h.id, h.runId, h.tipo, h.statement, JSON.stringify(h.evidenciaIds), h.confianza, h.areaImpacto,
        h.descubiertoEn, h.expiraEn],
    );
  }

  async hallazgos(org: string, runId: string): Promise<readonly Hallazgo[]> {
    const { rows } = await this.pool.query('select * from research_finding where organization_id = $1 and run_id = $2 order by area_impacto, id', [org, runId]);
    return rows.map((r: Record<string, unknown>) => ({
      organizationId: String(r.organization_id), id: String(r.id), runId: String(r.run_id),
      tipo: String(r.tipo) as TipoHallazgo, statement: String(r.statement), evidenciaIds: lista(r.evidencia_ids),
      confianza: String(r.confianza) as Confianza, areaImpacto: String(r.area_impacto) as AreaImpacto,
      descubiertoEn: iso(r.descubierto_en) ?? '', expiraEn: iso(r.expira_en),
    }));
  }

  async guardarTermino(q: Queryable, t: TerminoInvestigado): Promise<void> {
    await q.query(
      `insert into research_keyword (organization_id, id, run_id, termino, termino_normalizado, intencion, intencion_metodo,
         intencion_confianza, intencion_evidencia, oferta_slug, geografia, idioma, metricas, clase, fuente, elegibilidad,
         motivo_exclusion, observado_en)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16,$17,$18)
       on conflict (organization_id, id) do update set run_id = excluded.run_id, metricas = excluded.metricas,
         intencion = excluded.intencion, intencion_metodo = excluded.intencion_metodo,
         intencion_confianza = excluded.intencion_confianza, intencion_evidencia = excluded.intencion_evidencia,
         oferta_slug = excluded.oferta_slug, geografia = excluded.geografia, idioma = excluded.idioma,
         clase = excluded.clase, fuente = excluded.fuente, elegibilidad = excluded.elegibilidad,
         motivo_exclusion = excluded.motivo_exclusion, observado_en = excluded.observado_en`,
      [t.organizationId, t.id, t.runId, t.termino, t.terminoNormalizado, t.intencion, t.intencionMetodo,
        t.intencionConfianza, t.intencionEvidencia, t.ofertaSlug, t.geografia, t.idioma, JSON.stringify(t.metricas),
        t.clase, t.fuente, t.elegibilidad, t.motivoExclusion, t.observadoEn],
    );
  }

  async terminos(org: string, runId: string): Promise<readonly TerminoInvestigado[]> {
    const { rows } = await this.pool.query('select * from research_keyword where organization_id = $1 and run_id = $2 order by termino_normalizado', [org, runId]);
    return rows.map((r: Record<string, unknown>) => ({
      organizationId: String(r.organization_id), id: String(r.id), runId: String(r.run_id),
      termino: String(r.termino), terminoNormalizado: String(r.termino_normalizado),
      intencion: String(r.intencion) as IntencionBusqueda, intencionMetodo: String(r.intencion_metodo) as MetodoClasificacion,
      intencionConfianza: String(r.intencion_confianza) as Confianza, intencionEvidencia: texto(r.intencion_evidencia),
      ofertaSlug: texto(r.oferta_slug), geografia: texto(r.geografia), idioma: String(r.idioma ?? 'es'),
      metricas: obj(r.metricas), clase: String(r.clase) as ClaseEvidencia, fuente: String(r.fuente) as FuenteEvidencia,
      elegibilidad: String(r.elegibilidad) as ElegibilidadTermino, motivoExclusion: texto(r.motivo_exclusion),
      observadoEn: iso(r.observado_en) ?? '',
    }));
  }

  async guardarGeo(q: Queryable, g: GeoEjecutable): Promise<void> {
    await q.query(
      `insert into research_geo_target (organization_id, id, run_id, solicitado, disponible, target_id, target_tipo,
         nombre_canonico, aproximacion, riesgo_derrame)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       on conflict (organization_id, id) do update set run_id = excluded.run_id, disponible = excluded.disponible,
         target_id = excluded.target_id, target_tipo = excluded.target_tipo, nombre_canonico = excluded.nombre_canonico,
         aproximacion = excluded.aproximacion, riesgo_derrame = excluded.riesgo_derrame`,
      [g.organizationId, g.id, g.runId, g.solicitado, g.disponible, g.targetId, g.targetTipo, g.nombreCanonico,
        g.aproximacion, g.riesgoDerrame],
    );
  }

  async geos(org: string, runId: string): Promise<readonly GeoEjecutable[]> {
    const { rows } = await this.pool.query('select * from research_geo_target where organization_id = $1 and run_id = $2 order by solicitado', [org, runId]);
    return rows.map((r: Record<string, unknown>) => ({
      organizationId: String(r.organization_id), id: String(r.id), runId: String(r.run_id),
      solicitado: String(r.solicitado), disponible: r.disponible === true, targetId: texto(r.target_id),
      targetTipo: texto(r.target_tipo), nombreCanonico: texto(r.nombre_canonico), aproximacion: r.aproximacion === true,
      riesgoDerrame: String(r.riesgo_derrame ?? 'UNKNOWN'),
    }));
  }

  async guardarCanal(q: Queryable, c: EvaluacionCanal): Promise<void> {
    await q.query(
      `insert into research_channel (organization_id, run_id, canal, veredicto, motivos, evidencia_ids)
       values ($1,$2,$3,$4,$5::jsonb,$6::jsonb)
       on conflict (organization_id, run_id, canal) do update set veredicto = excluded.veredicto,
         motivos = excluded.motivos, evidencia_ids = excluded.evidencia_ids`,
      [c.organizationId, c.runId, c.canal, c.veredicto, JSON.stringify(c.motivos), JSON.stringify(c.evidenciaIds)],
    );
  }

  async canales(org: string, runId: string): Promise<readonly EvaluacionCanal[]> {
    const { rows } = await this.pool.query('select * from research_channel where organization_id = $1 and run_id = $2 order by canal', [org, runId]);
    return rows.map((r: Record<string, unknown>) => ({
      organizationId: String(r.organization_id), runId: String(r.run_id), canal: String(r.canal) as CanalEvaluado,
      veredicto: String(r.veredicto) as VeredictoCanal, motivos: lista(r.motivos), evidenciaIds: lista(r.evidencia_ids),
    }));
  }

  async guardarLanding(q: Queryable, l: CompatibilidadLanding): Promise<void> {
    await q.query(
      `insert into research_landing (organization_id, run_id, oferta_slug, estado, url, motivos)
       values ($1,$2,$3,$4,$5,$6::jsonb)
       on conflict (organization_id, run_id, oferta_slug) do update set estado = excluded.estado,
         url = excluded.url, motivos = excluded.motivos`,
      [l.organizationId, l.runId, l.ofertaSlug, l.estado, l.url, JSON.stringify(l.motivos)],
    );
  }

  async landings(org: string, runId: string): Promise<readonly CompatibilidadLanding[]> {
    const { rows } = await this.pool.query('select * from research_landing where organization_id = $1 and run_id = $2 order by oferta_slug', [org, runId]);
    return rows.map((r: Record<string, unknown>) => ({
      organizationId: String(r.organization_id), runId: String(r.run_id), ofertaSlug: String(r.oferta_slug),
      estado: String(r.estado) as EstadoLanding, url: texto(r.url), motivos: lista(r.motivos),
    }));
  }

  async guardarCompetidor(q: Queryable, c: Competidor): Promise<void> {
    await q.query(
      `insert into research_competitor (organization_id, id, nombre, dominio, evidencia, metodo_descubrimiento, observado_en)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (organization_id, id) do update set nombre = excluded.nombre, evidencia = excluded.evidencia,
         observado_en = excluded.observado_en`,
      [c.organizationId, c.id, c.nombre, c.dominio, c.evidencia, c.metodoDescubrimiento, c.observadoEn],
    );
  }

  async competidores(org: string): Promise<readonly Competidor[]> {
    const { rows } = await this.pool.query('select * from research_competitor where organization_id = $1 order by dominio', [org]);
    return rows.map((r: Record<string, unknown>) => ({
      organizationId: String(r.organization_id), id: String(r.id), nombre: String(r.nombre), dominio: String(r.dominio),
      evidencia: String(r.evidencia), metodoDescubrimiento: String(r.metodo_descubrimiento), observadoEn: iso(r.observado_en) ?? '',
    }));
  }
}
