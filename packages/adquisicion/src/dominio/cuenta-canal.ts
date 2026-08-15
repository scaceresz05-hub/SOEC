/**
 * ChannelAccount — la cuenta externa de un canal, atada a un tenant, con credenciales por referencia.
 *
 * Espeja `CuentaExternaRef`/`FuenteRegistrada` de la plataforma pero unifica el estado del canal y el
 * proveedor en un solo agregado provider-neutral. Reglas duras:
 *   · SIEMPRE tenant-scoped (organizationId + businessKey);
 *   · las credenciales son SOLO referencias opacas (nunca el valor) — nunca en logs/eventos/UI;
 *   · NUNCA hay fallback a la cuenta de otra organización (fail-closed).
 */

import type { CanalAdquisicion, EstadoCanal } from './canal';

export type ProveedorCanal = 'google' | 'meta' | 'website' | 'email' | 'whatsapp';

export type CapacidadCanal =
  | 'READ_INSIGHTS'
  | 'READ_LEADS'
  | 'PUBLISH_ORGANIC'
  | 'MANAGE_PAID'
  | 'READ_MESSAGES';

export interface CuentaCanal {
  readonly organizationId: string;
  readonly businessKey: string;
  readonly provider: ProveedorCanal;
  readonly canal: CanalAdquisicion;
  /** Id de la cuenta en el proveedor (ad account, page id, ig user id…). `null` si no conectada. */
  readonly externalAccountId: string | null;
  readonly displayName: string | null;
  readonly capabilities: readonly CapacidadCanal[];
  /** Referencias OPACAS a secretos (ej. `file:org-x/meta-page-token`). Nunca el valor. */
  readonly credentialRefs: readonly string[];
  readonly estado: EstadoCanal;
}

export class CuentaCruzadaError extends Error {
  constructor(
    readonly esperado: string,
    readonly recibido: string,
  ) {
    super(`Cuenta de canal de otra organización: se esperaba ${esperado}, llegó ${recibido}`);
    this.name = 'CuentaCruzadaError';
  }
}

/**
 * Verifica que una cuenta pertenece al tenant del contexto. Cualquier discrepancia lanza — nunca se
 * degrada silenciosamente ni se usa la cuenta de otra organización.
 */
export function assertCuentaDeTenant(cuenta: CuentaCanal, organizationId: string): void {
  if (cuenta.organizationId !== organizationId) {
    throw new CuentaCruzadaError(organizationId, cuenta.organizationId);
  }
}

/** Una cuenta sin credenciales y sin id externo se considera NO conectada por construcción. */
export function cuentaNoConectada(cuenta: CuentaCanal): boolean {
  return cuenta.externalAccountId === null || cuenta.credentialRefs.length === 0;
}

/**
 * Construye una cuenta declarada pero NO conectada para un canal. Sirve para representar
 * honestamente "este negocio podría usar este canal, pero aún no está conectado" sin inventar datos.
 */
export function cuentaNoConfigurada(
  organizationId: string,
  businessKey: string,
  provider: ProveedorCanal,
  canal: CanalAdquisicion,
): CuentaCanal {
  return {
    organizationId,
    businessKey,
    provider,
    canal,
    externalAccountId: null,
    displayName: null,
    capabilities: [],
    credentialRefs: [],
    estado: 'NOT_CONFIGURED',
  };
}
