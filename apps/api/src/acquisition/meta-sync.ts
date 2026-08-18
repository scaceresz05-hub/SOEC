/**
 * apps/api · SYNC READ-ONLY + OBSERVABILIDAD de Meta.
 *
 * Reutiliza credencial + bindings + `MetaGraphReadPort` + la clasificación sanitaria del read-smoke para
 * sincronizar snapshots NORMALIZADOS por capacidad. Reglas duras:
 *   · SÓLO lectura (GET); NUNCA escritura Meta, ni gestión de anuncios (write), ni lectura de leads/PII.
 *   · Se persiste SÓLO un resumen normalizado (conteos / métricas numéricas / identidad whitelisted):
 *     jamás el raw Graph, ni URLs de paging, ni token.
 *   · Idempotente: upsert por (org, capability, externalId, period) ⇒ mismo asset+período no duplica.
 *   · Health fail-closed: auth ⇒ AUTH/TOKEN_EXPIRED; permiso ⇒ SCOPE/SCOPE_MISSING; otros ⇒ DEGRADED.
 *     Una respuesta vacía/no-data NO es fallo (no se convierte «missing» en 0 ni en error de auth).
 * NO modifica la conexión OAuth (estado/bindings/credencial): la observabilidad vive en su propio estado.
 */

import type { MetaGraphReadPort } from './meta-onboarding';
import type { BindingMeta } from './meta-onboarding';
import { MetaAutenticacionError, MetaPermisoError } from './meta-http';

export type CapacidadSync =
  | 'BUSINESS_IDENTITY'
  | 'PAGE_IDENTITY'
  | 'INSTAGRAM_IDENTITY'
  | 'INSTAGRAM_MEDIA'
  | 'INSTAGRAM_INSIGHTS'
  | 'ADS_ACCOUNT'
  | 'ADS_CAMPAIGNS'
  | 'ADS_INSIGHTS';

export type EstadoCapacidad = 'OK' | 'AUTH_FAILED' | 'SCOPE_MISSING' | 'DEGRADED' | 'SKIPPED';
export type ClaseErrorSync = 'NONE' | 'AUTH' | 'SCOPE' | 'DEGRADED';

/** Resumen NORMALIZADO de una lectura: conteos, métricas numéricas, identidad whitelisted. Nunca raw/PII. */
export interface ResumenNormalizado {
  readonly kind: CapacidadSync;
  readonly count?: number;
  readonly identity?: Readonly<Record<string, string>>;
  readonly metrics?: Readonly<Record<string, number>>;
}

export interface SnapshotSync {
  readonly organizationId: string;
  readonly connectionId: string;
  readonly capability: CapacidadSync;
  readonly externalId: string;
  readonly period: string; // 'CURRENT' para identidad/estado rolling
  readonly observedAt: string; // timestamp del snapshot (freshness)
  readonly source: 'meta';
  readonly resumen: ResumenNormalizado;
}

export interface EstadoCapacidadSync {
  readonly capability: CapacidadSync;
  readonly estado: EstadoCapacidad;
  readonly observedAt: string | null;
}

export interface EstadoSync {
  readonly organizationId: string;
  readonly connectionId: string;
  readonly lastSyncAt: string;
  readonly lastSuccessfulSyncAt: string | null;
  readonly lastErrorClass: ClaseErrorSync;
  readonly saludConexion: string; // HEALTHY / TOKEN_EXPIRED / SCOPE_MISSING / DEGRADED
  readonly capacidades: readonly EstadoCapacidadSync[];
}

export interface MetaSyncRepo {
  upsertSnapshot(s: SnapshotSync): Promise<void>;
  guardarEstado(e: EstadoSync): Promise<void>;
  obtenerEstado(organizationId: string, connectionId: string): Promise<EstadoSync | null>;
  listarSnapshots(organizationId: string, connectionId: string): Promise<readonly SnapshotSync[]>;
}

