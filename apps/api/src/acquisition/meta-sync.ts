/**
 * apps/api · SYNC READ-ONLY + OBSERVABILIDAD + POLÍTICA DE FRESHNESS de Meta.
 *
 * Reutiliza credencial + bindings + `MetaGraphReadPort` + la clasificación sanitaria del read-smoke para
 * sincronizar snapshots NORMALIZADOS por capacidad, respetando una política de freshness por capacidad.
 * Reglas duras:
 *   · SÓLO lectura (GET); NUNCA escritura Meta, ni gestión de anuncios (write), ni lectura de leads/PII.
 *   · Se persiste SÓLO un resumen normalizado (conteos / métricas numéricas / identidad whitelisted):
 *     jamás el raw Graph, ni URLs de paging, ni token.
 *   · Idempotente: upsert por (org, capability, externalId, period).
 *   · Freshness: si un snapshot sigue FRESH y no hay `force`, NO se llama a Graph para esa capacidad. Si
 *     TODAS están FRESH, ni siquiera se resuelve el token (cero llamadas Graph).
 *   · Health fail-closed: auth ⇒ AUTH/TOKEN_EXPIRED; permiso ⇒ SCOPE/SCOPE_MISSING; otros ⇒ DEGRADED.
 *     Una respuesta vacía/no-data NO es fallo (no se convierte «missing» en 0). Un fallo parcial PRESERVA
 *     el último snapshot bueno (no se sobrescribe con nada).
 * NO modifica la conexión OAuth (estado/bindings/credencial): la observabilidad de sync vive aparte.
 */

import type { MetaGraphReadPort, BindingMeta } from './meta-onboarding';
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

export type EstadoCapacidad = 'OK' | 'SKIPPED_FRESH' | 'AUTH_FAILED' | 'SCOPE_MISSING' | 'DEGRADED';
export type Freshness = 'FRESH' | 'STALE' | 'NEVER_SYNCED' | 'DEGRADED' | 'REAUTH_REQUIRED';
export type ClaseErrorSync = 'NONE' | 'AUTH' | 'SCOPE' | 'DEGRADED';

/** TTL de freshness por capacidad (ms). Identidad cambia poco; insights caducan antes. */
export const TTL_POR_CAPACIDAD: Readonly<Record<CapacidadSync, number>> = {
  BUSINESS_IDENTITY: 24 * 3600_000,
  PAGE_IDENTITY: 24 * 3600_000,
  INSTAGRAM_IDENTITY: 24 * 3600_000,
  ADS_ACCOUNT: 24 * 3600_000,
  INSTAGRAM_MEDIA: 6 * 3600_000,
  ADS_CAMPAIGNS: 6 * 3600_000,
  INSTAGRAM_INSIGHTS: 3 * 3600_000,
  ADS_INSIGHTS: 3 * 3600_000,
};

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
  readonly period: string;
  readonly observedAt: string;
  readonly source: 'meta';
  readonly resumen: ResumenNormalizado;
}

export interface EstadoCapacidadSync {
  readonly capability: CapacidadSync;
  readonly estado: EstadoCapacidad;
  readonly freshness: Freshness;
  readonly observedAt: string | null;
}

export interface EstadoSync {
  readonly organizationId: string;
  readonly connectionId: string;
  readonly lastSyncAt: string;
  readonly lastSuccessfulSyncAt: string | null;
  readonly lastErrorClass: ClaseErrorSync;
  readonly saludConexion: string;
  readonly capacidades: readonly EstadoCapacidadSync[];
}

export interface MetaSyncRepo {
  upsertSnapshot(s: SnapshotSync): Promise<void>;
  guardarEstado(e: EstadoSync): Promise<void>;
  obtenerEstado(organizationId: string, connectionId: string): Promise<EstadoSync | null>;
  listarSnapshots(organizationId: string, connectionId: string): Promise<readonly SnapshotSync[]>;
}

// --- Capacidades aplicables por binding ----------------------------------------------------------

export interface CapacidadAplicable {
  readonly capability: CapacidadSync;
  readonly externalId: string;
}

