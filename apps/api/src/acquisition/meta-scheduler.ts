/**
 * apps/api · SCHEDULER AUTÓNOMO READ-ONLY de sync Meta.
 *
 * Tenant-aware, dirigido por freshness: sólo procesa conexiones CONNECTED_READ_ONLY con sync habilitado
 * cuyo `nextEligibleSyncAt` ya venció. Reutiliza `ejecutarSync` (que a su vez respeta TTL y NO llama a
 * Graph si todo está FRESH). Protección de concurrencia por claim atómico con `lockedUntil`. Idempotente.
 * Backoff limitado ante fallos (sin retry infinito); auth/scope ⇒ backoff largo (reautorización humana).
 * Preserva el último snapshot bueno (lo hace `ejecutarSync`). Observabilidad completa por conexión.
 *
 * Cero escritura Meta. Cero token/secret al frontend/logs. Cero cross-tenant (todo scoped por org).
 */

import { ActorId, OrganizationId, type RequestContext } from '@soec/contracts';
import type { ComposicionMetaOAuth } from './meta-runtime';
import { ejecutarSync, TTL_POR_CAPACIDAD, type CapacidadSync, type ClaseErrorSync, type EstadoCapacidadSync, type MetaSyncRepo } from './meta-sync';

export interface ScheduleRow {
  readonly organizationId: string;
  readonly connectionId: string;
  readonly syncEnabled: boolean;
  readonly lastAttemptAt: string | null;
  readonly lastSuccessfulSyncAt: string | null;
  readonly nextEligibleSyncAt: string | null;
  readonly consecutiveFailures: number;
  readonly lastErrorClass: ClaseErrorSync;
  readonly capabilitiesAffected: readonly CapacidadSync[];
  readonly lockedUntil: string | null;
}

export interface ConexionElegible {
  readonly organizationId: string;
  readonly connectionId: string;
}

export interface MetaScheduleRepo {
  /** Conexiones CONNECTED_READ_ONLY con sync habilitado, vencidas (nextEligible<=ahora) y sin lock vigente. */
  listarElegibles(ahora: string, limite: number): Promise<readonly ConexionElegible[]>;
  /** Claim ATÓMICO: sólo uno gana el lock. Crea la fila si no existe. */
  reclamar(organizationId: string, connectionId: string, ahora: string, lockMs: number): Promise<boolean>;
  /** Libera el lock y persiste observabilidad. */
  actualizar(row: ScheduleRow): Promise<void>;
  obtener(organizationId: string, connectionId: string): Promise<ScheduleRow | null>;
  /** ON/OFF por organización (crea la fila si no existe). */
  configurar(organizationId: string, connectionId: string, enabled: boolean): Promise<void>;
}

export const INTERVALO_SCHEDULER_MS = 5 * 60_000; // tick cada 5 min; el freshness decide qué se toca
const BACKOFF_BASE_MS = 5 * 60_000;
const BACKOFF_CAP_MS = 6 * 3600_000;
const BACKOFF_REAUTH_MS = 6 * 3600_000; // auth/scope: no reintentar rápido (requiere reautorización humana)
const MAX_FAILURES = 12; // tope de backoff (evita crecer sin fin); a partir de aquí, cadencia fija = CAP

/** Backoff exponencial acotado; auth/scope ⇒ ventana larga. Nunca retry infinito ni storm. */
export function backoffMs(errorClass: ClaseErrorSync, consecutiveFailures: number): number {
  if (errorClass === 'AUTH' || errorClass === 'SCOPE') return BACKOFF_REAUTH_MS;
  const n = Math.min(consecutiveFailures, MAX_FAILURES);
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, n - 1), BACKOFF_CAP_MS);
}

/** Próximo instante en que alguna capacidad caducará (min observedAt+TTL). Null/NEVER ⇒ ahora (sync ya). */
export function proximoElegible(capacidades: readonly EstadoCapacidadSync[], ahora: string): string {
  const ahoraMs = Date.parse(ahora);
  let min = Number.POSITIVE_INFINITY;
  for (const c of capacidades) {
    if (c.observedAt === null) return ahora; // algo sin snapshot ⇒ elegible ya
    const exp = Date.parse(c.observedAt) + TTL_POR_CAPACIDAD[c.capability];
    if (exp < min) min = exp;
  }
  if (!Number.isFinite(min)) return new Date(ahoraMs + BACKOFF_BASE_MS).toISOString();
  return new Date(Math.max(min, ahoraMs)).toISOString();
}