// --- Normalizadores whitelist (nunca raw/paging/token/PII) ---------------------------------------

function contarData(json: unknown): number {
  const d = (json as { data?: unknown } | null)?.data;
  return Array.isArray(d) ? d.length : 0;
}

function identidadWhitelist(json: unknown, campos: readonly string[]): Record<string, string> {
  const o = (json ?? {}) as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const k of campos) {
    const v = o[k];
    if (typeof v === 'string') out[k] = v;
    else if (typeof v === 'number') out[k] = String(v);
  }
  return out;
}

/** Extrae métricas numéricas de insights (formato name/values o fila account-level). Sólo números. */
function metricasInsights(json: unknown, camposFila: readonly string[]): Record<string, number> {
  const d = (json as { data?: unknown } | null)?.data;
  const out: Record<string, number> = {};
  if (!Array.isArray(d)) return out;
  for (const m of d) {
    const name = (m as { name?: unknown }).name;
    const values = (m as { values?: unknown }).values;
    if (typeof name === 'string' && Array.isArray(values) && values.length > 0) {
      const v = (values[values.length - 1] as { value?: unknown }).value;
      if (typeof v === 'number') out[name] = v;
    }
  }
  if (Object.keys(out).length === 0 && d.length > 0) {
    const fila = d[0] as Record<string, unknown>;
    for (const k of camposFila) {
      const v = fila[k];
      const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : Number.NaN;
      if (Number.isFinite(n)) out[k] = n;
    }
  }
  return out;
}

// --- Orquestador ---------------------------------------------------------------------------------

export interface DepsSync {
  readonly graph: MetaGraphReadPort; // adapter con el token ya ligado (boundary-only)
  readonly repo: MetaSyncRepo;
  readonly ahora: () => string;
}

/**
 * Sincroniza (read-only) cada capacidad con binding confirmado, normaliza y persiste snapshots idempotentes,
 * y registra el estado de observabilidad. Nunca lanza por un check individual: clasifica y continúa.
 */
