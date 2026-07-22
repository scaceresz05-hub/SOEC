/**
 * Frontera de credenciales (F2-CHAN-01 §8). Los secretos NO viven en el dominio ni
 * en los eventos ni en los logs: los eventos guardan una REFERENCIA (id de credencial
 * + cuenta lógica), nunca el valor. El proveedor de credenciales resuelve la
 * referencia a un token en el borde, comprueba vigencia y revocación, e impide el
 * uso cruzado entre organizaciones. Existe un proveedor fixture de desarrollo.
 */

/** Referencia persistible a una credencial. NUNCA contiene el secreto. */
export interface ReferenciaCredencial {
  readonly organizationId: string;
  readonly canal: string;
  readonly cuentaLogica: string;
  readonly credencialId: string;
}

/** Credencial resuelta en el borde (token en memoria); nunca se persiste ni se registra. */
export interface CredencialResuelta {
  readonly ref: ReferenciaCredencial;
  readonly token: string;
  readonly vigente: boolean;
}

export interface CanalCredentialProvider {
  /** Resuelve la referencia a un token vigente. Devuelve null si no existe/está revocada. */
  resolver(ref: ReferenciaCredencial): Promise<CredencialResuelta | null>;
}

/** Nunca registrar un token: helper para enmascarar en trazas. */
export function enmascarar(token: string): string {
  if (!token) return '(vacío)';
  return `${token.slice(0, 3)}***(${token.length})`;
}
