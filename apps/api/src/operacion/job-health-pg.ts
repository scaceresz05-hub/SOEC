/**
 * apps/api · OPERACIÓN · SALUD DE LOS TRABAJOS DE FONDO (read model persistente).
 *
 * Una plataforma autónoma no puede depender de que alguien lea los logs para saber si está viva. Cada
 * trabajo (ingesta, stop monitor, ciclo del director, schedulers) registra aquí su latido: cuándo empezó,
 * cuándo terminó bien, cuándo falló, con qué error y cuándo le toca de nuevo. Con eso, la UI y el operador
 * pueden responder «¿esto está funcionando?» sin abrir una terminal.
 *
 * Diseño: UNA fila por (job, organización). `organization_id` vacío ('') identifica a los trabajos que no
 * son de una organización concreta (p. ej. un scheduler multi-tenant que decide por su cuenta a quién le
 * toca). El estado se DERIVA al leer (nunca se persiste un estado que envejece solo): un trabajo que
 * debía correr hace rato y no lo hizo está ATRASADO aunque su último resultado fuera correcto.
 */
import type { Pool } from 'pg';
import type { Migration } from '@soec/event-store/pg';

/** Trabajos de fondo cubiertos por el read model. */
export type NombreJob = 'ingestion' | 'stopMonitor' | 'directorCycle' | 'googleAdsScheduler' | 'metaScheduler';

export const JOBS: readonly NombreJob[] = ['ingestion', 'stopMonitor', 'directorCycle', 'googleAdsScheduler', 'metaScheduler'];

export type EstadoJob = 'OPERATIVO' | 'ATRASADO' | 'FALLANDO' | 'DESHABILITADO' | 'SIN_DATOS';

export interface RegistroJob {
  readonly job: NombreJob;
  readonly organizationId: string; // '' ⇒ ámbito del despliegue, no de una organización
  readonly lastStartedAt: string | null;
  readonly lastSucceededAt: string | null;
  readonly lastFailedAt: string | null;
  readonly lastError: string | null;
  readonly nextRunAt: string | null;
  readonly enabled: boolean;
}

export interface SaludJob extends RegistroJob {
  readonly status: EstadoJob;
}

export const jobHealthMigrations: ReadonlyArray<Migration> = [
  {
    id: '0001_job_health',
    sql: `
      create table if not exists job_health (
        job               text not null,
        organization_id   text not null default '',
        last_started_at   timestamptz,
        last_succeeded_at timestamptz,
        last_failed_at    timestamptz,
        last_error        text,
        next_run_at       timestamptz,
        enabled           boolean not null default true,
        updated_at        timestamptz not null default now(),
        primary key (job, organization_id)
      );
    `,
  },
];

const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : v === null || v === undefined ? null : String(v));

/** Tolerancia antes de declarar ATRASADO un trabajo que ya debía haber corrido. */
export const HOLGURA_ATRASO_MS = 3 * 60_000;

/**
 * Deriva el estado observable. Orden deliberado: deshabilitado manda sobre todo (no es una avería);
 * un fallo posterior al último éxito es FALLANDO; un `nextRunAt` vencido con holgura es ATRASADO.
 */
export function derivarEstado(r: RegistroJob, ahora: string): EstadoJob {
  if (!r.enabled) return 'DESHABILITADO';
  if (r.lastFailedAt !== null && (r.lastSucceededAt === null || r.lastFailedAt > r.lastSucceededAt)) return 'FALLANDO';
  if (r.lastSucceededAt === null && r.lastStartedAt === null) return 'SIN_DATOS';
  if (r.nextRunAt !== null && Date.parse(ahora) - Date.parse(r.nextRunAt) > HOLGURA_ATRASO_MS) return 'ATRASADO';
  return 'OPERATIVO';
}