/** Capacidades sincronizables según los bindings confirmados (identity + derivadas por asset). */
export function capacidadesAplicables(bindings: readonly BindingMeta[]): readonly CapacidadAplicable[] {
  const bind = (t: string): string | null => bindings.find((b) => b.assetType === t && b.confirmadoPorHumano)?.externalId ?? null;
  const out: CapacidadAplicable[] = [];
  const biz = bind('business');
  const page = bind('page');
  const igsid = bind('instagram');
  const adId = bind('adAccount');
  if (biz !== null) out.push({ capability: 'BUSINESS_IDENTITY', externalId: biz });
  if (page !== null) out.push({ capability: 'PAGE_IDENTITY', externalId: page });
  if (igsid !== null) {
    out.push({ capability: 'INSTAGRAM_IDENTITY', externalId: igsid });
    out.push({ capability: 'INSTAGRAM_MEDIA', externalId: igsid });
    out.push({ capability: 'INSTAGRAM_INSIGHTS', externalId: igsid });
  }
  if (adId !== null) {
    out.push({ capability: 'ADS_ACCOUNT', externalId: adId });
    out.push({ capability: 'ADS_CAMPAIGNS', externalId: adId });
    out.push({ capability: 'ADS_INSIGHTS', externalId: adId });
  }
  return out;
}

