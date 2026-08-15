/**
 * apps/api · Adaptador de ESCRITURA de Meta — SEPARADO del reader y FÍSICAMENTE BLOQUEADO.
 *
 * Espeja `GoogleAdsWriteAdapter`: credencial de escritura SEPARADA (opaca, valor ausente), allowlist de
 * host `graph.facebook.com`, confinamiento por cuenta, y `ejecutarReal` que pasa por `assertSimulado('REAL')`
 * de @soec/cia — lanza mientras `AUTONOMOUS_REAL` sea false. En este bloque `ejecutarReal` SIEMPRE lanza:
 * no se envía ninguna mutación/publicación, no hay token, no hay binding real. El único camino es
 * `describir` (dry-run puro, para auditoría).
 */
import { AUTONOMOUS_REAL, assertSimulado } from '@soec/cia';
import type { AccionSocialTipo } from '@soec/adquisicion';

const HOSTS_AUTORIZADOS = new Set<string>(['graph.facebook.com']);

/** Referencia OPACA del secreto de escritura Meta. El valor NO existe en este bloque. */
export const META_WRITE_CREDENTIAL_REF = 'env:META_WRITE_TOKEN';

export class EscrituraMetaBloqueadaError extends Error {
  constructor(readonly motivo: string) {
    super(`Escritura Meta bloqueada: ${motivo}`);
    this.name = 'EscrituraMetaBloqueadaError';
  }
}

export interface SolicitudEscrituraMeta {
  readonly organizationId: string;
  readonly tipo: AccionSocialTipo;
  readonly adAccountId: string | null;
  readonly pageId: string | null;
}

export class MetaWriteAdapter {
  readonly nombre = 'meta-write';
  readonly capacidad = 'ejecucion-meta-write';
  readonly credentialRef = META_WRITE_CREDENTIAL_REF;
  private readonly host = 'graph.facebook.com';
  /** Cuenta externa autorizada (confinamiento de tenant). `null` = sin binding real (default en este bloque). */
  private readonly cuentaAutorizada: string | null;

  constructor(cuentaAutorizada: string | null = null) {
    this.cuentaAutorizada = cuentaAutorizada;
  }

  /** Estado de la escritura. En este bloque siempre NOT_READY (sin credencial ni binding, flag off). */
  estado(): 'NOT_READY' | 'READY' {
    return AUTONOMOUS_REAL && this.cuentaAutorizada !== null ? 'READY' : 'NOT_READY';
  }

  /** Dry-run puro: describe lo que se enviaría, sin enviarlo. Valida host + confinamiento. */
  describir(s: SolicitudEscrituraMeta): { host: string; tipo: AccionSocialTipo; cuenta: string | null } {
    if (!HOSTS_AUTORIZADOS.has(this.host)) throw new EscrituraMetaBloqueadaError('host no autorizado (egress default-deny)');
    if (this.cuentaAutorizada !== null && s.adAccountId !== null && s.adAccountId !== this.cuentaAutorizada) {
      throw new EscrituraMetaBloqueadaError('cuenta fuera del confinamiento de tenant');
    }
    return { host: this.host, tipo: s.tipo, cuenta: this.cuentaAutorizada };
  }

  /** Ejecución REAL — BLOQUEADA. `assertSimulado('REAL')` lanza mientras AUTONOMOUS_REAL=false. */
  async ejecutarReal(s: SolicitudEscrituraMeta): Promise<never> {
    if (this.credentialRef === null || this.cuentaAutorizada === null) {
      throw new EscrituraMetaBloqueadaError('sin credencial/binding de escritura (fail-closed)');
    }
    assertSimulado('REAL'); // lanza ModoRealBloqueado mientras AUTONOMOUS_REAL=false
    throw new EscrituraMetaBloqueadaError(`ejecución real no habilitada (${s.tipo})`);
  }

  static get puedeEjecutarReal(): boolean {
    return AUTONOMOUS_REAL as boolean;
  }
}
