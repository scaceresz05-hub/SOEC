/**
 * apps/api · CAPA DE COMPOSICIÓN · Adaptador REAL (READ ONLY) Google Ads → SOEC.
 *
 * Vive en la capa de composición (no en @soec/adaptadores, que prohíbe red/env por architecture-tests): aquí
 * sí se permite `fetch`. Extiende `AdaptadorRealBase`: la base aplica egress (default-deny), resuelve el
 * developer-token por referencia y sólo lo expone dentro de `invocar`. La ÚNICA operación soportada es la
 * consulta GAQL de sólo lectura vía `googleAds:searchStream`; NO existe ningún método de mutación
 * (mutate/create/update/remove/budget/bid/keyword/pause/enable). Los demás secretos (client_id/secret/refresh)
 * se resuelven dentro de `invocar` y se usan únicamente para obtener un access_token efímero de OAuth.
 *
 * ALLOWLIST DE HOST default-deny: sólo `googleads.googleapis.com` y `oauth2.googleapis.com`. Cualquier otro
 * host → error normalizado NO_AUTORIZADO (jamás wildcard). Los tokens (developer/access/refresh/client_secret)
 * NUNCA se registran ni se retornan en la salida.
 */
import type { RequestContext } from '@soec/contracts';
import { AdaptadorRealBase, type DependenciasAdaptadorReal, type SalidaAdaptador, errorNormalizado } from '@soec/adaptadores';

/** Allowlist cerrada de hosts autorizados (default-deny). Nunca comodines. */
const HOSTS_AUTORIZADOS = new Set<string>(['googleads.googleapis.com', 'oauth2.googleapis.com']);

/**
 * Versión de la API de Google Ads verificada para este conector (READ ONLY).
 * v21 quedó deprecada (sunset ago-2026) y devolvía HTTP 400 UNSUPPORTED_VERSION de forma intermitente.
 * v25 (jul-2026, soporte hasta ago-2027) validada 200/200 para snapshot, métricas diarias y search_term_view.
 */
const API_VERSION = 'v25';

/** Referencias OPACAS (nunca el valor) de los secretos de Google Ads. */
export interface RefsSecretosGoogleAds {
  readonly developerToken: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
}

export interface DependenciasGoogleAds extends Omit<DependenciasAdaptadorReal, 'secretRef'> {
  readonly secretRefs: RefsSecretosGoogleAds;
  /** Customer id gestor (MCC) que autoriza la consulta (header `login-customer-id`). */
  readonly loginCustomerId: string;
  /** `fetch` inyectable para tests deterministas; por defecto el global. */
  readonly fetchFn?: typeof fetch;
  /** Origen base de la API (default host productivo). Igual queda sujeto a la allowlist. */
  readonly apiBaseUrl?: string;
  /** URL del endpoint de token OAuth (default productivo). Igual queda sujeto a la allowlist. */
  readonly oauthTokenUrl?: string;
}

interface RespuestaToken {
  readonly access_token?: string;
}

export class GoogleAdsAdapter extends AdaptadorRealBase {
  readonly nombre = 'google-ads';
  readonly capacidad = 'ingesta-ads';
  readonly version = '1.0.0';

  private readonly secretRefs: RefsSecretosGoogleAds;
  private readonly loginCustomerId: string;
  private readonly fetchFn: typeof fetch;
  private readonly apiBaseUrl: string;
  private readonly oauthTokenUrl: string;

  constructor(deps: DependenciasGoogleAds) {
    // La base resuelve el developer-token y lo entrega a `invocar` como `secretoEnClaro`.
    super({ secretStore: deps.secretStore, esquemaEgress: deps.esquemaEgress, secretRef: deps.secretRefs.developerToken });
    this.secretRefs = deps.secretRefs;
    this.loginCustomerId = deps.loginCustomerId;
    this.fetchFn = deps.fetchFn ?? fetch;
    this.apiBaseUrl = (deps.apiBaseUrl ?? 'https://googleads.googleapis.com').replace(/\/+$/, '');
    this.oauthTokenUrl = deps.oauthTokenUrl ?? 'https://oauth2.googleapis.com/token';
  }

  /** Construye una URL y la verifica contra la allowlist (default-deny). null ⇒ host no autorizado o inválida. */
  private urlAutorizada(raw: string): URL | null {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return null;
    }
    return HOSTS_AUTORIZADOS.has(url.host) ? url : null;
  }

  /**
   * Obtiene un access_token efímero de OAuth. Recibe los secretos EN CLARO (sólo dentro de esta frontera) y
   * NUNCA los retorna ni registra. Devuelve el access_token o null si el intercambio falla.
   */
  private async obtenerAccessToken(clientId: string, clientSecret: string, refreshToken: string, signal?: AbortSignal): Promise<string | null> {
    const url = this.urlAutorizada(this.oauthTokenUrl);
    if (url === null) return null;
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });
    const res = await this.fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      ...(signal ? { signal } : {}),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as RespuestaToken;
    return json.access_token ?? null;
  }

  protected async invocar(
    ctx: RequestContext,
    developerTokenEnClaro: string,
    datosSalientes: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ): Promise<SalidaAdaptador> {
    const query = datosSalientes.query;
    const customerId = datosSalientes.customerId;
    if (!query || !customerId) {
      return { estado: 'ERROR', salida: null, error: errorNormalizado('INVALIDO', 'faltan query/customerId (egress)') };
    }

    // 1) OAuth: resolvemos client_id/secret/refresh y obtenemos el access_token DENTRO de `usar` (nested), de
    //    modo que ningún secreto persistente escape del ámbito de frontera. `usar` rechaza devolver el valor
    //    en claro (FugaDeSecretoError), por eso NO se hace `.usar(v=>v)`: el trabajo ocurre dentro del callback.
    const refCid = await this.deps.secretStore.resolver(ctx, this.secretRefs.clientId);
    const refSec = await this.deps.secretStore.resolver(ctx, this.secretRefs.clientSecret);
    const refRef = await this.deps.secretStore.resolver(ctx, this.secretRefs.refreshToken);
    const accessToken = await refCid.usar((clientId) =>
      refSec.usar((clientSecret) =>
        refRef.usar((refreshToken) => this.obtenerAccessToken(clientId, clientSecret, refreshToken, signal)),
      ),
    );
    if (!accessToken) {
      return { estado: 'ERROR', salida: null, error: errorNormalizado('NO_AUTORIZADO', 'no se pudo obtener access_token de OAuth') };
    }

    // 2) GAQL searchStream (READ ONLY). Verificamos el host antes del fetch (default-deny).
    const url = this.urlAutorizada(`${this.apiBaseUrl}/${API_VERSION}/customers/${customerId}/googleAds:searchStream`);
    if (url === null) {
      return { estado: 'ERROR', salida: null, error: errorNormalizado('NO_AUTORIZADO', 'host no autorizado (egress default-deny)') };
    }
    const res = await this.fetchFn(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'developer-token': developerTokenEnClaro,
        'login-customer-id': this.loginCustomerId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
      ...(signal ? { signal } : {}),
    });
    if (!res.ok) {
      // No se filtra cuerpo del proveedor ni token: sólo la clase del fallo.
      return { estado: 'ERROR', salida: null, error: errorNormalizado('NO_DISPONIBLE', `respuesta HTTP ${res.status}`) };
    }
    return { estado: 'OK', salida: { body: await res.text() }, error: null };
  }
}
