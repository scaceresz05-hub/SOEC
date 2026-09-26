/**
 * apps/api · PLANIFICACIÓN DE CAMPAÑAS · esquema y repositorio del PLAN.
 *
 * Un plan es una PROPUESTA versionada, no una campaña. Vive en PostgreSQL porque hay que poder volver a ella,
 * compararla con la siguiente y explicar por qué decía lo que decía — incluso meses después.
 *
 * NO ES UNA CAMPAÑA EXTERNA. No existe ningún identificador de Google o Meta aquí, y esta fase no crea ninguno:
 * el plan termina en `DRAFT` / `NON_EXECUTABLE`. Lo que falta para poder ejecutar se dice campo por campo.
 *
 * Dos tablas: el plan y sus grupos. Las palabras y las negativas viven dentro de su grupo porque sólo tienen
 * sentido ahí; no son un catálogo global.
 */
import type { Pool, PoolClient } from 'pg';
import type { Migration } from '@soec/event-store/pg';
import type {
  DimensionPlan,
  EstadoPlan,
  EstrategiaPuja,
  EvidenciaDelPlan,
  RequisitoConversion,
  RequisitoCreativo,
  TipoConcordancia,
} from './investigacion-tipos';
import { ESTADOS_PLAN_VIGENTE } from './investigacion-tipos';

export type Queryable = Pool | PoolClient;

/** Una decisión del plan con su porqué y la evidencia que la sostiene. Sin esto, el plan no se puede discutir. */
export interface ExplicacionPlan {
  readonly decision: string;
  readonly porque: string;
  readonly evidenciaIds: readonly string[];
}

export interface PropuestaPresupuesto {
  /** Techo que declaró el dueño (Fase D). `null` ⇒ no declaró ninguno. */
  readonly techoDeclaradoClp: number | null;
  readonly modalidadTecho: string | null;
  /** Lo que el plan propone gastar por día. Sale del techo del dueño, JAMÁS de una cifra inventada. */
  readonly propuestoDiarioClp: number | null;
  /** Lo que costaría capturar toda la demanda observada. Es una DERIVACIÓN, no una recomendación. */
  readonly oportunidadDiariaClp: number | null;
  readonly costoPorClicEstimadoClp: number | null;
  /**
   * De dónde sale el importe propuesto:
   *  · HUMAN_MANDATE — lo limita el presupuesto que una persona autorizó (manda sobre todo lo demás);
   *  · USER_CEILING  — lo limita el techo que declaró el dueño en el alta, y cabe dentro del mandato;
   *  · NONE          — no hay ninguno de los dos, así que no se propone gasto.
   */
  readonly base: 'HUMAN_MANDATE' | 'USER_CEILING' | 'NONE';
  /** Tope diario autorizado por la persona, si existe. Ningún plan puede proponer más que esto. */
  readonly topeMandatoDiarioClp: number | null;
  readonly explicacion: string;
}

export interface PropuestaPuja {
  readonly estrategia: EstrategiaPuja;
  readonly techoCpcClp: number | null;
  readonly justificacion: string;
}

export interface EstructuraPropuesta {
  readonly tipo: 'UNA_CAMPANA_VARIOS_GRUPOS' | 'CAMPANA_POR_OFERTA';
  readonly justificacion: string;
}

export interface PalabraDelPlan {
  readonly termino: string;
  readonly concordancia: TipoConcordancia;
  readonly justificacion: string;
  /** Volumen observado. `null` = NO SE SABE. Nunca 0 por ausencia de datos: cero es una medición. */
  readonly volumenMensual: number | null;
  readonly origen: 'PROVIDER_DATA' | 'VERIFIED_SITE_SEEDS';
  readonly evidenciaDemanda: 'KNOWN' | 'UNKNOWN';
}

/** Borrador de anuncio de búsqueda. Sólo texto respaldado por el sitio; no se genera nada nuevo aquí. */
export interface AnuncioDelPlan {
  readonly ofertaSlug: string;
  readonly titulares: readonly string[];
  readonly descripciones: readonly string[];
  readonly respaldo: readonly string[];
}

export interface NegativaDelPlan {
  readonly termino: string;
  readonly motivo: string;
}

export interface GrupoDelPlan {
  readonly organizationId: string;
  readonly planId: string;
  readonly id: string;
  readonly nombre: string;
  readonly ofertaSlug: string;
  readonly landing: string | null;
  readonly palabras: readonly PalabraDelPlan[];
  readonly negativas: readonly NegativaDelPlan[];
  readonly justificacion: string;
}

