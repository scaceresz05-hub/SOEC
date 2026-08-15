/**
 * apps/api · Adaptador REAL (READ ONLY) de Meta → SOEC — ARQUITECTURA REAL, SIN CONEXIÓN.
 *
 * Extiende `AdaptadorRealBase` exactamente como el reader de Google Ads: egress default-deny, secreto
 * por referencia expuesto sólo dentro de `invocar`, allowlist de host `graph.facebook.com`. En ESTE
 * bloque NO hay configuración real ⇒ `estadoMetaDe` devuelve NOT_CONFIGURED/CREDENTIALS_REQUIRED y
 * `invocar` NO hace ninguna llamada a la Graph API (no se mockean respuestas como si fueran reales).
 * La subclase queda lista para el onboarding: entonces `invocar` hará el GET real de sólo lectura.
 */
import type { RequestContext } from '@soec/contracts';
import { AdaptadorRealBase, type DependenciasAdaptadorReal, type SalidaAdaptador, errorNormalizado } from '@soec/adaptadores';
import { buscarProfile } from '../plataforma';
import { buscarCuentaMeta, estadoCuentaMeta, type EstadoCuentaMeta } from '../plataforma/meta-canal';

/** Allowlist cerrada de hosts (default-deny). Nunca comodines. */
export const HOSTS_META_AUTORIZADOS = new Set<string>(['graph.facebook.com']);

export type EstadoLecturaMeta = EstadoCuentaMeta | 'ERROR';

export class MetaReadAdapter extends AdaptadorRealBase {
  readonly nombre = 'meta-read';
  readonly capacidad = 'ingesta-meta';
  readonly version = '1.0.0';

  constructor(deps: DependenciasAdaptadorReal) {
    super(deps);
  }

  /**
   * Parte específica de Meta. En este bloque NO se conecta: devuelve un error normalizado sin tocar la
   * red. En el onboarding, aquí irá el GET de sólo lectura a `graph.facebook.com` (insights/pages/ig),
   * validando el host contra la allowlist. Los tokens jamás se registran ni se retornan.
   */
  protected async invocar(
    _ctx: RequestContext,
    _secretoEnClaro: string,
    _datosSalientes: Readonly<Record<string, string>>,
    _signal?: AbortSignal,
  ): Promise<SalidaAdaptador> {
    return {
      estado: 'ERROR',
      salida: null,
      error: errorNormalizado('INVALIDO', 'Meta read no conectado en este bloque (sin llamada a la Graph API)'),
    };
  }
}

export interface EstadoMeta {
  readonly read: EstadoLecturaMeta;
  readonly write: 'NOT_READY';
  readonly accountBinding: 'BOUND' | 'NOT_CONFIGURED';
  readonly graphCalls: 0;
}

/**
 * Estado de Meta para una organización, computado SÓLO desde la configuración (sin red). La escritura
 * está siempre NOT_READY en este bloque; `graphCalls` es 0 por construcción.
 */
export function estadoMetaDe(org: string): EstadoMeta {
  const cuenta = buscarCuentaMeta(buscarProfile(org)?.cuentasExternas ?? []);
  const read = estadoCuentaMeta(cuenta);
  return {
    read,
    write: 'NOT_READY',
    accountBinding: read === 'CONNECTED_READ_ONLY' ? 'BOUND' : 'NOT_CONFIGURED',
    graphCalls: 0,
  };
}
