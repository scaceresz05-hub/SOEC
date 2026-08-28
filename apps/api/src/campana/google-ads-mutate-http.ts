/**
 * apps/api · campana · TRANSPORTE HTTP de ESCRITURA de Google Ads (`GoogleAdsApiClient`). Cliente de bajo nivel
 * que el `GoogleAdsRealMutatePort` necesita: recibe UNA operación ya certificada por el translator y la envía al
 * endpoint `:mutate` correspondiente. NO reimplementa translator ni port — sólo transporta.
 *
 * TOKEN (P0): el access_token se resuelve por un THUNK inyectado que usa la CONEXIÓN OAuth REAL por tenant
 * (refresh token CIFRADO) — la misma vía que el descubrimiento de cuentas / refresh, la que funciona en prod.
 * NUNCA `env:GOOGLE_ADS_REFRESH_TOKEN` (ausente en prod). Host allowlist default-deny, developer-token +
 * login-customer-id (manager). Secretos JAMÁS se registran.
 *
 * DIAGNÓSTICO SEGURO: `validateOnly=true` valida la mutación como si fuera real pero Google NO ejecuta (no crea
 * recursos ni gasta). El error de Google (status/code/message) y el `request-id` se registran SANITIZADOS.
 */
import type { GoogleAdsApiClient, GoogleAdsOperation } from './google-ads-real-port';
import type { GoogleAdsMutateRequest } from './google-ads-materializer';

/** Un elemento del path de campo del GoogleAdsFailure (`errors[].location.fieldPathElements[]`). */
export interface FieldPathElement {
  readonly fieldName: string;
  /** Presente sólo para campos repetidos (p.ej. `mutate_operations[1]`). */
  readonly index?: number;
}

/**
 * Un error del `GoogleAdsFailure` preservado SANITIZADO. `errorPath`/`operationIndex` se DERIVAN de
 * `fieldPathElements` (nunca por orden): son la evidencia que dice qué campo/operación falló.
 */
export interface GoogleAdsErrorDetalle {
  readonly errorCode: string | null;   // p.ej. "fieldError:REQUIRED"
  readonly message: string | null;
  readonly trigger: string | null;     // valor ofensivo que Google eco (sanitizado, cap 200)
  readonly fieldPathElements: readonly FieldPathElement[];
  readonly errorPath: string | null;   // "mutate_operations[1].campaign_operation.create.<campo>"
  readonly operationIndex: number | null; // índice de la operación (sólo si Google da el index)
}

/** Resultado sanitizado de una llamada al proveedor (validate o real). Sin secretos. */
export interface ResultadoProveedor {
  readonly ok: boolean;
  readonly httpStatus: number;
  readonly requestId: string | null;
  readonly validateOnly: boolean;
  readonly operationCount: number;
  readonly resultsCount: number;
  readonly errorStatus: string | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  /** TODOS los errores de Google en orden (evidencia completa: path, trigger, code, message). */
  readonly googleErrors: readonly GoogleAdsErrorDetalle[];
  /** Resource names REALES por operación (en orden), para mapear bindings sin fabricar IDs. Vacío en error. */
  readonly results: readonly { readonly resourceName: string | null }[];
  readonly partialFailure: boolean;
}

/** Región geo resuelta por Google (SuggestGeoTargetConstants). */
export interface GeoTargetSugerido {
  readonly name: string;
  readonly canonicalName: string;
  readonly criterionId: string;
  readonly targetType: string;
  readonly countryCode: string;
  readonly status: string;
}

const HOSTS_AUTORIZADOS = new Set<string>(['googleads.googleapis.com', 'oauth2.googleapis.com']);
const API_VERSION = 'v25';

/** resource_type Google → colección REST del endpoint `:mutate`. */
const COLECCION: Record<string, string> = {
  campaign_budget: 'campaignBudgets',
  campaign: 'campaigns',
  ad_group: 'adGroups',
  ad_group_ad: 'adGroupAds',
  ad_group_criterion: 'adGroupCriteria',
  campaign_criterion: 'campaignCriteria',
};

export interface GoogleAdsWriteLog {
  readonly service: string;
  readonly endpoint: string;
  readonly customerId: string;
  readonly loginCustomerId: string;
  readonly httpStatus: number | null;
  readonly requestId: string | null;
  readonly errorStatus: string | null;
  readonly errorCode: string | null;
  /**
   * Mensaje de error de Google (SANITIZADO, cap 600 chars). Para un error de TRANSCODING JSON
   * ("Invalid JSON payload received. Unknown name X at '<path>'") NO hay `errorCode` — el nombre del
   * campo inválido vive SÓLO aquí. Antes se descartaba, y ese fue el punto ciego que impidió el
   * diagnóstico. No contiene secretos (es la queja de schema de Google: path + nombre de campo).
   */
  readonly errorMessage: string | null;
  readonly validateOnly: boolean;
  readonly ok: boolean;
}