export interface PlanCampania {
  readonly organizationId: string;
  readonly id: string;
  readonly version: number;
  readonly researchRunId: string;
  readonly estado: EstadoPlan;
  readonly canal: string;
  readonly objetivo: string;
  readonly ofertas: readonly string[];
  readonly geografia: {
    readonly targets: readonly { readonly nombre: string; readonly targetId: string | null; readonly tipo: string | null }[];
    readonly noEjecutables: readonly string[];
    readonly aproximaciones: readonly string[];
  };
  readonly presupuesto: PropuestaPresupuesto;
  readonly puja: PropuestaPuja;
  readonly estructura: EstructuraPropuesta;
  readonly requisitosCreativos: readonly RequisitoCreativo[];
  readonly requisitoConversion: RequisitoConversion;
  readonly prerequisitos: readonly string[];
  readonly readiness: Readonly<Record<DimensionPlan, boolean>>;
  readonly explicacion: readonly ExplicacionPlan[];
  /** Qué sostiene este plan y con qué límites. Se guarda con él: un plan sin su evidencia no se puede juzgar. */
  readonly evidencia: EvidenciaDelPlan;
  /** Borradores de anuncio respaldados por el sitio. Vacío si no hubo material verificado. */
  readonly anuncios: readonly AnuncioDelPlan[];
  readonly creadoEn: string;
  readonly staleDesde: string | null;
  readonly motivoStale: string | null;
}

export const planMigrations: ReadonlyArray<Migration> = [
  {
    id: '0001_campaign_plan',
    sql: `
      create table if not exists campaign_plan (
        organization_id       text not null references business_profile(organization_id) on delete cascade,
        id                    text not null,
        version               int  not null default 1,
        research_run_id       text not null,
        estado                text not null default 'DRAFT',
        canal                 text not null,
        objetivo              text not null,
        ofertas               jsonb not null default '[]'::jsonb,
        geografia             jsonb not null default '{}'::jsonb,
        presupuesto           jsonb not null default '{}'::jsonb,
        puja                  jsonb not null default '{}'::jsonb,
        estructura            jsonb not null default '{}'::jsonb,
        requisitos_creativos  jsonb not null default '[]'::jsonb,
        requisito_conversion  text not null,
        prerequisitos         jsonb not null default '[]'::jsonb,
        readiness             jsonb not null default '{}'::jsonb,
        explicacion           jsonb not null default '[]'::jsonb,
        creado_en             timestamptz not null default now(),
        stale_desde           timestamptz,
        motivo_stale          text,
        primary key (organization_id, id)
      );
      create index if not exists ix_campaign_plan_org on campaign_plan (organization_id, creado_en desc);

      create table if not exists campaign_plan_group (
        organization_id text not null,
        plan_id         text not null,
        id              text not null,
        nombre          text not null,
        oferta_slug     text not null,
        landing         text,
        palabras        jsonb not null default '[]'::jsonb,
        negativas       jsonb not null default '[]'::jsonb,
        justificacion   text not null default '',
        primary key (organization_id, plan_id, id)
      );
    `,
  },
  {
    /**
     * EVIDENCIA Y ANUNCIOS del plan. La evidencia va al lado del plan y no en un informe aparte: si mañana
     * alguien lee «proponemos gastar 2.500 al día», tiene que ver en la misma fila con qué se construyó eso.
     */
    id: '0002_plan_evidencia_y_anuncios',
    sql: `
      alter table campaign_plan add column if not exists evidencia jsonb not null default '{}'::jsonb;
      alter table campaign_plan add column if not exists anuncios  jsonb not null default '[]'::jsonb;
    `,
  },
];

const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : v === null || v === undefined ? null : String(v));
const texto = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const lista = (v: unknown): readonly string[] => (Array.isArray(v) ? v.map((x) => String(x)) : []);

function aPlan(r: Record<string, unknown>): PlanCampania {
  return {
    organizationId: String(r.organization_id),
    id: String(r.id),
    version: Number(r.version ?? 1),
    researchRunId: String(r.research_run_id),
    estado: String(r.estado) as EstadoPlan,
    canal: String(r.canal),
    objetivo: String(r.objetivo),
    ofertas: lista(r.ofertas),
    geografia: (r.geografia ?? { targets: [], noEjecutables: [], aproximaciones: [] }) as PlanCampania['geografia'],
    presupuesto: (r.presupuesto ?? {}) as PropuestaPresupuesto,
    puja: (r.puja ?? {}) as PropuestaPuja,
    estructura: (r.estructura ?? {}) as EstructuraPropuesta,
    requisitosCreativos: lista(r.requisitos_creativos) as readonly RequisitoCreativo[],
    requisitoConversion: String(r.requisito_conversion) as RequisitoConversion,
    prerequisitos: lista(r.prerequisitos),
    readiness: (r.readiness ?? {}) as Readonly<Record<DimensionPlan, boolean>>,
    explicacion: (Array.isArray(r.explicacion) ? r.explicacion : []) as readonly ExplicacionPlan[],
    evidencia: (r.evidencia !== null && typeof r.evidencia === 'object' && Object.keys(r.evidencia as object).length > 0
      ? r.evidencia
      : { demanda: 'UNKNOWN', investigacion: 'MISSING', confianza: 'LIMITED', origenKeywords: 'NONE', limitaciones: [] }) as EvidenciaDelPlan,
    anuncios: (Array.isArray(r.anuncios) ? r.anuncios : []) as readonly AnuncioDelPlan[],
    creadoEn: iso(r.creado_en) ?? '',
    staleDesde: iso(r.stale_desde),
    motivoStale: texto(r.motivo_stale),
  };
}

