/**
 * Resolución de la cuenta de canal Meta y sus referencias de secreto, tenant-scoped y fail-closed.
 *
 * NO conecta nada, NO genera secretos, NO crea archivos: sólo construye REFERENCIAS OPACAS
 * (`file:<org>/meta-*`) que el `SecretStore` existente resolvería en el capítulo de onboarding. Por
 * construcción, la referencia de una organización nunca coincide con la de otra; y la resolución
 * cross-tenant del propio `SecretStoreArchivo` ya es fail-closed (triple match de organización).
 */

import type { CuentaExternaRef } from './tipos';

export type EstadoCuentaMeta = 'NOT_CONFIGURED' | 'CREDENTIALS_REQUIRED' | 'CONNECTED_READ_ONLY';

export interface RefsSecretosMeta {
  readonly appSecret: string;
  readonly pageToken: string;
  readonly igToken: string;
  readonly adAccount: string;
}

/**
 * Referencias de secreto Meta para una organización. Todas opacas y scoped por org: `file:<org>/…`.
 * Nunca un valor. Dos organizaciones distintas obtienen referencias distintas por construcción.
 */
export function refsSecretosMeta(organizationId: string): RefsSecretosMeta {
  const base = `file:${organizationId}/`;
  return {
    appSecret: `${base}meta-app-secret`,
    pageToken: `${base}meta-page-token`,
    igToken: `${base}meta-ig-token`,
    adAccount: `${base}meta-ad-account`,
  };
}

/**
 * Estado de la cuenta Meta a partir de su referencia:
 *   · sin cuenta ⇒ NOT_CONFIGURED;
 *   · con id externo pero sin credencial ⇒ CREDENTIALS_REQUIRED;
 *   · con id externo y credencial y estado conectado ⇒ CONNECTED_READ_ONLY.
 * Nunca inventa un id ni asume conexión.
 */
export function estadoCuentaMeta(cuenta: CuentaExternaRef | null): EstadoCuentaMeta {
  if (cuenta === null || cuenta.externalAccountId === null) return 'NOT_CONFIGURED';
  if (cuenta.credentialRef === null) return 'CREDENTIALS_REQUIRED';
  return cuenta.estado === 'CONNECTED_READ_ONLY' ? 'CONNECTED_READ_ONLY' : 'CREDENTIALS_REQUIRED';
}

/** Busca la cuenta Meta dentro de las cuentas externas de UNA organización (ya tenant-scoped). */
export function buscarCuentaMeta(cuentasExternas: readonly CuentaExternaRef[]): CuentaExternaRef | null {
  return cuentasExternas.find((c) => c.proveedor === 'meta') ?? null;
}