/** Clasifica freshness: salud previa (auth/scope/degraded) manda; luego edad del snapshot vs TTL. */
export function clasificarFreshness(snapshot: SnapshotSync | undefined, estadoPrevio: EstadoCapacidad | undefined, ttlMs: number, ahoraMs: number): Freshness {
  if (estadoPrevio === 'AUTH_FAILED') return 'REAUTH_REQUIRED';
  if (estadoPrevio === 'SCOPE_MISSING' || estadoPrevio === 'DEGRADED') return 'DEGRADED';
  if (snapshot === undefined) return 'NEVER_SYNCED';
  const edad = ahoraMs - Date.parse(snapshot.observedAt);
  return edad < ttlMs ? 'FRESH' : 'STALE';
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

function leerCapacidad(g: MetaGraphReadPort, cap: CapacidadSync, id: string): Promise<unknown> {
  switch (cap) {
    case 'BUSINESS_IDENTITY': return g.discoverBusinesses();
    case 'PAGE_IDENTITY': return g.discoverPages();
    case 'INSTAGRAM_IDENTITY': return g.readInstagramProfile(id);
    case 'INSTAGRAM_MEDIA': return g.readInstagramMedia(id);
    case 'INSTAGRAM_INSIGHTS': return g.readInstagramAccountInsights(id);
    case 'ADS_ACCOUNT': return g.readAdAccount(id);
    case 'ADS_CAMPAIGNS': return g.readCampaigns(id);
    case 'ADS_INSIGHTS': return g.readAdsInsights(id);
  }
}
function normalizarCapacidad(cap: CapacidadSync, json: unknown): ResumenNormalizado {
  switch (cap) {
    case 'BUSINESS_IDENTITY':
    case 'PAGE_IDENTITY': return { kind: cap, count: Array.isArray(json) ? (json as unknown[]).length : 0 };
    case 'INSTAGRAM_IDENTITY': return { kind: cap, identity: identidadWhitelist(json, ['id', 'username']) };
    case 'INSTAGRAM_MEDIA': return { kind: cap, count: contarData(json) };
    case 'INSTAGRAM_INSIGHTS': return { kind: cap, metrics: metricasInsights(json, ['reach', 'follower_count']) };
    case 'ADS_ACCOUNT': return { kind: cap, identity: identidadWhitelist(json, ['id', 'account_id', 'currency', 'account_status']) };
    case 'ADS_CAMPAIGNS': return { kind: cap, count: contarData(json) };
    case 'ADS_INSIGHTS': return { kind: cap, metrics: metricasInsights(json, ['impressions', 'clicks', 'spend', 'reach']) };
  }
}

// --- Orquestador con política de freshness -------------------------------------------------------

export interface DepsSync {
  /** Resuelve el token y crea el adapter Graph SÓLO cuando se invoca (permite no tocar el token si todo FRESH). */
  readonly resolverGraph: <T>(uso: (g: MetaGraphReadPort) => Promise<T>) => Promise<T>;
  readonly repo: MetaSyncRepo;
  readonly ahora: () => string;
  /** Override de TTL para tests (ms por capacidad). */
  readonly ttl?: Partial<Record<CapacidadSync, number>>;
}

export interface OpcionesSync {
  readonly force?: boolean;
}

/**
 * Sincroniza respetando freshness. `force` re-lee todo. Sin `force`, sólo lee capacidades STALE /
 * NEVER_SYNCED / DEGRADED / REAUTH_REQUIRED; las FRESH se saltan (sin llamada Graph). Fail parcial preserva
 * el último snapshot bueno. No lanza por un check: clasifica y continúa.
 */
export async function ejecutarSync(deps: DepsSync, organizationId: string, connectionId: string, bindings: readonly BindingMeta[], opciones: OpcionesSync = {}): Promise<EstadoSync> {
  const ahora = deps.ahora();
  const ahoraMs = Date.parse(ahora);
  const force = opciones.force === true;
  const ttl = (c: CapacidadSync): number => deps.ttl?.[c] ?? TTL_POR_CAPACIDAD[c];

  const snapsPrev = new Map((await deps.repo.listarSnapshots(organizationId, connectionId)).map((s) => [`${s.capability}:${s.externalId}`, s]));
  const estadoPrev = await deps.repo.obtenerEstado(organizationId, connectionId);
  const capPrev = new Map((estadoPrev?.capacidades ?? []).map((c) => [c.capability, c.estado]));

  const plan = capacidadesAplicables(bindings).map((a) => {
    const snap = snapsPrev.get(`${a.capability}:${a.externalId}`);
    const freshness = clasificarFreshness(snap, capPrev.get(a.capability), ttl(a.capability), ahoraMs);
    return { ...a, snap, freshness, needSync: force || freshness !== 'FRESH' };
  });
  const aSincronizar = plan.filter((p) => p.needSync);

  let auth = false, scope = false, degraded = false;
  const resultados = new Map<CapacidadSync, EstadoCapacidadSync>();

  if (aSincronizar.length > 0) {
    await deps.resolverGraph(async (g) => {
      for (const p of aSincronizar) {
        try {
          const json = await leerCapacidad(g, p.capability, p.externalId);
          const resumen = normalizarCapacidad(p.capability, json);
          await deps.repo.upsertSnapshot({ organizationId, connectionId, capability: p.capability, externalId: p.externalId, period: 'CURRENT', observedAt: ahora, source: 'meta', resumen });
          resultados.set(p.capability, { capability: p.capability, estado: 'OK', freshness: 'FRESH', observedAt: ahora });
        } catch (e) {
          // Fail parcial: NO se sobrescribe el snapshot previo (se preserva el último bueno).
          let estado: EstadoCapacidad = 'DEGRADED';
          let fr: Freshness = 'DEGRADED';
          if (e instanceof MetaAutenticacionError) { auth = true; estado = 'AUTH_FAILED'; fr = 'REAUTH_REQUIRED'; }
          else if (e instanceof MetaPermisoError) { scope = true; estado = 'SCOPE_MISSING'; fr = 'DEGRADED'; }
          else degraded = true;
          resultados.set(p.capability, { capability: p.capability, estado, freshness: fr, observedAt: p.snap?.observedAt ?? null });
        }
      }
      return 'ok';
    });
  }

  // Capacidades FRESH saltadas (sin Graph): conservan su snapshot.
  const capacidades: EstadoCapacidadSync[] = plan.map((p) =>
    resultados.get(p.capability) ?? { capability: p.capability, estado: 'SKIPPED_FRESH', freshness: 'FRESH', observedAt: p.snap?.observedAt ?? null },
  );

  const lastErrorClass: ClaseErrorSync = auth ? 'AUTH' : scope ? 'SCOPE' : degraded ? 'DEGRADED' : 'NONE';
  const saludConexion = auth ? 'TOKEN_EXPIRED' : scope ? 'SCOPE_MISSING' : degraded ? 'DEGRADED' : 'HEALTHY';
  const huboSyncReal = aSincronizar.length > 0 && lastErrorClass === 'NONE';
  const estado: EstadoSync = {
    organizationId,
    connectionId,
    lastSyncAt: ahora,
    lastSuccessfulSyncAt: huboSyncReal ? ahora : (estadoPrev?.lastSuccessfulSyncAt ?? null),
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
