/**
 * apps/api · CAPA DE COMPOSICIÓN · Adaptador REAL de ingesta GROWTH → SOEC (agnóstico de proveedor).
 *
 * Vive en la capa de composición (no en @soec/adaptadores, que prohíbe red/env por architecture-tests):
 * aquí sí se permite `fetch`. Extiende `AdaptadorRealBase`: la base aplica egress (default-deny), resuelve
 * el secreto por referencia y sólo lo expone dentro de `invocar`. La ÚNICA parte específica del proveedor
 * es `invocar`, que golpea el endpoint M2M con el token en el header `X-Ingest-Token`.
 *
 * LO QUE CAMBIA RESPECTO DE LA VERSIÓN ANTERIOR: ni el nombre del proveedor, ni el host, ni la ruta, ni la
 * referencia de credencial viven ya en este archivo. Los aporta la FUENTE REGISTRADA de la organización
 * (`DescriptorFuenteGrowth`). SmileFlow deja de ser el comportamiento universal y pasa a ser una fuente más.
 *
 * ALLOWLIST DE HOST default-deny: sólo los hosts que la fuente autoriza explícitamente. Lista vacía ⇒ no se
 * autoriza NINGÚN host (nunca "permitir todo"). Cualquier otro host devuelve un error normalizado, nunca
 * comodines. El token JAMÁS se registra ni se retorna en la salida.
 */
import type { RequestContext } from '@soec/contracts';
import {
  AdaptadorRealBase,
  type DependenciasAdaptadorReal,
  type EsquemaSalida,
  type SalidaAdaptador,
  errorNormalizado,
} from '@soec/adaptadores';
import type { SecretStore } from '@soec/secretos';
import type { DescriptorFuenteGrowth } from '../plataforma';

/** Capacidad única de esta familia de adaptadores. No depende del proveedor. */
export const CAPACIDAD_INGESTA_GROWTH = 'ingesta-growth' as const;

export interface DependenciasGrowth extends DependenciasAdaptadorReal {
  /** Provider de la FUENTE registrada. Es también el nombre del adaptador: no hay nombre genérico. */
  readonly provider: string;
  /** Origen base del servicio M2M (p. ej. https://<host>). */
  readonly baseUrl: string;
  /** Allowlist CERRADA de hosts. Vacía ⇒ deniega todo. Nunca comodines. */
  readonly hostsAutorizados: readonly string[];
  /** Ruta del endpoint de ingesta (debe empezar por `/`). */
  readonly rutaIngesta: string;
  /** `fetch` inyectable para tests deterministas; por defecto el global. */
  readonly fetchFn?: typeof fetch;
}

export class GrowthAdapter extends AdaptadorRealBase {
  readonly nombre: string;
  readonly capacidad = CAPACIDAD_INGESTA_GROWTH;
  readonly version = '1.0.0';

  private readonly baseUrl: string;
  private readonly hostsAutorizados: ReadonlySet<string>;
  private readonly rutaIngesta: string;
  private readonly fetchFn: typeof fetch;

  constructor(deps: DependenciasGrowth) {
    super(deps);
    const provider = (deps.provider ?? '').trim();
    if (!provider) throw new Error('GrowthAdapter: provider requerido (lo aporta la fuente registrada)');
    this.nombre = provider;
    this.baseUrl = deps.baseUrl;
    // Copia defensiva: la allowlist no puede mutarse después de construido el adaptador.
    this.hostsAutorizados = new Set(deps.hostsAutorizados ?? []);
    this.rutaIngesta = deps.rutaIngesta;
    this.fetchFn = deps.fetchFn ?? fetch;
  }

  protected async invocar(
    _ctx: RequestContext,
    secretoEnClaro: string,
    datosSalientes: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ): Promise<SalidaAdaptador> {
    if (!this.rutaIngesta.startsWith('/')) {
      return { estado: 'ERROR', salida: null, error: errorNormalizado('INVALIDO', 'rutaIngesta inválida (debe empezar por "/")') };
    }
    let url: URL;
    try {
      url = new URL(this.baseUrl.replace(/\/+$/, '') + this.rutaIngesta);
    } catch {
      return { estado: 'ERROR', salida: null, error: errorNormalizado('INVALIDO', 'baseUrl inválida') };
    }
    // EGRESS de host: default-deny. Sólo los hosts que la FUENTE autoriza pueden recibir el token.
    // Allowlist vacía ⇒ no pasa nadie: la ausencia de configuración nunca significa "permitir todo".
    if (!this.hostsAutorizados.has(url.host)) {
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

/**
 * Construye el adaptador de ingesta a partir del DESCRIPTOR de la fuente registrada. Ésta es la puerta
 * normal de wiring: ninguna organización necesita código propio para ingerir Growth.
 *
 * `baseUrl` sale de la fuente; si la fuente declara `baseUrlEnvOverride` y esa variable está definida en el
 * entorno inyectado, ese valor la sustituye (así funcionaba `SMILEFLOW_M2M_URL`, ahora declarado por la
 * fuente y no global). El host sigue gobernado por la allowlist: un override a un host no autorizado
 * NO abre nada, se rechaza igual.
 */
export function crearGrowthAdapter(
  descriptor: DescriptorFuenteGrowth,
  deps: {
    readonly secretStore: SecretStore;
    readonly esquemaEgress: EsquemaSalida;
    readonly env?: Readonly<Record<string, string | undefined>>;
    readonly fetchFn?: typeof fetch;
  },
): GrowthAdapter {
  const override = descriptor.baseUrlEnvOverride
    ? (deps.env ?? {})[descriptor.baseUrlEnvOverride]
    : undefined;
  return new GrowthAdapter({
    secretStore: deps.secretStore,
    secretRef: descriptor.credencialRef,
    esquemaEgress: deps.esquemaEgress,
    provider: descriptor.provider,
    baseUrl: (override ?? '').trim() || descriptor.baseUrl,
    hostsAutorizados: descriptor.hostsAutorizados,
    rutaIngesta: descriptor.rutaIngesta,
    fetchFn: deps.fetchFn,
  });
}

/** Egress CERRADO y tipado de la ingesta Growth: sólo cursor/limit/since (strings) pueden salir. */
export const ESQUEMA_EGRESS_GROWTH: EsquemaSalida = {
  operacion: 'growth-events',
  campos: [
    { nombre: 'cursor', tipo: 'string' },
    { nombre: 'limit', tipo: 'string' },
    { nombre: 'since', tipo: 'string' },
  ],
};
