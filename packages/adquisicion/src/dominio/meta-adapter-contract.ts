/**
 * Contrato de frontera para Meta — puerto de LECTURA y puerto de ESCRITURA, separados y neutrales.
 *
 * Espeja el patrón probado de Google Ads (`GoogleAdsAdapter` read / `GoogleAdsWriteAdapter` locked):
 *   · el puerto de LECTURA describe capacidades de sólo lectura (insights, páginas, IG, leads);
 *   · el puerto de ESCRITURA es un contrato BLOQUEADO: sin credencial de escritura y con la autonomía
 *     real apagada, toda mutación falla cerrada (`MetaWriteBloqueadoError`).
 * Este módulo NO abre red ni resuelve secretos: es el contrato + un default fail-closed. La
 * implementación real (que extiende `AdaptadorRealBase` y resuelve secretos por `SecretStore`) vive
 * en `apps/api` y se conecta en el capítulo de onboarding read-only, no aquí.
 */

import type { CanalAdquisicion } from './canal';
import type { AccionSocialTipo } from './accion-social';

export type EstadoLecturaMeta = 'NOT_CONNECTED' | 'CONNECTED_READ_ONLY' | 'ERROR';
export type EstadoEscrituraMeta = 'NOT_READY' | 'READY';

export interface CapacidadesMetaDetectadas {
  readonly puedeLeerInsights: boolean;
  readonly puedeLeerPaginas: boolean;
  readonly puedeLeerInstagram: boolean;
  readonly puedeLeerLeads: boolean;
  readonly puedePublicarOrganico: boolean;
  readonly puedeGestionarPagado: boolean;
}

export const SIN_CAPACIDADES_META: CapacidadesMetaDetectadas = {
  puedeLeerInsights: false,
  puedeLeerPaginas: false,
  puedeLeerInstagram: false,
  puedeLeerLeads: false,
  puedePublicarOrganico: false,
  puedeGestionarPagado: false,
};

/** Puerto de LECTURA de Meta. La implementación real hace GET a graph.facebook.com; aquí es contrato. */
export interface MetaReadPort {
  readonly canal: CanalAdquisicion;
  detectarCapacidades(): Promise<CapacidadesMetaDetectadas>;
  estado(): EstadoLecturaMeta;
}

export class MetaWriteBloqueadoError extends Error {
  constructor(readonly tipo: AccionSocialTipo, readonly motivo: string) {
    super(`Escritura Meta bloqueada (${tipo}): ${motivo}`);
    this.name = 'MetaWriteBloqueadoError';
  }
}

export interface SolicitudEscrituraMeta {
  readonly organizationId: string;
  readonly tipo: AccionSocialTipo;
  readonly externalAccountId: string | null;
}

/** Puerto de ESCRITURA de Meta. Separado del de lectura y con su propia credencial. */
export interface MetaWritePort {
  estado(): EstadoEscrituraMeta;
  /** Describe (dry-run) lo que se enviaría, sin enviarlo. */
  describir(sol: SolicitudEscrituraMeta): string;
  /** Ejecuta REAL. En este bloque SIEMPRE falla cerrada. */
  ejecutarReal(sol: SolicitudEscrituraMeta): Promise<never>;
}

/**
 * Default fail-closed del puerto de escritura: sin credencial de escritura (`credentialRef=null`) y
 * con `autonomousReal=false`, cualquier `ejecutarReal` lanza. `estado()` es siempre `NOT_READY`.
 * Espeja `assertSimulado('REAL')` del patrón Google Ads sin acoplar a `@soec/cia`.
 */
export class MetaWriteBloqueado implements MetaWritePort {
  constructor(
    private readonly credentialRef: string | null = null,
    private readonly autonomousReal: boolean = false,
  ) {}

  estado(): EstadoEscrituraMeta {
    return this.credentialRef !== null && this.autonomousReal ? 'READY' : 'NOT_READY';
  }

  describir(sol: SolicitudEscrituraMeta): string {
    return `[DRY_RUN] ${sol.tipo} sobre cuenta ${sol.externalAccountId ?? '(sin cuenta)'} — no se envía nada`;
  }

  async ejecutarReal(sol: SolicitudEscrituraMeta): Promise<never> {
    if (this.credentialRef === null) {
      throw new MetaWriteBloqueadoError(sol.tipo, 'sin credencial de escritura (fail-closed)');
    }
    if (!this.autonomousReal) {
      throw new MetaWriteBloqueadoError(sol.tipo, 'AUTONOMOUS_REAL=false');
    }
    throw new MetaWriteBloqueadoError(sol.tipo, 'escritura Meta no habilitada en este bloque');
  }
}

/** Puerto de LECTURA default: no conectado, sin capacidades. */
export class MetaReadNoConectado implements MetaReadPort {
  constructor(readonly canal: CanalAdquisicion) {}
  async detectarCapacidades(): Promise<CapacidadesMetaDetectadas> {
    return SIN_CAPACIDADES_META;
  }
  estado(): EstadoLecturaMeta {
    return 'NOT_CONNECTED';
  }
}