/** Recorta el mensaje de Google para el log durable (evita payloads patológicos; no expone secretos). */
function mensajeSanitizado(m: string | null): string | null {
  return m ? m.slice(0, 600) : null;
}

export interface DepsGoogleAdsMutateHttp {
  /** Resuelve un access_token efímero desde la conexión REAL (refresh token cifrado por tenant). */
  readonly resolverAccessToken: () => Promise<string | null>;
  readonly developerToken: string;
  readonly loginCustomerId: string;
  readonly validateOnly?: boolean;
  /** Sink de logging SANITIZADO (sin secretos). */
  readonly logger?: (info: GoogleAdsWriteLog) => void;
  readonly fetchFn?: typeof fetch;
  readonly apiBaseUrl?: string;
}

function urlAutorizada(raw: string): URL | null {
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  return HOSTS_AUTORIZADOS.has(url.host) ? url : null;
}

interface RawGoogleError {
  readonly errorCode?: Record<string, unknown>;
  readonly message?: string;
  readonly trigger?: unknown;
  readonly location?: { fieldPathElements?: Array<{ fieldName?: string; index?: number }> };
}

function cap(s: string | null | undefined, n = 600): string | null {
  return s ? s.slice(0, n) : null;
}

/** El `trigger` (google.protobuf.Value) puede ser cualquier tipo; lo sanitizamos a string acotado. */
function triggerSanitizado(t: unknown): string | null {
  if (t === null || t === undefined) return null;
  return cap(typeof t === 'string' ? t : JSON.stringify(t), 200);
}

/** Un error crudo → detalle preservado. `errorPath`/`operationIndex` se DERIVAN de fieldPathElements. */
function mapearError(e: RawGoogleError): GoogleAdsErrorDetalle {
  const errorCode = e.errorCode && Object.keys(e.errorCode).length > 0 ? Object.entries(e.errorCode).map(([k, v]) => `${k}:${String(v)}`).join('|') : null;
  const fieldPathElements: FieldPathElement[] = (e.location?.fieldPathElements ?? []).map((p) => (typeof p.index === 'number' ? { fieldName: String(p.fieldName ?? ''), index: p.index } : { fieldName: String(p.fieldName ?? '') }));
  // NO se trunca el path ni los nombres de campo (son la evidencia que necesitamos).
  const errorPath = fieldPathElements.length > 0 ? fieldPathElements.map((p) => (p.index !== undefined ? `${p.fieldName}[${p.index}]` : p.fieldName)).join('.') : null;
  const opEl = fieldPathElements.find((p) => p.fieldName === 'mutate_operations');
  const operationIndex = opEl && opEl.index !== undefined ? opEl.index : null; // sólo desde el index de Google
  return { errorCode, message: cap(e.message), trigger: triggerSanitizado(e.trigger), fieldPathElements, errorPath, operationIndex };
}

/**
 * Parsea el `GoogleAdsFailure` COMPLETO del cuerpo de error (sin exponer secretos): TODOS los errores en
 * orden, cada uno con code/message/trigger/fieldPathElements + path/index derivados. Para un error de
 * transcoding (sin `details[].errors[]`, p.ej. "Unknown name X") sintetiza un único detalle desde `error.message`.
 */
function parseGoogleAdsFailure(texto: string): { status: string | null; googleErrors: GoogleAdsErrorDetalle[] } {
  try {
    const j = JSON.parse(texto) as { error?: { status?: string; message?: string; details?: Array<{ errors?: RawGoogleError[] }> } };
    const err = j.error;
    const crudos: RawGoogleError[] = (err?.details ?? []).flatMap((d) => d.errors ?? []);
    if (crudos.length === 0) {
      const message = cap(err?.message);
      return { status: err?.status ?? null, googleErrors: message ? [{ errorCode: null, message, trigger: null, fieldPathElements: [], errorPath: null, operationIndex: null }] : [] };
    }
    return { status: err?.status ?? null, googleErrors: crudos.map(mapearError) };
  } catch {
    return { status: null, googleErrors: [] };
  }
}

export class GoogleAdsMutateHttpClient implements GoogleAdsApiClient {
  private readonly fetchFn: typeof fetch;
  private readonly apiBaseUrl: string;
  constructor(private readonly deps: DepsGoogleAdsMutateHttp) {
    this.fetchFn = deps.fetchFn ?? fetch;
    this.apiBaseUrl = (deps.apiBaseUrl ?? 'https://googleads.googleapis.com').replace(/\/+$/, '');
  }

