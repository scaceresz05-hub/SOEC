/**
 * apps/api · POLÍTICA DE EVALUACIÓN COMO DATO · esquema y repositorio.
 *
 * SEIS TABLAS, cada valor con UN solo hogar:
 *   · `business_evaluation_policy`  — identidad del objetivo, contexto para decidir, horizonte y los pocos
 *                                     parámetros de optimización que no son umbral (cooldown, variación máxima).
 *   · `business_kpi`               — los indicadores, como DATOS (sirven a una clínica, un SaaS o una tienda).
 *   · `business_conversion_event`  — qué acción de un cliente cuenta, y en qué orden.
 *   · `business_evaluation_rule`   — umbrales: éxito, alerta, pausa, escalamiento y mínimos de evidencia.
 *   · `business_autonomy_limits`   — topes duros de lo que SOEC puede hacer por su cuenta.
 *   · `business_channel_rule`      — canales permitidos y prohibidos.
 *
 * LO QUE NO SE DUPLICA (se REFERENCIA): el territorio vive en `business_geo_scope`, los productos y sus
 * prioridades en `business_offering`, las restricciones y claims en `business_restriction`, el permiso para
 * mutar o gastar en `business_governance` y las cuentas en `business_connection`. La política no guarda una
 * segunda copia de nada de eso: cambiar el territorio en dos sitios es cómo se pierde la verdad.
 *
 * TAMPOCO ENTRA AQUÍ ninguna métrica observada. Esta tabla dice qué se busca, no qué pasó.
 */
import type { Pool, PoolClient } from 'pg';
import type { Migration } from '@soec/event-store/pg';
import type {
  Comparador,
  DireccionKpi,
  EstadoDato,
  MetricaRegla,
  ModoCanal,
  ProcedenciaValor,
  RolMetrica,
  TipoKpi,
  TipoRegla,
  UnidadKpi,
} from './politica-tipos';

export type Queryable = Pool | PoolClient;