function aGrupo(r: Record<string, unknown>): GrupoDelPlan {
  return {
    organizationId: String(r.organization_id),
    planId: String(r.plan_id),
    id: String(r.id),
    nombre: String(r.nombre),
    ofertaSlug: String(r.oferta_slug),
    landing: texto(r.landing),
    palabras: (Array.isArray(r.palabras) ? r.palabras : []) as readonly PalabraDelPlan[],
    negativas: (Array.isArray(r.negativas) ? r.negativas : []) as readonly NegativaDelPlan[],
    justificacion: String(r.justificacion ?? ''),
  };
}

export class RepositorioPlan {
  constructor(private readonly pool: Pool) {}

  async guardarPlan(q: Queryable, p: PlanCampania): Promise<void> {
    await q.query(
      `insert into campaign_plan (organization_id, id, version, research_run_id, estado, canal, objetivo, ofertas,
         geografia, presupuesto, puja, estructura, requisitos_creativos, requisito_conversion, prerequisitos,
         readiness, explicacion, creado_en, stale_desde, motivo_stale, evidencia, anuncios)
       values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14,$15::jsonb,$16::jsonb,$17::jsonb,$18,$19,$20,$21::jsonb,$22::jsonb)
       on conflict (organization_id, id) do update set estado = excluded.estado, readiness = excluded.readiness,
         prerequisitos = excluded.prerequisitos, stale_desde = excluded.stale_desde, motivo_stale = excluded.motivo_stale,
         evidencia = excluded.evidencia, anuncios = excluded.anuncios`,
      [p.organizationId, p.id, p.version, p.researchRunId, p.estado, p.canal, p.objetivo, JSON.stringify(p.ofertas),
        JSON.stringify(p.geografia), JSON.stringify(p.presupuesto), JSON.stringify(p.puja), JSON.stringify(p.estructura),
        JSON.stringify(p.requisitosCreativos), p.requisitoConversion, JSON.stringify(p.prerequisitos),
        JSON.stringify(p.readiness), JSON.stringify(p.explicacion), p.creadoEn, p.staleDesde, p.motivoStale,
        JSON.stringify(p.evidencia), JSON.stringify(p.anuncios)],
    );
  }

  async guardarGrupo(q: Queryable, g: GrupoDelPlan): Promise<void> {
    await q.query(
      `insert into campaign_plan_group (organization_id, plan_id, id, nombre, oferta_slug, landing, palabras, negativas, justificacion)
       values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9)
       on conflict (organization_id, plan_id, id) do update set nombre = excluded.nombre, landing = excluded.landing,
         palabras = excluded.palabras, negativas = excluded.negativas, justificacion = excluded.justificacion`,
      [g.organizationId, g.planId, g.id, g.nombre, g.ofertaSlug, g.landing, JSON.stringify(g.palabras),
        JSON.stringify(g.negativas), g.justificacion],
    );
  }

  async plan(org: string, id: string): Promise<PlanCampania | null> {
    const { rows } = await this.pool.query('select * from campaign_plan where organization_id = $1 and id = $2', [org, id]);
    return rows[0] ? aPlan(rows[0] as Record<string, unknown>) : null;
  }

  async ultimoPlan(org: string): Promise<PlanCampania | null> {
    const { rows } = await this.pool.query('select * from campaign_plan where organization_id = $1 order by creado_en desc, version desc limit 1', [org]);
    return rows[0] ? aPlan(rows[0] as Record<string, unknown>) : null;
  }

  async planes(org: string, limite = 20): Promise<readonly PlanCampania[]> {
    const { rows } = await this.pool.query('select * from campaign_plan where organization_id = $1 order by creado_en desc limit $2', [org, limite]);
    return rows.map((r: Record<string, unknown>) => aPlan(r));
  }

  async grupos(org: string, planId: string): Promise<readonly GrupoDelPlan[]> {
    const { rows } = await this.pool.query('select * from campaign_plan_group where organization_id = $1 and plan_id = $2 order by id', [org, planId]);
    return rows.map((r: Record<string, unknown>) => aGrupo(r));
  }

  /** Marca planes como viejos sin borrarlos: el historial de lo que se propuso es parte de la explicación. */
  async marcarStale(q: Queryable, org: string, motivo: string, ahora: string): Promise<number> {
    const { rowCount } = await q.query(
      `update campaign_plan set estado = 'STALE', motivo_stale = $2, stale_desde = $3
       where organization_id = $1 and estado = any($4::text[])`,
      [org, motivo, ahora, [...ESTADOS_PLAN_VIGENTE]],
    );
    return rowCount ?? 0;
  }

  /** Versión siguiente para una organización: los planes no se sobrescriben, se suceden. */
  async siguienteVersion(org: string): Promise<number> {
    const { rows } = await this.pool.query('select coalesce(max(version),0)::int as v from campaign_plan where organization_id = $1', [org]);
    return Number((rows[0] as { v: number }).v) + 1;
  }
}
