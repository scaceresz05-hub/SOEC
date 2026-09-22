/**
 * apps/api · ONBOARDING INTELIGENTE · esquema y repositorio.
 *
 * TRES TABLAS, y ninguna guarda datos de negocio:
 *   · `business_onboarding`         — por dónde va la conversación: estado, paso actual, pasos resueltos.
 *   · `business_onboarding_answer`  — qué respondió (o qué se descubrió), con su procedencia y si está confirmado.
 *   · `business_website_insight`    — lo que se observó del PROPIO sitio del negocio, siempre como DISCOVERED.
 *
 * Más una cuarta que declara una intención, no una autorización:
 *   · `business_budget_intent`      — el techo de inversión que el dueño DECLARÓ. Guardar un techo no autoriza
 *                                     gastar: la autorización financiera es un mandato, y lo crea una persona
 *                                     en un acto aparte. El tope operativo duro sigue viviendo en
 *                                     `business_autonomy_limits` (su tabla canónica).
 *
 * Las respuestas se guardan además de traducirse porque el usuario tiene derecho a volver, ver lo que dijo y
 * corregirlo. Sin esto, «reanudar» sería volver a empezar.
 */
import type { Pool, PoolClient } from 'pg';
import type { Migration } from '@soec/event-store/pg';
import type {
  EstadoConfirmacion,
  EstadoOnboarding,
  ModalidadPresupuesto,
  PasoId,
  ProcedenciaDato,
} from './onboarding-tipos';

export type Queryable = Pool | PoolClient;

export interface EstadoOnboardingPersistido {
  readonly organizationId: string;
  readonly estado: EstadoOnboarding;
  readonly pasoActual: PasoId;
  readonly pasosCompletados: readonly PasoId[];
  readonly iniciadoEn: string;
  readonly actualizadoEn: string;
  readonly completadoEn: string | null;
  readonly reabiertoEn: string | null;
}

export interface RespuestaOnboarding {
  readonly organizationId: string;
  readonly pregunta: string;
  readonly valor: unknown;
  readonly procedencia: ProcedenciaDato;
  readonly confirmacion: EstadoConfirmacion;
  readonly actualizadoEn: string;
}

export interface ObservacionSitio {
  readonly organizationId: string;
  readonly url: string;
  readonly estado: 'OK' | 'UNREACHABLE' | 'NOT_HTTPS' | 'REJECTED' | 'ERROR';
  readonly httpStatus: number | null;
  readonly titulo: string | null;
  readonly metaDescription: string | null;
  /** Rutas internas detectadas en la portada (sólo del propio sitio). Nunca contenido de terceros. */
  readonly paginas: readonly string[];
  readonly enlacesInternos: number;
  readonly esHttps: boolean;
  readonly error: string | null;
  readonly inspeccionadoEn: string;
}

/** Techo declarado por el dueño. NO es una autorización de gasto (ver comentario de cabecera). */
export interface IntencionPresupuesto {
  readonly organizationId: string;
  readonly modalidad: ModalidadPresupuesto;
  readonly montoClp: number | null;
  readonly moneda: string;
  readonly declaradoPor: string;
  readonly declaradoEn: string;
}