  async aplicar(op: GoogleAdsOperation): Promise<{ resourceName: string }> {
    const coleccion = COLECCION[op.resourceType];
    if (!coleccion) throw new Error(`RESOURCE_NO_SOPORTADO: ${op.resourceType}`);
    const accessToken = await this.deps.resolverAccessToken();
    if (!accessToken) throw new Error('NO_ACCESS_TOKEN'); // conexión sin token válido (causa del fallo previo)
    const url = urlAutorizada(`${this.apiBaseUrl}/${API_VERSION}/customers/${op.customerId}/${coleccion}:mutate`);
    if (url === null) throw new Error('HOST_NO_AUTORIZADO');

    const esCreate = op.operation.endsWith('.create');
    const operacion = esCreate ? { create: op.fields } : { update: op.fields, updateMask: Object.keys(op.fields).join(',') };
    const validateOnly = this.deps.validateOnly === true;
    const body = { operations: [operacion], ...(validateOnly ? { validateOnly: true } : {}) };

    const res = await this.fetchFn(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'developer-token': this.deps.developerToken, 'login-customer-id': this.deps.loginCustomerId, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const requestId = res.headers.get('request-id') ?? res.headers.get('x-request-id') ?? null;
    const logBase = { service: coleccion, endpoint: `${coleccion}:mutate`, customerId: op.customerId, loginCustomerId: this.deps.loginCustomerId, httpStatus: res.status, requestId, validateOnly };

    if (!res.ok) {
      const f = parseGoogleAdsFailure(await res.text());
      const primero = f.googleErrors[0];
      this.deps.logger?.({ ...logBase, errorStatus: f.status, errorCode: primero?.errorCode ?? null, errorMessage: mensajeSanitizado(primero?.message ?? null), ok: false });
      // El mensaje NO lleva secretos: sólo status HTTP, errorCode de Google y request-id (para trazar el fallo).
      throw new Error(`GOOGLE_MUTATE_HTTP_${res.status}${f.status ? `:${f.status}` : ''}${primero?.errorCode ? `:${primero.errorCode}` : ''}${requestId ? `:req=${requestId}` : ''}`);
    }
    this.deps.logger?.({ ...logBase, errorStatus: null, errorCode: null, errorMessage: null, ok: true });
    // validate_only exitoso ⇒ Google NO crea recurso (results vacío): sentinela, nunca un resourceName inventado.
    if (validateOnly) return { resourceName: 'VALIDATE_ONLY_OK' };
    const json = (await res.json()) as { results?: Array<{ resourceName?: string }> };
    const resourceName = json.results?.[0]?.resourceName;
    if (!resourceName) throw new Error('SIN_RESOURCE_NAME');
    return { resourceName };
  }

  /**
   * GoogleAdsService.Mutate del GRAFO COMPLETO (multi-resource, temporary resource names, partialFailure). La
   * request YA incluye validateOnly/partialFailure. Devuelve un resultado SANITIZADO (status/errorCode/request-id)
   * — nunca lanza por error de Google (el caller decide), pero sí ante fallos de infra (token/host).
   */
  async mutarGrafo(customerId: string, request: GoogleAdsMutateRequest): Promise<ResultadoProveedor> {
    const accessToken = await this.deps.resolverAccessToken();
    if (!accessToken) throw new Error('NO_ACCESS_TOKEN');
    const url = urlAutorizada(`${this.apiBaseUrl}/${API_VERSION}/customers/${customerId}/googleAds:mutate`);
    if (url === null) throw new Error('HOST_NO_AUTORIZADO');
    const validateOnly = request.validateOnly === true;
    const res = await this.fetchFn(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'developer-token': this.deps.developerToken, 'login-customer-id': this.deps.loginCustomerId, 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    const requestId = res.headers.get('request-id') ?? res.headers.get('x-request-id') ?? null;
    const logBase = { service: 'googleAds:mutate', endpoint: 'googleAds:mutate', customerId, loginCustomerId: this.deps.loginCustomerId, httpStatus: res.status, requestId, validateOnly };
    const texto = await res.text();
    let resultsCount = 0;
    let results: { resourceName: string | null }[] = [];
    if (res.ok) {
      // La respuesta del AGGREGATE `googleAds:mutate` es `mutateOperationResponses[]` (una por operación, en orden),
      // cada una con un resultado por-TIPO (campaignResult/campaignBudgetResult/…) que lleva `resourceName`. NO es
      // `results[]` (ése es el formato de los `:mutate` POR-SERVICIO). Leer el campo equivocado dejaba 0 recursos
      // ⇒ "0 creados" pese a HTTP 200. Se soporta `results[]` como fallback para el transporte por-servicio.
      try {
        const j = JSON.parse(texto) as { mutateOperationResponses?: Array<Record<string, unknown>>; results?: Array<{ resourceName?: string }> };
        if (Array.isArray(j.mutateOperationResponses)) {
          results = j.mutateOperationResponses.map((r) => {
            const inner = Object.values(r).find((v) => v && typeof v === 'object' && 'resourceName' in (v as object)) as { resourceName?: string } | undefined;
            return { resourceName: inner?.resourceName ?? null };
          });
        } else if (Array.isArray(j.results)) {
          results = j.results.map((x) => ({ resourceName: x.resourceName ?? null }));
        }
        resultsCount = results.filter((x) => x.resourceName).length; // recursos REALES creados (con resourceName)
      } catch { /* validate ⇒ body vacío/sin responses */ }
      this.deps.logger?.({ ...logBase, errorStatus: null, errorCode: null, errorMessage: null, ok: true });
    } else {
      const f = parseGoogleAdsFailure(texto);
      const primero = f.googleErrors[0];
      // El GoogleAdsFailure COMPLETO (todos los errores, con fieldPathElements/trigger/path) se devuelve para
      // persistir. El log durable conserva el resumen (status/code/message del primero).
      this.deps.logger?.({ ...logBase, errorStatus: f.status, errorCode: primero?.errorCode ?? null, errorMessage: mensajeSanitizado(primero?.message ?? null), ok: false });
      return { ok: false, httpStatus: res.status, requestId, validateOnly, operationCount: request.mutateOperations.length, resultsCount: 0, errorStatus: f.status, errorCode: primero?.errorCode ?? null, errorMessage: mensajeSanitizado(primero?.message ?? null), googleErrors: f.googleErrors, results: [], partialFailure: false };
    }
    return { ok: true, httpStatus: res.status, requestId, validateOnly, operationCount: request.mutateOperations.length, resultsCount, errorStatus: null, errorCode: null, errorMessage: null, googleErrors: [], results, partialFailure: false };
  }

  /**
   * GeoTargetConstantService.SuggestGeoTargetConstants (READ ONLY). Resuelve nombres de región → criterionId real.
   * countryCode filtra a Chile; el caller verifica targetType/targetable/nivel. No muta ni gasta.
   */
  async sugerirGeoTargets(nombres: readonly string[], countryCode: string, locale = 'es'): Promise<readonly GeoTargetSugerido[]> {
    const accessToken = await this.deps.resolverAccessToken();
    if (!accessToken) throw new Error('NO_ACCESS_TOKEN');
    const url = urlAutorizada(`${this.apiBaseUrl}/${API_VERSION}/geoTargetConstants:suggest`);
    if (url === null) throw new Error('HOST_NO_AUTORIZADO');
    const res = await this.fetchFn(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'developer-token': this.deps.developerToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ locale, countryCode, locationNames: { names: [...nombres] } }),
    });
    if (!res.ok) throw new Error(`GEO_SUGGEST_HTTP_${res.status}`);
    const j = (await res.json()) as { geoTargetConstantSuggestions?: Array<{ geoTargetConstant?: { resourceName?: string; name?: string; canonicalName?: string; targetType?: string; countryCode?: string; status?: string; id?: string } }> };
    return (j.geoTargetConstantSuggestions ?? []).map((s) => {
      const g = s.geoTargetConstant ?? {};
      const criterionId = g.id ?? (g.resourceName ?? '').replace(/^geoTargetConstants\//, '');
      return { name: g.name ?? '', canonicalName: g.canonicalName ?? '', criterionId, targetType: g.targetType ?? '', countryCode: g.countryCode ?? '', status: g.status ?? '' };
    });
  }

