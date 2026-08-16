/**
 * apps/api · Contratos de LECTURA ORGÁNICA de Meta (media, insights) + semántica de valor + SANITIZACIÓN
 * de tokens. Representa lo YA PROBADO por Graph; NO abre red, NO persiste raw, NO expone tokens.
 *
 * Seguridad (crítico): las respuestas Graph de insights traen `paging.next/previous` con
 * `access_token=<SECRET>` (y a veces `appsecret_proof`). SOEC NUNCA loggea/persiste esas URLs crudas.
 * `sanitizarGraph` redacta el token ANTES de cualquier log/telemetría/persistencia, descarta las URLs
 * de paging completas y conserva sólo cursors. `RAW_GRAPH_RESPONSE_PERSISTENCE = FORBIDDEN`.
 */

// ---------------------------------------------------------------------------
// SANITIZACIÓN DE TOKENS (FASE 9-11) — la parte de seguridad
// ---------------------------------------------------------------------------

/** Claves de query que NUNCA deben salir en logs/persistencia. */
export const CLAVES_SECRETAS_URL = ['access_token', 'appsecret_proof'] as const;

const PATRON_SECRETO_URL = `([?&](?:${CLAVES_SECRETAS_URL.join('|')})=)[^&#\\s]*`;
/** Detección (NO global: `.test()` sería stateful con la flag `g`). */
const RE_DETECCION = new RegExp(PATRON_SECRETO_URL, 'i');

/** ¿La cadena parece una URL de Graph con un secreto embebido? */
export function contieneTokenEnUrl(s: unknown): boolean {
  return typeof s === 'string' && RE_DETECCION.test(s);
}

/** Redacta `access_token`/`appsecret_proof` de una URL, preservando el resto de los parámetros. */
export function redactarUrl(url: string): string {
  return url.replace(new RegExp(PATRON_SECRETO_URL, 'gi'), '$1[REDACTED]');
}

export interface PagingCursors {
  readonly before?: string;
  readonly after?: string;
}

/**
 * Sanitiza el bloque `paging`: DESCARTA `next`/`previous` (URLs con token) y conserva sólo los cursors,
 * que es lo único que necesitamos para paginar.
 */
export function sanitizarPaging(paging: unknown): { readonly cursors?: PagingCursors } {
  if (!paging || typeof paging !== 'object') return {};
  const p = paging as { cursors?: { before?: unknown; after?: unknown } };
  if (!p.cursors || typeof p.cursors !== 'object') return {};
  const cursors: PagingCursors = {};
  const before = p.cursors.before;
  const after = p.cursors.after;
  return {
    cursors: {
      ...(typeof before === 'string' ? { before } : {}),
      ...(typeof after === 'string' ? { after } : {}),
    } as PagingCursors,
  };
}

/**
 * Sanitiza recursivamente un envelope de Graph ANTES de loggear/persistir: descarta `next`/`previous`,
 * reduce `paging` a cursors, y redacta cualquier token embebido en strings tipo URL. Idempotente.
 */
export function sanitizarGraph(value: unknown): unknown {
  if (typeof value === 'string') return contieneTokenEnUrl(value) ? redactarUrl(value) : value;
  if (Array.isArray(value)) return value.map(sanitizarGraph);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === 'paging') {
        out[k] = sanitizarPaging(v);
        continue;
      }
      if ((k === 'next' || k === 'previous') && typeof v === 'string') continue; // descartar URL completa
      out[k] = sanitizarGraph(v);
    }
    return out;
  }
  return value;
}

/** Serializador SEGURO para logs/telemetría: nunca emite tokens (sanitiza primero). */
export function serializarSeguro(value: unknown): string {
  return JSON.stringify(sanitizarGraph(value));
}

/** Política explícita: prohibido persistir/loggear la respuesta cruda de Graph sin sanitizar. */
export const RAW_GRAPH_RESPONSE_PERSISTENCE = 'FORBIDDEN' as const;

// ---------------------------------------------------------------------------
// SEMÁNTICA DE VALOR DE MÉTRICA (FASE 7) — nunca null/missing/error → 0
// ---------------------------------------------------------------------------