export const onboardingMigrations: ReadonlyArray<Migration> = [
  {
    id: '0001_intelligent_onboarding',
    sql: `
      create table if not exists business_onboarding (
        organization_id    text primary key references business_profile(organization_id) on delete cascade,
        estado             text not null default 'IN_PROGRESS',
        paso_actual        text not null default 'negocio',
        pasos_completados  jsonb not null default '[]'::jsonb,
        iniciado_en        timestamptz not null default now(),
        actualizado_en     timestamptz not null default now(),
        completado_en      timestamptz,
        reabierto_en       timestamptz
      );

      create table if not exists business_onboarding_answer (
        organization_id text not null references business_profile(organization_id) on delete cascade,
        pregunta        text not null,
        valor           jsonb,
        procedencia     text not null default 'USER',
        confirmacion    text not null default 'USER_CONFIRMED',
        actualizado_en  timestamptz not null default now(),
        primary key (organization_id, pregunta)
      );

      create table if not exists business_website_insight (
        organization_id   text primary key references business_profile(organization_id) on delete cascade,
        url               text not null,
        estado            text not null,
        http_status       int,
        titulo            text,
        meta_description  text,
        paginas           jsonb not null default '[]'::jsonb,
        enlaces_internos  int not null default 0,
        es_https          boolean not null default false,
        error             text,
        inspeccionado_en  timestamptz not null default now()
      );

      create table if not exists business_budget_intent (
        organization_id text primary key references business_profile(organization_id) on delete cascade,
        modalidad       text not null,
        monto_clp       numeric,
        moneda          text not null default 'CLP',
        declarado_por   text not null,
        declarado_en    timestamptz not null default now()
      );
    `,
  },
];

const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : v === null || v === undefined ? null : String(v));
const texto = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const lista = (v: unknown): readonly string[] => (Array.isArray(v) ? v.map((x) => String(x)) : []);

function aEstado(r: Record<string, unknown>): EstadoOnboardingPersistido {
  return {
    organizationId: String(r.organization_id),
    estado: String(r.estado) as EstadoOnboarding,
    pasoActual: String(r.paso_actual) as PasoId,
    pasosCompletados: lista(r.pasos_completados) as readonly PasoId[],
    iniciadoEn: iso(r.iniciado_en) ?? '',
    actualizadoEn: iso(r.actualizado_en) ?? '',
    completadoEn: iso(r.completado_en),
    reabiertoEn: iso(r.reabierto_en),
  };
}

export class RepositorioOnboarding {
  constructor(private readonly pool: Pool) {}

  /** Crea el estado si no existe. Devuelve `true` sólo la primera vez (sirve para auditar el inicio). */
  async iniciarSiFalta(q: Queryable, org: string, pasoInicial: PasoId): Promise<boolean> {
    const { rowCount } = await q.query(
      `insert into business_onboarding (organization_id, estado, paso_actual) values ($1,'IN_PROGRESS',$2)
       on conflict (organization_id) do nothing`,
      [org, pasoInicial],
    );
    return (rowCount ?? 0) > 0;
  }

  async estado(org: string): Promise<EstadoOnboardingPersistido | null> {
    const { rows } = await this.pool.query('select * from business_onboarding where organization_id = $1', [org]);
    return rows[0] ? aEstado(rows[0] as Record<string, unknown>) : null;
  }

  async guardarProgreso(
    q: Queryable,
    org: string,
    cambios: { readonly estado?: EstadoOnboarding; readonly pasoActual?: PasoId; readonly pasosCompletados?: readonly PasoId[]; readonly completadoEn?: string | null; readonly reabiertoEn?: string | null },
  ): Promise<void> {
    await q.query(
      `update business_onboarding set
         estado = coalesce($2, estado),
         paso_actual = coalesce($3, paso_actual),
         pasos_completados = coalesce($4::jsonb, pasos_completados),
         completado_en = case when $5::boolean then $6::timestamptz else completado_en end,
         reabierto_en = coalesce($7::timestamptz, reabierto_en),
         actualizado_en = now()
       where organization_id = $1`,
      [
        org,
        cambios.estado ?? null,
        cambios.pasoActual ?? null,
        cambios.pasosCompletados ? JSON.stringify(cambios.pasosCompletados) : null,
        cambios.completadoEn !== undefined,
        cambios.completadoEn ?? null,
        cambios.reabiertoEn ?? null,
      ],
    );
  }

  async guardarRespuesta(q: Queryable, r: Omit<RespuestaOnboarding, 'actualizadoEn'>): Promise<void> {
    await q.query(
      `insert into business_onboarding_answer (organization_id, pregunta, valor, procedencia, confirmacion)
       values ($1,$2,$3::jsonb,$4,$5)
       on conflict (organization_id, pregunta) do update set valor = excluded.valor,
         procedencia = excluded.procedencia, confirmacion = excluded.confirmacion, actualizado_en = now()`,
      [r.organizationId, r.pregunta, JSON.stringify(r.valor ?? null), r.procedencia, r.confirmacion],
    );
  }