function ctxSistema(org: string): RequestContext {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('meta-scheduler'), scope: { organizationId: o, permissions: ['events:read'] }, correlationId: 'meta-scheduler' };
}

export interface DepsScheduler {
  readonly comp: ComposicionMetaOAuth;
  readonly scheduleRepo: MetaScheduleRepo;
  readonly ahora: () => string;
  readonly lockMs?: number;
  readonly batch?: number;
}

/** Procesa UNA conexión reclamada: sync freshness-aware + actualización de observabilidad/backoff. */
export async function procesarConexion(deps: DepsScheduler, e: ConexionElegible): Promise<ScheduleRow> {
  const ahora = deps.ahora();
  const prev = await deps.scheduleRepo.obtener(e.organizationId, e.connectionId);
  const fallosPrevios = prev?.consecutiveFailures ?? 0;
  const base: ScheduleRow = {
    organizationId: e.organizationId,
    connectionId: e.connectionId,
    syncEnabled: prev?.syncEnabled ?? true,
    lastAttemptAt: ahora,
    lastSuccessfulSyncAt: prev?.lastSuccessfulSyncAt ?? null,
    nextEligibleSyncAt: prev?.nextEligibleSyncAt ?? null,
    consecutiveFailures: fallosPrevios,
    lastErrorClass: 'NONE',
    capabilitiesAffected: [],
    lockedUntil: null,
  };

  const reg = await deps.comp.connRepo.obtener(e.organizationId, e.connectionId);
  const cred = await deps.comp.credRepo.obtener(e.organizationId, e.connectionId);
  if (reg === null || cred === null) {
    const row: ScheduleRow = { ...base, lastErrorClass: 'DEGRADED', consecutiveFailures: fallosPrevios + 1, nextEligibleSyncAt: new Date(Date.parse(ahora) + backoffMs('DEGRADED', fallosPrevios + 1)).toISOString() };
    await deps.scheduleRepo.actualizar(row);
    return row;
  }

  try {
    const ctx = ctxSistema(e.organizationId);
    const estado = await ejecutarSync(
      {
        resolverGraph: (uso) => deps.comp.secretWriter.resolver(ctx, cred.secretRef).then((r) => r.usar((token) => uso(deps.comp.crearGraphRead(token)))),
        repo: deps.comp.syncRepo,
        ahora: deps.ahora,
      },
      e.organizationId,
      e.connectionId,
      reg.conexion.bindings,
    );
    const exito = estado.lastErrorClass === 'NONE';
    const afectadas = estado.capacidades.filter((c) => c.estado !== 'OK' && c.estado !== 'SKIPPED_FRESH').map((c) => c.capability);
    const consecutiveFailures = exito ? 0 : fallosPrevios + 1;
    const nextEligibleSyncAt = exito ? proximoElegible(estado.capacidades, ahora) : new Date(Date.parse(ahora) + backoffMs(estado.lastErrorClass, consecutiveFailures)).toISOString();
    const row: ScheduleRow = {
      ...base,
      lastSuccessfulSyncAt: exito ? (estado.lastSuccessfulSyncAt ?? ahora) : base.lastSuccessfulSyncAt,
      lastErrorClass: estado.lastErrorClass,
      consecutiveFailures,
      capabilitiesAffected: afectadas,
      nextEligibleSyncAt,
    };
    await deps.scheduleRepo.actualizar(row);
    return row;
  } catch {
    const consecutiveFailures = fallosPrevios + 1;
    const row: ScheduleRow = { ...base, lastErrorClass: 'DEGRADED', consecutiveFailures, nextEligibleSyncAt: new Date(Date.parse(ahora) + backoffMs('DEGRADED', consecutiveFailures)).toISOString() };
    await deps.scheduleRepo.actualizar(row);
    return row;
  }
}

/** Un tick: reclama y procesa hasta `batch` conexiones elegibles. Devuelve cuántas procesó. */
export async function procesarTick(deps: DepsScheduler): Promise<number> {
  const batch = deps.batch ?? 20;
  const lockMs = deps.lockMs ?? 10 * 60_000;
  const elegibles = await deps.scheduleRepo.listarElegibles(deps.ahora(), batch);
  let procesadas = 0;
  for (const e of elegibles) {
    const reclamada = await deps.scheduleRepo.reclamar(e.organizationId, e.connectionId, deps.ahora(), lockMs);
    if (!reclamada) continue; // otro worker/tick la tomó
    await procesarConexion(deps, e);
    procesadas += 1;
  }
  return procesadas;
}