export async function ejecutarSync(deps: DepsSync, organizationId: string, connectionId: string, bindings: readonly BindingMeta[]): Promise<EstadoSync> {
  const ahora = deps.ahora();
  const bind = (t: string): string | null => bindings.find((b) => b.assetType === t && b.confirmadoPorHumano)?.externalId ?? null;
  const capacidades: EstadoCapacidadSync[] = [];
  let auth = false, scope = false, degraded = false;

  const correr = async (capability: CapacidadSync, externalId: string, period: string, leer: () => Promise<unknown>, normalizar: (j: unknown) => ResumenNormalizado): Promise<void> => {
    try {
      const json = await leer();
      const resumen = normalizar(json); // no-data ⇒ resumen con count 0 / metrics vacío (lectura válida)
      await deps.repo.upsertSnapshot({ organizationId, connectionId, capability, externalId, period, observedAt: ahora, source: 'meta', resumen });
      capacidades.push({ capability, estado: 'OK', observedAt: ahora });
    } catch (e) {
      let estado: EstadoCapacidad = 'DEGRADED';
      if (e instanceof MetaAutenticacionError) { auth = true; estado = 'AUTH_FAILED'; }
      else if (e instanceof MetaPermisoError) { scope = true; estado = 'SCOPE_MISSING'; }
      else degraded = true;
      capacidades.push({ capability, estado, observedAt: null });
    }
  };

  const biz = bind('business');
  const page = bind('page');
  const igsid = bind('instagram');
  const adId = bind('adAccount');

  if (biz !== null) await correr('BUSINESS_IDENTITY', biz, 'CURRENT', () => deps.graph.discoverBusinesses(), (j) => ({ kind: 'BUSINESS_IDENTITY', count: Array.isArray(j) ? (j as unknown[]).length : 0 }));
  if (page !== null) await correr('PAGE_IDENTITY', page, 'CURRENT', () => deps.graph.discoverPages(), (j) => ({ kind: 'PAGE_IDENTITY', count: Array.isArray(j) ? (j as unknown[]).length : 0 }));
  if (igsid !== null) {
    await correr('INSTAGRAM_IDENTITY', igsid, 'CURRENT', () => deps.graph.readInstagramProfile(igsid), (j) => ({ kind: 'INSTAGRAM_IDENTITY', identity: identidadWhitelist(j, ['id', 'username']) }));
    await correr('INSTAGRAM_MEDIA', igsid, 'CURRENT', () => deps.graph.readInstagramMedia(igsid), (j) => ({ kind: 'INSTAGRAM_MEDIA', count: contarData(j) }));
    await correr('INSTAGRAM_INSIGHTS', igsid, 'CURRENT', () => deps.graph.readInstagramAccountInsights(igsid), (j) => ({ kind: 'INSTAGRAM_INSIGHTS', metrics: metricasInsights(j, ['reach', 'follower_count']) }));
  }
  if (adId !== null) {
    await correr('ADS_ACCOUNT', adId, 'CURRENT', () => deps.graph.readAdAccount(adId), (j) => ({ kind: 'ADS_ACCOUNT', identity: identidadWhitelist(j, ['id', 'account_id', 'currency', 'account_status']) }));
    await correr('ADS_CAMPAIGNS', adId, 'CURRENT', () => deps.graph.readCampaigns(adId), (j) => ({ kind: 'ADS_CAMPAIGNS', count: contarData(j) }));
    await correr('ADS_INSIGHTS', adId, 'CURRENT', () => deps.graph.readAdsInsights(adId), (j) => ({ kind: 'ADS_INSIGHTS', metrics: metricasInsights(j, ['impressions', 'clicks', 'spend', 'reach']) }));
  }

  const lastErrorClass: ClaseErrorSync = auth ? 'AUTH' : scope ? 'SCOPE' : degraded ? 'DEGRADED' : 'NONE';
  const saludConexion = auth ? 'TOKEN_EXPIRED' : scope ? 'SCOPE_MISSING' : degraded ? 'DEGRADED' : 'HEALTHY';
  const prev = await deps.repo.obtenerEstado(organizationId, connectionId);
  const exitoTotal = lastErrorClass === 'NONE' && capacidades.length > 0;
  const estado: EstadoSync = {
    organizationId,
    connectionId,
    lastSyncAt: ahora,
    lastSuccessfulSyncAt: exitoTotal ? ahora : (prev?.lastSuccessfulSyncAt ?? null),
    lastErrorClass,
    saludConexion,
    capacidades,
  };
  await deps.repo.guardarEstado(estado);
  return estado;
}

/** Repo in-memory para tests: idempotente por (org, connection, capability, externalId, period). */
export class InMemoryMetaSyncRepo implements MetaSyncRepo {
  private readonly snaps = new Map<string, SnapshotSync>();
  private readonly estados = new Map<string, EstadoSync>();
  private clave(s: Pick<SnapshotSync, 'organizationId' | 'connectionId' | 'capability' | 'externalId' | 'period'>): string {
    return `${s.organizationId}:${s.connectionId}:${s.capability}:${s.externalId}:${s.period}`;
  }
  async upsertSnapshot(s: SnapshotSync): Promise<void> {
    this.snaps.set(this.clave(s), s);
  }
  async guardarEstado(e: EstadoSync): Promise<void> {
    this.estados.set(`${e.organizationId}:${e.connectionId}`, e);
  }
  async obtenerEstado(org: string, connectionId: string): Promise<EstadoSync | null> {
    return this.estados.get(`${org}:${connectionId}`) ?? null;
  }
  async listarSnapshots(org: string, connectionId: string): Promise<readonly SnapshotSync[]> {
    return [...this.snaps.values()].filter((s) => s.organizationId === org && s.connectionId === connectionId);
  }
}