export interface RepositorioSaludJobs {
  marcarInicio(job: NombreJob, org: string, at: string): Promise<void>;
  marcarExito(job: NombreJob, org: string, at: string, nextRunAt: string | null): Promise<void>;
  marcarFallo(job: NombreJob, org: string, at: string, error: string, nextRunAt: string | null): Promise<void>;
  marcarDeshabilitado(job: NombreJob, org: string, motivo: string): Promise<void>;
  listar(org?: string): Promise<readonly RegistroJob[]>;
}

/** Recorta el error para que el read model no crezca sin control ni arrastre volcados enteros. */
const recortar = (e: string): string => (e.length > 500 ? `${e.slice(0, 497)}...` : e);

export class PgRepositorioSaludJobs implements RepositorioSaludJobs {
  constructor(private readonly pool: Pool) {}

  async marcarInicio(job: NombreJob, org: string, at: string): Promise<void> {
    await this.pool.query(
      `insert into job_health (job, organization_id, last_started_at, enabled, updated_at)
       values ($1,$2,$3,true,now())
       on conflict (job, organization_id) do update set last_started_at = excluded.last_started_at, enabled = true, updated_at = now()`,
      [job, org, at],
    );
  }

  async marcarExito(job: NombreJob, org: string, at: string, nextRunAt: string | null): Promise<void> {
    await this.pool.query(
      `insert into job_health (job, organization_id, last_succeeded_at, next_run_at, last_error, enabled, updated_at)
       values ($1,$2,$3,$4,null,true,now())
       on conflict (job, organization_id) do update set last_succeeded_at = excluded.last_succeeded_at,
         next_run_at = excluded.next_run_at, last_error = null, enabled = true, updated_at = now()`,
      [job, org, at, nextRunAt],
    );
  }

  async marcarFallo(job: NombreJob, org: string, at: string, error: string, nextRunAt: string | null): Promise<void> {
    await this.pool.query(
      `insert into job_health (job, organization_id, last_failed_at, last_error, next_run_at, enabled, updated_at)
       values ($1,$2,$3,$4,$5,true,now())
       on conflict (job, organization_id) do update set last_failed_at = excluded.last_failed_at,
         last_error = excluded.last_error, next_run_at = excluded.next_run_at, enabled = true, updated_at = now()`,
      [job, org, at, recortar(error), nextRunAt],
    );
  }

  async marcarDeshabilitado(job: NombreJob, org: string, motivo: string): Promise<void> {
    await this.pool.query(
      `insert into job_health (job, organization_id, enabled, last_error, next_run_at, updated_at)
       values ($1,$2,false,$3,null,now())
       on conflict (job, organization_id) do update set enabled = false, last_error = excluded.last_error,
         next_run_at = null, updated_at = now()`,
      [job, org, recortar(motivo)],
    );
  }

  async listar(org?: string): Promise<readonly RegistroJob[]> {
    // Sin organización ⇒ todo; con organización ⇒ lo suyo MÁS lo del despliegue (''), que le afecta.
    const { rows } = org
      ? await this.pool.query(`select * from job_health where organization_id in ($1, '') order by job, organization_id`, [org])
      : await this.pool.query(`select * from job_health order by job, organization_id`);
    return rows.map((r: Record<string, unknown>) => ({
      job: String(r.job) as NombreJob,
      organizationId: String(r.organization_id ?? ''),
      lastStartedAt: iso(r.last_started_at),
      lastSucceededAt: iso(r.last_succeeded_at),
      lastFailedAt: iso(r.last_failed_at),
      lastError: r.last_error === null || r.last_error === undefined ? null : String(r.last_error),
      nextRunAt: iso(r.next_run_at),
      enabled: r.enabled !== false,
    }));
  }
}

/** Read model listo para la UI: cada registro con su estado derivado al instante de la consulta. */
export async function saludDeJobs(repo: RepositorioSaludJobs, ahora: string, org?: string): Promise<readonly SaludJob[]> {
  const registros = await repo.listar(org);
  return registros.map((r) => ({ ...r, status: derivarEstado(r, ahora) }));
}