  async respuestas(org: string): Promise<readonly RespuestaOnboarding[]> {
    const { rows } = await this.pool.query('select * from business_onboarding_answer where organization_id = $1 order by pregunta', [org]);
    return rows.map((r: Record<string, unknown>) => ({
      organizationId: String(r.organization_id),
      pregunta: String(r.pregunta),
      valor: r.valor ?? null,
      procedencia: String(r.procedencia) as ProcedenciaDato,
      confirmacion: String(r.confirmacion) as EstadoConfirmacion,
      actualizadoEn: iso(r.actualizado_en) ?? '',
    }));
  }

  async guardarObservacionSitio(q: Queryable, o: Omit<ObservacionSitio, 'inspeccionadoEn'>): Promise<void> {
    await q.query(
      `insert into business_website_insight (organization_id, url, estado, http_status, titulo, meta_description,
         paginas, enlaces_internos, es_https, error, inspeccionado_en)
       values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10, now())
       on conflict (organization_id) do update set url = excluded.url, estado = excluded.estado,
         http_status = excluded.http_status, titulo = excluded.titulo, meta_description = excluded.meta_description,
         paginas = excluded.paginas, enlaces_internos = excluded.enlaces_internos, es_https = excluded.es_https,
         error = excluded.error, inspeccionado_en = now()`,
      [o.organizationId, o.url, o.estado, o.httpStatus, o.titulo, o.metaDescription,
        JSON.stringify(o.paginas), o.enlacesInternos, o.esHttps, o.error],
    );
  }

  async observacionSitio(org: string): Promise<ObservacionSitio | null> {
    const { rows } = await this.pool.query('select * from business_website_insight where organization_id = $1', [org]);
    const r = rows[0] as Record<string, unknown> | undefined;
    if (!r) return null;
    return {
      organizationId: String(r.organization_id),
      url: String(r.url),
      estado: String(r.estado) as ObservacionSitio['estado'],
      httpStatus: r.http_status === null || r.http_status === undefined ? null : Number(r.http_status),
      titulo: texto(r.titulo),
      metaDescription: texto(r.meta_description),
      paginas: lista(r.paginas),
      enlacesInternos: Number(r.enlaces_internos ?? 0),
      esHttps: r.es_https === true,
      error: texto(r.error),
      inspeccionadoEn: iso(r.inspeccionado_en) ?? '',
    };
  }

  async guardarIntencionPresupuesto(q: Queryable, i: Omit<IntencionPresupuesto, 'declaradoEn'>): Promise<void> {
    await q.query(
      `insert into business_budget_intent (organization_id, modalidad, monto_clp, moneda, declarado_por, declarado_en)
       values ($1,$2,$3,$4,$5, now())
       on conflict (organization_id) do update set modalidad = excluded.modalidad, monto_clp = excluded.monto_clp,
         moneda = excluded.moneda, declarado_por = excluded.declarado_por, declarado_en = now()`,
      [i.organizationId, i.modalidad, i.montoClp, i.moneda, i.declaradoPor],
    );
  }

  async intencionPresupuesto(org: string): Promise<IntencionPresupuesto | null> {
    const { rows } = await this.pool.query('select * from business_budget_intent where organization_id = $1', [org]);
    const r = rows[0] as Record<string, unknown> | undefined;
    if (!r) return null;
    return {
      organizationId: String(r.organization_id),
      modalidad: String(r.modalidad) as ModalidadPresupuesto,
      montoClp: r.monto_clp === null || r.monto_clp === undefined ? null : Number(r.monto_clp),
      moneda: String(r.moneda ?? 'CLP'),
      declaradoPor: String(r.declarado_por),
      declaradoEn: iso(r.declarado_en) ?? '',
    };
  }
}