  /**
   * GoogleAdsService.SearchStream (READ ONLY). Ejecuta una consulta GAQL y devuelve las filas APLANADAS (cada fila
   * = objeto con los recursos seleccionados). NO muta NADA (recuperación de identidad). Host allowlist + token por
   * conexión. searchStream responde un array de batches [{results:[…]}]; se tolera también {results:[…]}.
   */
  async buscar(customerId: string, query: string): Promise<Array<Record<string, unknown>>> {
    const accessToken = await this.deps.resolverAccessToken();
    if (!accessToken) throw new Error('NO_ACCESS_TOKEN');
    const url = urlAutorizada(`${this.apiBaseUrl}/${API_VERSION}/customers/${customerId}/googleAds:searchStream`);
    if (url === null) throw new Error('HOST_NO_AUTORIZADO');
    const res = await this.fetchFn(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'developer-token': this.deps.developerToken, 'login-customer-id': this.deps.loginCustomerId, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) throw new Error(`GOOGLE_SEARCH_HTTP_${res.status}`);
    const parsed = JSON.parse(await res.text()) as unknown;
    const batches = Array.isArray(parsed) ? parsed : [parsed];
    const filas: Array<Record<string, unknown>> = [];
    for (const b of batches) { const rs = (b as { results?: Array<Record<string, unknown>> }).results; if (Array.isArray(rs)) filas.push(...rs); }
    return filas;
  }
}