export type ClaseValorMetrica =
  | 'VALUE'
  | 'ZERO'
  | 'NO_DATA'
  | 'NOT_SUPPORTED'
  | 'PERMISSION_MISSING'
  | 'PRIVACY_THRESHOLD'
  | 'DEPRECATED'
  | 'ERROR';

export interface ValorMetrica {
  readonly clase: ClaseValorMetrica;
  readonly valor: number | null; // sólo no-null cuando clase es VALUE o ZERO
}

export interface EntradaMetricaCruda {
  readonly present: boolean; // ¿el campo vino en la respuesta?
  readonly value: number | null; // valor si vino
  readonly emptyData?: boolean; // data: []
  readonly errorCode?: number | null; // código de error de Graph si hubo
  readonly notSupported?: boolean;
  readonly deprecated?: boolean;
}

const CODIGOS_PERMISO = new Set<number>([10, 200, 803]);

/**
 * Clasifica el valor de una métrica de Graph con semántica explícita. Reglas duras:
 *   · value=0 ⇒ ZERO (cero real, no ausencia); número ⇒ VALUE;
 *   · campo ausente / data=[] ⇒ NO_DATA;  error de permiso ⇒ PERMISSION_MISSING;
 *   · nunca null/missing/error/unsupported ⇒ 0.
 */
export function clasificarValorMetrica(e: EntradaMetricaCruda): ValorMetrica {
  if (e.errorCode != null && CODIGOS_PERMISO.has(e.errorCode)) return { clase: 'PERMISSION_MISSING', valor: null };
  if (e.errorCode != null) return { clase: 'ERROR', valor: null };
  if (e.deprecated) return { clase: 'DEPRECATED', valor: null };
  if (e.notSupported) return { clase: 'NOT_SUPPORTED', valor: null };
  if (e.emptyData || !e.present) return { clase: 'NO_DATA', valor: null };
  if (e.value === null) return { clase: 'NO_DATA', valor: null };
  return e.value === 0 ? { clase: 'ZERO', valor: 0 } : { clase: 'VALUE', valor: e.value };
}

// ---------------------------------------------------------------------------
// INVENTARIO DE MEDIA (FASE 5)
// ---------------------------------------------------------------------------

export type MediaTypeMeta = 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM' | 'REELS' | 'UNKNOWN';

export interface MediaMeta {
  readonly organizationId: string;
  readonly provider: 'meta';
  readonly igsid: string;
  readonly externalMediaId: string; // clave externa (NO permalink, NO caption)
  readonly mediaType: MediaTypeMeta;
  readonly mediaProductType: string | null;
  readonly timestamp: string | null;
  readonly permalink: string | null;
  readonly caption: string | null; // sujeto a política de contenido/sanitización existente
  readonly syncObservedAt: string;
}

/** Clave de identidad tenant-scoped de un media. Un externalMediaId de otro tenant NO colisiona. */
export function claveMedia(m: Pick<MediaMeta, 'organizationId' | 'provider' | 'igsid' | 'externalMediaId'>): string {
  return `${m.organizationId}:${m.provider}:${m.igsid}:${m.externalMediaId}`;
}

export interface PaginaMedia {
  readonly items: readonly MediaMeta[];
  readonly cursors?: PagingCursors; // soporta paginación futura aunque hoy 11 quepan en una página
}

// ---------------------------------------------------------------------------
// INSIGHTS DE MEDIA (FASE 6) — núcleo común + extensiones por tipo
// ---------------------------------------------------------------------------

export interface MetricasComunesMedia {
  readonly reach: ValorMetrica;
  readonly views: ValorMetrica;
  readonly likes: ValorMetrica;
  readonly comments: ValorMetrica;
  readonly saved: ValorMetrica;
  readonly shares: ValorMetrica;
  readonly total_interactions: ValorMetrica;
}

/** Métricas específicas de REELS. Watch time en MILISEGUNDOS (no se convierte a segundos). */
export interface MetricasReels {
  readonly ig_reels_avg_watch_time_ms: ValorMetrica;
  readonly ig_reels_video_view_total_time_ms: ValorMetrica;
}

export const UNIDAD_WATCH_TIME = 'milliseconds' as const;

export interface MediaInsights {
  readonly externalMediaId: string;
  readonly mediaType: MediaTypeMeta;
  readonly comunes: MetricasComunesMedia;
  /** Presente sólo para REELS. */
  readonly reels?: MetricasReels;
}