export interface PoliticaEvaluacion {
  readonly organizationId: string;
  /** Identidad TÉCNICA del objetivo (la usan las evaluaciones y los streams). No es el texto comercial. */
  readonly objectiveId: string;
  /** Objetivo en lenguaje de negocio. `null` ⇒ se lee el del perfil comercial; nunca se inventa. */
  readonly objectiveText: string | null;
  /** Contexto que el Director necesita para razonar sobre ESTE negocio. */
  readonly businessContext: string | null;
  readonly vocabulary: readonly string[];
  readonly evaluationHorizonDays: number | null;
  /**
   * Gasto que el negocio reconoce como autorizado, para detectar anomalías. `null` = SOEC OBSERVA el gasto
   * pero NO es la autoridad del presupuesto. Declararlo no autoriza gastar: eso vive en el gobierno.
   */
  readonly authorizedSpendClp: number | null;
  readonly maxBudgetVariationPct: number | null;
  readonly cooldownDays: number | null;
  readonly scalingRequiresApproval: boolean;
  readonly protectedCampaigns: readonly string[];
  readonly nonModifiableActivities: readonly string[];
  readonly notes: string | null;
  readonly origen: 'UI' | 'MIGRACION';
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Kpi {
  readonly organizationId: string;
  readonly id: string;
  readonly rol: RolMetrica;
  /** Clave estable del indicador (`contactos`, `tasa_conversion`, `cpa`, `roas`…). */
  readonly clave: string;
  readonly displayName: string;
  readonly tipo: TipoKpi;
  readonly unidad: UnidadKpi;
  readonly direccion: DireccionKpi;
  /** Evento de conversión sobre el que se calcula, si aplica. */
  readonly eventKey: string | null;
  readonly targetValue: number | null;
  readonly baselineValue: number | null;
  readonly tolerance: number | null;
  readonly estado: EstadoDato;
  /** De dónde salió la meta: la persona, un punto de partida del sistema, lo aprendido o nada. */
  readonly procedencia: ProcedenciaValor;
  readonly nota: string | null;
  readonly orden: number;
}

export interface EventoConversion {
  readonly organizationId: string;
  readonly eventKey: string;
  readonly rol: RolMetrica;
  readonly orden: number;
  readonly displayName: string | null;
  readonly nota: string | null;
}

export interface ReglaEvaluacion {
  readonly organizationId: string;
  readonly id: string;
  readonly tipo: TipoRegla;
  readonly metrica: MetricaRegla;
  readonly comparador: Comparador;
  /** `null` con estado `UNKNOWN` significa «este negocio no ha fijado el valor», no cero. */
  readonly valor: number | null;
  readonly estado: EstadoDato;
  /** De dónde salió el umbral. Un default del sistema NUNCA se presenta como decisión del negocio. */
  readonly procedencia: ProcedenciaValor;
  readonly nota: string | null;
}

/** Topes de lo que SOEC puede hacer por su cuenta. NO es el presupuesto del negocio. */
export interface LimitesAutonomiaPersistidos {
  readonly organizationId: string;
  readonly maxDailyBudgetClp: number | null;
  readonly maxCpcClp: number | null;
  readonly maxVariationPct: number | null;
  readonly maxChangesPerDay: number | null;
  readonly cooldownHours: number | null;
  readonly minTermImpressionsForNegative: number | null;
  /** Patrones que el negocio considera fuera de su oferta. Única fuente de «irrelevancia». */
  readonly irrelevancePatterns: readonly string[];
  readonly updatedAt: string;
}

export interface ReglaCanal {
  readonly organizationId: string;
  readonly canal: string;
  readonly modo: ModoCanal;
  readonly nota: string | null;
}

export interface PoliticaCompleta {
  readonly politica: PoliticaEvaluacion | null;
  readonly kpis: readonly Kpi[];
  readonly eventos: readonly EventoConversion[];
  readonly reglas: readonly ReglaEvaluacion[];
  readonly limites: LimitesAutonomiaPersistidos | null;
  readonly canales: readonly ReglaCanal[];
}

export const politicaMigrations: ReadonlyArray<Migration> = [
  {
    id: '0001_evaluation_policy_as_data',
    sql: `
      create table if not exists business_evaluation_policy (
        organization_id            text primary key references business_profile(organization_id) on delete cascade,
        objective_id               text not null,
        objective_text             text,
        business_context           text,
        vocabulary                 jsonb not null default '[]'::jsonb,
        evaluation_horizon_days    int,
        authorized_spend_clp       numeric,
        max_budget_variation_pct   numeric,
        cooldown_days              int,
        scaling_requires_approval  boolean not null default true,
        protected_campaigns        jsonb not null default '[]'::jsonb,
        non_modifiable_activities  jsonb not null default '[]'::jsonb,
        notes                      text,
        origen                     text not null default 'UI',
        created_at                 timestamptz not null default now(),
        updated_at                 timestamptz not null default now()
      );

      create table if not exists business_kpi (
        organization_id text not null references business_profile(organization_id) on delete cascade,
        id              text not null,
        rol             text not null,
        clave           text not null,
        display_name    text not null,
        tipo            text not null,
        unidad          text not null,
        direccion       text not null,
        event_key       text,
        target_value    numeric,
        baseline_value  numeric,
        tolerance       numeric,
        estado          text not null default 'UNKNOWN',
        nota            text,
        orden           int  not null default 100,
        primary key (organization_id, id)
      );
      create index if not exists ix_business_kpi_rol on business_kpi (organization_id, rol);

      create table if not exists business_conversion_event (
        organization_id text not null references business_profile(organization_id) on delete cascade,
        event_key       text not null,
        rol             text not null,
        orden           int  not null default 100,
        display_name    text,
        nota            text,
        primary key (organization_id, event_key)
      );

      create table if not exists business_evaluation_rule (
        organization_id text not null references business_profile(organization_id) on delete cascade,
        id              text not null,
        tipo            text not null,
        metrica         text not null,
        comparador      text not null,
        valor           numeric,
        estado          text not null default 'UNKNOWN',
        nota            text,
        primary key (organization_id, id)
      );
      create index if not exists ix_business_rule_tipo on business_evaluation_rule (organization_id, tipo);

      create table if not exists business_autonomy_limits (
        organization_id                    text primary key references business_profile(organization_id) on delete cascade,
        max_daily_budget_clp               numeric,
        max_cpc_clp                        numeric,
        max_variation_pct                  numeric,
        max_changes_per_day                int,
        cooldown_hours                     int,
        min_term_impressions_for_negative  int,
        irrelevance_patterns               jsonb not null default '[]'::jsonb,
        updated_at                         timestamptz not null default now()
      );

      create table if not exists business_channel_rule (
        organization_id text not null references business_profile(organization_id) on delete cascade,
        canal           text not null,
        modo            text not null,
        nota            text,
        primary key (organization_id, canal)
      );
    `,
  },
  {
    // Fase D: PROCEDENCIA de cada valor de política. Un punto de partida del sistema y una decisión del
    // negocio no pueden verse igual; y lo que nadie fijó tiene que poder decirse sin inventar un número.
    id: '0002_procedencia_de_valores',
    sql: `
      alter table business_kpi add column if not exists procedencia text not null default 'USER_DEFINED';
      alter table business_evaluation_rule add column if not exists procedencia text not null default 'USER_DEFINED';
      -- Lo que vino del módulo TypeScript histórico se marca como tal (no como decisión reciente de nadie).
      update business_kpi k set procedencia = 'MIGRATED'
        where procedencia = 'USER_DEFINED'
          and exists (select 1 from business_evaluation_policy p where p.organization_id = k.organization_id and p.origen = 'MIGRACION');
      update business_evaluation_rule r set procedencia = 'MIGRATED'
        where procedencia = 'USER_DEFINED'
          and exists (select 1 from business_evaluation_policy p where p.organization_id = r.organization_id and p.origen = 'MIGRACION');
    `,
  },
];

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v ?? ''));
const texto = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const lista = (v: unknown): readonly string[] => (Array.isArray(v) ? v.map((x) => String(x)) : []);
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function aPolitica(r: Record<string, unknown>): PoliticaEvaluacion {
  return {
    organizationId: String(r.organization_id),
    objectiveId: String(r.objective_id),
    objectiveText: texto(r.objective_text),
    businessContext: texto(r.business_context),
    vocabulary: lista(r.vocabulary),
    evaluationHorizonDays: num(r.evaluation_horizon_days),
    authorizedSpendClp: num(r.authorized_spend_clp),
    maxBudgetVariationPct: num(r.max_budget_variation_pct),
    cooldownDays: num(r.cooldown_days),
    scalingRequiresApproval: r.scaling_requires_approval !== false,
    protectedCampaigns: lista(r.protected_campaigns),
    nonModifiableActivities: lista(r.non_modifiable_activities),
    notes: texto(r.notes),
    origen: String(r.origen ?? 'UI') === 'MIGRACION' ? 'MIGRACION' : 'UI',
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

const aKpi = (r: Record<string, unknown>): Kpi => ({
  organizationId: String(r.organization_id),
  id: String(r.id),
  rol: String(r.rol) as RolMetrica,
  clave: String(r.clave),
  displayName: String(r.display_name),
  tipo: String(r.tipo) as TipoKpi,
  unidad: String(r.unidad) as UnidadKpi,
  direccion: String(r.direccion) as DireccionKpi,
  eventKey: texto(r.event_key),
  targetValue: num(r.target_value),
  baselineValue: num(r.baseline_value),
  tolerance: num(r.tolerance),
  estado: String(r.estado) as EstadoDato,
  procedencia: String(r.procedencia ?? 'USER_DEFINED') as ProcedenciaValor,
  nota: texto(r.nota),
  orden: Number(r.orden ?? 100),
});

const aEvento = (r: Record<string, unknown>): EventoConversion => ({
  organizationId: String(r.organization_id),
  eventKey: String(r.event_key),
  rol: String(r.rol) as RolMetrica,
  orden: Number(r.orden ?? 100),
  displayName: texto(r.display_name),
  nota: texto(r.nota),
});

const aRegla = (r: Record<string, unknown>): ReglaEvaluacion => ({
  organizationId: String(r.organization_id),
  id: String(r.id),
  tipo: String(r.tipo) as TipoRegla,
  metrica: String(r.metrica) as MetricaRegla,
  comparador: String(r.comparador) as Comparador,
  valor: num(r.valor),
  estado: String(r.estado) as EstadoDato,
  procedencia: String(r.procedencia ?? 'USER_DEFINED') as ProcedenciaValor,
  nota: texto(r.nota),
});

const aLimites = (r: Record<string, unknown>): LimitesAutonomiaPersistidos => ({
  organizationId: String(r.organization_id),
  maxDailyBudgetClp: num(r.max_daily_budget_clp),
  maxCpcClp: num(r.max_cpc_clp),
  maxVariationPct: num(r.max_variation_pct),
  maxChangesPerDay: num(r.max_changes_per_day),
  cooldownHours: num(r.cooldown_hours),
  minTermImpressionsForNegative: num(r.min_term_impressions_for_negative),
  irrelevancePatterns: lista(r.irrelevance_patterns),
  updatedAt: iso(r.updated_at),
});

const aCanal = (r: Record<string, unknown>): ReglaCanal => ({
  organizationId: String(r.organization_id),
  canal: String(r.canal),
  modo: String(r.modo) as ModoCanal,
  nota: texto(r.nota),
});

/** Campos de la política que una edición puede cambiar. `objectiveId` no: es identidad de evaluación. */
export interface CambiosPolitica {
  readonly objectiveText?: string | null;
  readonly businessContext?: string | null;
  readonly vocabulary?: readonly string[];
  readonly evaluationHorizonDays?: number | null;
  readonly authorizedSpendClp?: number | null;
  readonly maxBudgetVariationPct?: number | null;
  readonly cooldownDays?: number | null;
  readonly scalingRequiresApproval?: boolean;
  readonly protectedCampaigns?: readonly string[];
  readonly nonModifiableActivities?: readonly string[];
  readonly notes?: string | null;
}

const COLUMNAS: Record<keyof CambiosPolitica, string> = {
  objectiveText: 'objective_text', businessContext: 'business_context', vocabulary: 'vocabulary',
  evaluationHorizonDays: 'evaluation_horizon_days', authorizedSpendClp: 'authorized_spend_clp',
  maxBudgetVariationPct: 'max_budget_variation_pct', cooldownDays: 'cooldown_days',
  scalingRequiresApproval: 'scaling_requires_approval', protectedCampaigns: 'protected_campaigns',
  nonModifiableActivities: 'non_modifiable_activities', notes: 'notes',
};
const JSONB: ReadonlySet<string> = new Set(['vocabulary', 'protected_campaigns', 'non_modifiable_activities']);

export class RepositorioPolitica {
  constructor(private readonly pool: Pool) {}

  async crearSiFalta(q: Queryable, p: Omit<PoliticaEvaluacion, 'createdAt' | 'updatedAt'>): Promise<boolean> {
    const { rowCount } = await q.query(
      `insert into business_evaluation_policy (organization_id, objective_id, objective_text, business_context,
         vocabulary, evaluation_horizon_days, authorized_spend_clp, max_budget_variation_pct, cooldown_days,
         scaling_requires_approval, protected_campaigns, non_modifiable_activities, notes, origen)
       values ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14)
       on conflict (organization_id) do nothing`,
      [p.organizationId, p.objectiveId, p.objectiveText, p.businessContext, JSON.stringify(p.vocabulary),
        p.evaluationHorizonDays, p.authorizedSpendClp, p.maxBudgetVariationPct, p.cooldownDays,
        p.scalingRequiresApproval, JSON.stringify(p.protectedCampaigns), JSON.stringify(p.nonModifiableActivities),
        p.notes, p.origen],
    );
    return (rowCount ?? 0) > 0;
  }

  async politica(org: string): Promise<PoliticaEvaluacion | null> {
    const { rows } = await this.pool.query('select * from business_evaluation_policy where organization_id = $1', [org]);
    return rows[0] ? aPolitica(rows[0] as Record<string, unknown>) : null;
  }

  async actualizarPolitica(q: Queryable, org: string, cambios: CambiosPolitica): Promise<void> {
    const entradas = Object.entries(cambios).filter(([, v]) => v !== undefined) as Array<[keyof CambiosPolitica, unknown]>;
    if (entradas.length === 0) return;
    const sets = entradas.map(([k], i) => {
      const col = COLUMNAS[k];
      return `${col} = $${i + 2}${JSONB.has(col) ? '::jsonb' : ''}`;
    });
    const valores = entradas.map(([k, v]) => (JSONB.has(COLUMNAS[k]) ? JSON.stringify(v ?? []) : v));
    await q.query(
      `update business_evaluation_policy set ${sets.join(', ')}, updated_at = now() where organization_id = $1`,
      [org, ...valores],
    );
  }

  // ── KPI ─────────────────────────────────────────────────────────────────────────────────────────

  async guardarKpi(q: Queryable, k: Kpi): Promise<void> {
    await q.query(
      `insert into business_kpi (organization_id, id, rol, clave, display_name, tipo, unidad, direccion,
         event_key, target_value, baseline_value, tolerance, estado, procedencia, nota, orden)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       on conflict (organization_id, id) do update set rol = excluded.rol, clave = excluded.clave,
         display_name = excluded.display_name, tipo = excluded.tipo, unidad = excluded.unidad,
         direccion = excluded.direccion, event_key = excluded.event_key, target_value = excluded.target_value,
         baseline_value = excluded.baseline_value, tolerance = excluded.tolerance, estado = excluded.estado,
         procedencia = excluded.procedencia, nota = excluded.nota, orden = excluded.orden`,
      [k.organizationId, k.id, k.rol, k.clave, k.displayName, k.tipo, k.unidad, k.direccion, k.eventKey,
        k.targetValue, k.baselineValue, k.tolerance, k.estado, k.procedencia, k.nota, k.orden],
    );
  }

  async kpis(org: string): Promise<readonly Kpi[]> {
    // `rol` ascendente pone PRIMARY antes que SECONDARY ('PRIMARY' < 'SECONDARY'): el principal va primero.
    const { rows } = await this.pool.query('select * from business_kpi where organization_id = $1 order by rol asc, orden, id', [org]);
    return rows.map((r: Record<string, unknown>) => aKpi(r));
  }

  async borrarKpi(q: Queryable, org: string, id: string): Promise<void> {
    await q.query('delete from business_kpi where organization_id = $1 and id = $2', [org, id]);
  }

  // ── EVENTOS ─────────────────────────────────────────────────────────────────────────────────────

  async guardarEvento(q: Queryable, e: EventoConversion): Promise<void> {
    await q.query(
      `insert into business_conversion_event (organization_id, event_key, rol, orden, display_name, nota)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (organization_id, event_key) do update set rol = excluded.rol, orden = excluded.orden,
         display_name = excluded.display_name, nota = excluded.nota`,
      [e.organizationId, e.eventKey, e.rol, e.orden, e.displayName, e.nota],
    );
  }

  async eventos(org: string): Promise<readonly EventoConversion[]> {
    const { rows } = await this.pool.query('select * from business_conversion_event where organization_id = $1 order by rol asc, orden, event_key', [org]);
    return rows.map((r: Record<string, unknown>) => aEvento(r));
  }

  async borrarEvento(q: Queryable, org: string, eventKey: string): Promise<void> {
    await q.query('delete from business_conversion_event where organization_id = $1 and event_key = $2', [org, eventKey]);
  }

  // ── REGLAS ──────────────────────────────────────────────────────────────────────────────────────

  async guardarRegla(q: Queryable, r: ReglaEvaluacion): Promise<void> {
    await q.query(
      `insert into business_evaluation_rule (organization_id, id, tipo, metrica, comparador, valor, estado, procedencia, nota)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       on conflict (organization_id, id) do update set tipo = excluded.tipo, metrica = excluded.metrica,
         comparador = excluded.comparador, valor = excluded.valor, estado = excluded.estado,
         procedencia = excluded.procedencia, nota = excluded.nota`,
      [r.organizationId, r.id, r.tipo, r.metrica, r.comparador, r.valor, r.estado, r.procedencia, r.nota],
    );
  }

  async reglas(org: string): Promise<readonly ReglaEvaluacion[]> {
    const { rows } = await this.pool.query('select * from business_evaluation_rule where organization_id = $1 order by tipo, id', [org]);
    return rows.map((r: Record<string, unknown>) => aRegla(r));
  }

  async borrarRegla(q: Queryable, org: string, id: string): Promise<void> {
    await q.query('delete from business_evaluation_rule where organization_id = $1 and id = $2', [org, id]);
  }

  // ── LÍMITES Y CANALES ───────────────────────────────────────────────────────────────────────────

  async guardarLimites(q: Queryable, l: Omit<LimitesAutonomiaPersistidos, 'updatedAt'>): Promise<void> {
    await q.query(
      `insert into business_autonomy_limits (organization_id, max_daily_budget_clp, max_cpc_clp, max_variation_pct,
         max_changes_per_day, cooldown_hours, min_term_impressions_for_negative, irrelevance_patterns)
       values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
       on conflict (organization_id) do update set max_daily_budget_clp = excluded.max_daily_budget_clp,
         max_cpc_clp = excluded.max_cpc_clp, max_variation_pct = excluded.max_variation_pct,
         max_changes_per_day = excluded.max_changes_per_day, cooldown_hours = excluded.cooldown_hours,
         min_term_impressions_for_negative = excluded.min_term_impressions_for_negative,
         irrelevance_patterns = excluded.irrelevance_patterns, updated_at = now()`,
      [l.organizationId, l.maxDailyBudgetClp, l.maxCpcClp, l.maxVariationPct, l.maxChangesPerDay,
        l.cooldownHours, l.minTermImpressionsForNegative, JSON.stringify(l.irrelevancePatterns)],
    );
  }

  /** Alta que no pisa lo existente: la usa la migración. */
  async crearLimitesSiFaltan(q: Queryable, l: Omit<LimitesAutonomiaPersistidos, 'updatedAt'>): Promise<boolean> {
    const { rowCount } = await q.query(
      `insert into business_autonomy_limits (organization_id, max_daily_budget_clp, max_cpc_clp, max_variation_pct,
         max_changes_per_day, cooldown_hours, min_term_impressions_for_negative, irrelevance_patterns)
       values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) on conflict (organization_id) do nothing`,
      [l.organizationId, l.maxDailyBudgetClp, l.maxCpcClp, l.maxVariationPct, l.maxChangesPerDay,
        l.cooldownHours, l.minTermImpressionsForNegative, JSON.stringify(l.irrelevancePatterns)],
    );
    return (rowCount ?? 0) > 0;
  }

  async limites(org: string): Promise<LimitesAutonomiaPersistidos | null> {
    const { rows } = await this.pool.query('select * from business_autonomy_limits where organization_id = $1', [org]);
    return rows[0] ? aLimites(rows[0] as Record<string, unknown>) : null;
  }

  async guardarCanal(q: Queryable, c: ReglaCanal): Promise<void> {
    await q.query(
      `insert into business_channel_rule (organization_id, canal, modo, nota) values ($1,$2,$3,$4)
       on conflict (organization_id, canal) do update set modo = excluded.modo, nota = excluded.nota`,
      [c.organizationId, c.canal, c.modo, c.nota],
    );
  }

  async canales(org: string): Promise<readonly ReglaCanal[]> {
    const { rows } = await this.pool.query('select * from business_channel_rule where organization_id = $1 order by canal', [org]);
    return rows.map((r: Record<string, unknown>) => aCanal(r));
  }

  async borrarCanal(q: Queryable, org: string, canal: string): Promise<void> {
    await q.query('delete from business_channel_rule where organization_id = $1 and canal = $2', [org, canal]);
  }

  /** Vista completa de la política de UNA organización. */
  async completa(org: string): Promise<PoliticaCompleta> {
    const [politica, kpis, eventos, reglas, limites, canales] = await Promise.all([
      this.politica(org), this.kpis(org), this.eventos(org), this.reglas(org), this.limites(org), this.canales(org),
    ]);
    return { politica, kpis, eventos, reglas, limites, canales };
  }

  /** Políticas de TODAS las organizaciones, para la proyección del runtime (una consulta por tabla). */
  async todas(): Promise<ReadonlyMap<string, PoliticaCompleta>> {
    const [pol, kpis, ev, reglas, lim, can] = await Promise.all([
      this.pool.query('select * from business_evaluation_policy'),
      this.pool.query('select * from business_kpi order by rol asc, orden, id'),
      this.pool.query('select * from business_conversion_event order by rol asc, orden, event_key'),
      this.pool.query('select * from business_evaluation_rule order by tipo, id'),
      this.pool.query('select * from business_autonomy_limits'),
      this.pool.query('select * from business_channel_rule order by canal'),
    ]);
    const mapa = new Map<string, PoliticaCompleta>();
    const base = (org: string): PoliticaCompleta => {
      const actual = mapa.get(org);
      if (actual) return actual;
      const nuevo: PoliticaCompleta = { politica: null, kpis: [], eventos: [], reglas: [], limites: null, canales: [] };
      mapa.set(org, nuevo);
      return nuevo;
    };
    const mutar = (org: string, cambio: Partial<PoliticaCompleta>): void => {
      mapa.set(org, { ...base(org), ...cambio });
    };
    for (const r of pol.rows as Record<string, unknown>[]) mutar(String(r.organization_id), { politica: aPolitica(r) });
    for (const r of kpis.rows as Record<string, unknown>[]) {
      const org = String(r.organization_id);
      mutar(org, { kpis: [...base(org).kpis, aKpi(r)] });
    }
    for (const r of ev.rows as Record<string, unknown>[]) {
      const org = String(r.organization_id);
      mutar(org, { eventos: [...base(org).eventos, aEvento(r)] });
    }
    for (const r of reglas.rows as Record<string, unknown>[]) {
      const org = String(r.organization_id);
      mutar(org, { reglas: [...base(org).reglas, aRegla(r)] });
    }
    for (const r of lim.rows as Record<string, unknown>[]) mutar(String(r.organization_id), { limites: aLimites(r) });
    for (const r of can.rows as Record<string, unknown>[]) {
      const org = String(r.organization_id);
      mutar(org, { canales: [...base(org).canales, aCanal(r)] });
    }
    return mapa;
  }
}
