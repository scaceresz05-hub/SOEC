/**
 * apps/api · CAPA DE COMPOSICIÓN · Adaptador REAL de ingesta SmileFlow Growth → SOEC.
 *
 * Vive en la capa de composición (no en @soec/adaptadores, que prohíbe red/env por architecture-tests):
 * aquí sí se permite `fetch`. Extiende `AdaptadorRealBase`: la base aplica egress (default-deny), resuelve
 * el secreto por referencia y sólo lo expone dentro de `invocar`. La ÚNICA parte específica del proveedor es
 * el método `invocar`, que golpea el endpoint M2M productivo con el token en el header `X-Ingest-Token`.
 *
 * ALLOWLIST DE HOST default-deny: sólo se permite el host productivo conocido. Cualquier otro host devuelve
 * un error normalizado (nunca wildcard). El token JAMÁS se registra ni se retorna en la salida.
 */
import type { RequestContext } from '@soec/contracts';
import { AdaptadorRealBase, type DependenciasAdaptadorReal, type SalidaAdaptador, errorNormalizado } from '@soec/adaptadores';

/** Allowlist cerrada de hosts autorizados (default-deny). Nunca comodines. */
const HOSTS_AUTORIZADOS = new Set<string>(['smileflow-clinic-production.up.railway.app']);

const RUTA_M2M = '/integrations/soec/growth-events';

export interface DependenciasSmileFlowGrowth extends DependenciasAdaptadorReal {
  /** Origen base del servicio M2M (p. ej. https://smileflow-clinic-production.up.railway.app). */
  readonly baseUrl: string;
  /** `fetch` inyectable para tests deterministas; por defecto el global. */
  readonly fetchFn?: typeof fetch;
}

export class SmileFlowGrowthAdapter extends AdaptadorRealBase {
  readonly nombre = 'smileflow-growth';
  readonly capacidad = 'ingesta-growth';
  readonly version = '1.0.0';

  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(deps: DependenciasSmileFlowGrowth) {
    super(deps);
    this.baseUrl = deps.baseUrl;
    this.fetchFn = deps.fetchFn ?? fetch;
  }

  protected async invocar(
    _ctx: RequestContext,
    secretoEnClaro: string,
    datosSalientes: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ): Promise<SalidaAdaptador> {
    let url: URL;
    try {
      url = new URL(this.baseUrl.replace(/\/+$/, '') + RUTA_M2M);
    } catch {
      return { estado: 'ERROR', salida: null, error: errorNormalizado('INVALIDO', 'baseUrl inválida') };
    }
    // EGRESS de host: default-deny. Sólo el host productivo conocido puede recibir el token.
    if (!HOSTS_AUTORIZADOS.has(url.host)) {
      return { estado: 'ERROR', salida: null, error: errorNormalizado('NO_AUTORIZADO', `host no autorizado (egress default-deny): ${url.host}`) };
    }
    // Los parámetros ya vienen minimizados por el esquema de egress de la base.
    for (const [clave, valor] of Object.entries(datosSalientes)) url.searchParams.set(clave, valor);

    const res = await this.fetchFn(url, { headers: { 'X-Ingest-Token': secretoEnClaro }, signal });
    if (!res.ok) {
      // No se filtra cuerpo del proveedor ni el token: sólo la clase del fallo.
      return { estado: 'ERROR', salida: null, error: errorNormalizado('NO_DISPONIBLE', `respuesta HTTP ${res.status}`) };
    }
    return { estado: 'OK', salida: { body: await res.text() }, error: null };
  }
}