/** Arranca el loop del scheduler. Devuelve un handle para detenerlo. No lanza: aísla errores por tick. */
export function iniciarMetaScheduler(deps: DepsScheduler, intervaloMs = INTERVALO_SCHEDULER_MS): { detener: () => void } {
  let corriendo = false;
  const tick = async (): Promise<void> => {
    if (corriendo) return; // no solapar ticks en el mismo proceso
    corriendo = true;
    try {
      await procesarTick(deps);
    } catch {
      /* un tick fallido no tumba el scheduler */
    } finally {
      corriendo = false;
    }
  };
  const timer = setInterval(() => void tick(), intervaloMs);
  if (typeof timer === 'object' && 'unref' in timer) (timer as { unref: () => void }).unref();
  return { detener: () => clearInterval(timer) };
}

/** Repo in-memory para tests. */
export class InMemoryMetaScheduleRepo implements MetaScheduleRepo {
  private readonly rows = new Map<string, ScheduleRow>();
  /** Conexiones conocidas (org,conn) marcadas como CONNECTED_READ_ONLY para el filtro de elegibilidad. */
  readonly conectadas = new Set<string>();
  private k(org: string, conn: string): string {
    return `${org}:${conn}`;
  }
  marcarConectada(org: string, conn: string): void {
    this.conectadas.add(this.k(org, conn));
  }
  async listarElegibles(ahora: string, limite: number): Promise<readonly ConexionElegible[]> {
    const ahoraMs = Date.parse(ahora);
    const out: ConexionElegible[] = [];
    for (const key of this.conectadas) {
      const row = this.rows.get(key);
      const enabled = row?.syncEnabled ?? true;
      const due = !row?.nextEligibleSyncAt || Date.parse(row.nextEligibleSyncAt) <= ahoraMs;
      const unlocked = !row?.lockedUntil || Date.parse(row.lockedUntil) < ahoraMs;
      if (enabled && due && unlocked) {
        const [organizationId, connectionId] = key.split(':') as [string, string];
        out.push({ organizationId, connectionId });
      }
      if (out.length >= limite) break;
    }
    return out;
  }
  async reclamar(org: string, conn: string, ahora: string, lockMs: number): Promise<boolean> {
    const key = this.k(org, conn);
    const row = this.rows.get(key);
    const ahoraMs = Date.parse(ahora);
    if (row?.lockedUntil && Date.parse(row.lockedUntil) >= ahoraMs) return false; // lock vigente
    const nuevo: ScheduleRow = {
      organizationId: org,
      connectionId: conn,
      syncEnabled: row?.syncEnabled ?? true,
      lastAttemptAt: ahora,
      lastSuccessfulSyncAt: row?.lastSuccessfulSyncAt ?? null,
      nextEligibleSyncAt: row?.nextEligibleSyncAt ?? null,
      consecutiveFailures: row?.consecutiveFailures ?? 0,
      lastErrorClass: row?.lastErrorClass ?? 'NONE',
      capabilitiesAffected: row?.capabilitiesAffected ?? [],
      lockedUntil: new Date(ahoraMs + lockMs).toISOString(),
    };
    this.rows.set(key, nuevo);
    return true;
  }
  async actualizar(row: ScheduleRow): Promise<void> {
    this.rows.set(this.k(row.organizationId, row.connectionId), row);
  }
  async obtener(org: string, conn: string): Promise<ScheduleRow | null> {
    return this.rows.get(this.k(org, conn)) ?? null;
  }
  async configurar(org: string, conn: string, enabled: boolean): Promise<void> {
    const key = this.k(org, conn);
    const row = this.rows.get(key);
    this.rows.set(key, {
      organizationId: org, connectionId: conn, syncEnabled: enabled,
      lastAttemptAt: row?.lastAttemptAt ?? null, lastSuccessfulSyncAt: row?.lastSuccessfulSyncAt ?? null,
      nextEligibleSyncAt: row?.nextEligibleSyncAt ?? null, consecutiveFailures: row?.consecutiveFailures ?? 0,
      lastErrorClass: row?.lastErrorClass ?? 'NONE', capabilitiesAffected: row?.capabilitiesAffected ?? [], lockedUntil: row?.lockedUntil ?? null,
    });
  }
}

// Silencia el import de MetaSyncRepo si el bundler lo requiere en el grafo de tipos.
export type { MetaSyncRepo };
