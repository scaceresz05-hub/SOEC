/**
 * apps/api · SCHEDULER PRODUCTIVO de ingesta Google Ads (READ ONLY, multi-tenant). In-proceso (setInterval),
 * NO Windows Task Scheduler: sobrevive independiente del PC del desarrollador, corre en el servicio desplegado.
 *
 * AISLAMIENTO DE FALLOS: recorre TODAS las conexiones CONNECTED de TODOS los tenants; el fallo de una empresa
 * (OAuth roto, error de proveedor) NO impide sincronizar a las demás (try/catch por tenant, continue). Una
 * conexión con invalid_grant se marca NEEDS_REAUTH y se salta; el histórico se conserva.
 *
 * DORMIDO por defecto: `iniciar()` sólo agenda si `GOOGLE_ADS_SCHEDULER_ENABLED === 'true'`. En producción se
 * activa recién tras la certificación + gate humano. Nunca escribe en Google Ads (READ ONLY).
 */

import type { ConnectionRepoPort } from '../acquisition/google-ads-oauth-flow';
import { sincronizarConexion, type DepsSincronizacion, type ResultadoSincronizacion } from './google-ads-connection-service';

/**
 * Exclusión distribuida por conexión. `adquirir` devuelve true SÓLO al ganador; dos réplicas de la API
 * NUNCA sincronizan la misma conexión a la vez (single-flight). Satisfecho por `PgGoogleAdsSyncLease`.
 */
export interface SyncLeasePort {
  adquirir(connectionKey: string, holder: string, ahora: string): Promise<boolean>;
  liberar(connectionKey: string, holder: string): Promise<void>;
}

export interface DepsScheduler extends DepsSincronizacion {
  readonly connRepo: ConnectionRepoPort;
  /** Lease de exclusión distribuida. Si se omite, no hay protección multi-réplica (sólo dev de una instancia). */
  readonly lease?: SyncLeasePort;
  /** Identidad de este proceso/réplica (holder del lease). */
  readonly holder: string;
  /** Intervalo entre corridas (ms). Default 3h. */
  readonly intervaloMs?: number;
  /** Habilitación explícita (dormido si !== 'true'). */
  readonly habilitado: boolean;
  /** Logger inyectable (observabilidad sanitizada; nunca secretos). */
  readonly log?: (evento: Record<string, unknown>) => void;
}

export interface ResumenCorrida {
  readonly corridaAt: string;
  readonly total: number;
  readonly resultados: readonly ResultadoSincronizacion[];
}

/**
 * Recorre todas las conexiones conectadas y sincroniza cada una AISLADAMENTE. Devuelve el resumen por tenant.
 * Nunca lanza: un tenant que falla queda registrado con estado FALLO y no aborta al resto.
 */
export async function correrTodasLasConexiones(deps: DepsScheduler): Promise<ResumenCorrida> {
  const corridaAt = deps.ahora();
  const conexiones = await deps.connRepo.listarConectadas();
  const resultados: ResultadoSincronizacion[] = [];
  for (const conexion of conexiones) {
    const key = `${conexion.organizationId}:${conexion.connectionId}`;
    // Single-flight distribuido: si otra réplica ya tiene el lease de esta conexión, la salteamos.
    let adquirido = true;
    if (deps.lease) {
      try {
        adquirido = await deps.lease.adquirir(key, deps.holder, corridaAt);
      } catch (e) {
        deps.log?.({ scheduler: 'google-ads', org: conexion.organizationId, error: e instanceof Error ? e.message : 'lease' });
        adquirido = false;
      }
      if (!adquirido) {
        resultados.push({ org: conexion.organizationId, estado: 'SKIPPED', queriedAt: corridaAt, error: 'lease_ocupado', dataThrough: null });
        deps.log?.({ scheduler: 'google-ads', org: conexion.organizationId, estado: 'SKIPPED_LEASED' });
        continue;
      }
    }
    try {
      const r = await sincronizarConexion(deps, conexion);
      resultados.push(r);
      deps.log?.({ scheduler: 'google-ads', org: conexion.organizationId, estado: r.estado, dataThrough: r.dataThrough });
    } catch (e) {
      // Aislamiento: el fallo inesperado de un tenant no detiene la corrida global.
      const error = e instanceof Error ? e.message : 'error desconocido';
      resultados.push({ org: conexion.organizationId, estado: 'FALLO', queriedAt: corridaAt, error, dataThrough: null });
      deps.log?.({ scheduler: 'google-ads', org: conexion.organizationId, estado: 'FALLO', error });
    } finally {
      if (deps.lease && adquirido) await deps.lease.liberar(key, deps.holder).catch(() => undefined);
    }
  }
  return { corridaAt, total: conexiones.length, resultados };
}

/** Lease in-memory (tests / una sola instancia). Single-flight por clave; expiración por TTL. */
export class InMemorySyncLease implements SyncLeasePort {
  private readonly m = new Map<string, { holder: string; expiresAt: number }>();
  constructor(private readonly ttlMs: number = 10 * 60 * 1000) {}
  async adquirir(connectionKey: string, holder: string, ahora: string): Promise<boolean> {
    const t = Date.parse(ahora);
    const cur = this.m.get(connectionKey);
    if (cur && cur.expiresAt > t) return false; // lease vigente de otro (o de sí mismo)
    this.m.set(connectionKey, { holder, expiresAt: t + this.ttlMs });
    return true;
  }
  async liberar(connectionKey: string, holder: string): Promise<void> {
    const cur = this.m.get(connectionKey);
    if (cur && cur.holder === holder) this.m.delete(connectionKey);
  }
}

export class GoogleAdsScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(private readonly deps: DepsScheduler) {}

  /** Agenda la corrida periódica. NO hace nada si el scheduler está deshabilitado (dormido). */
  iniciar(): { agendado: boolean } {
    if (!this.deps.habilitado) return { agendado: false };
    if (this.timer !== null) return { agendado: true };
    const intervalo = this.deps.intervaloMs ?? 3 * 60 * 60 * 1000;
    this.timer = setInterval(() => {
      void correrTodasLasConexiones(this.deps).catch((e) => this.deps.log?.({ scheduler: 'google-ads', error: e instanceof Error ? e.message : 'error' }));
    }, intervalo);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    return { agendado: true };
  }

  detener(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
