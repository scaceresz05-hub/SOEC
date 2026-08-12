/**
 * apps/api · CAPA DE COMPOSICIÓN · G2-A · Adaptador de ESCRITURA de Google Ads — SEPARADO del Reader.
 *
 * El Reader (`google-ads-adapter.ts`) es READ ONLY (solo `searchStream`) y NO conoce mutaciones. Este adaptador
 * es el ÚNICO que conoce `googleAds:mutate`, y SOLO para las capacidades explícitamente habilitadas
 * (en G2-A: ADD_NEGATIVE_KEYWORD). Usa una credencial de escritura SEPARADA (WRITE_CREDENTIAL_REF).
 *
 * BLOQUEO EN RUNTIME: cualquier intento de EJECUTAR real pasa por `assertSimulado('REAL')` de @soec/cia, que
 * lanza mientras `AUTONOMOUS_REAL` sea false. En G2-A, por tanto, `ejecutarReal` SIEMPRE lanza y no se envía
 * ningún mutate. El único camino disponible es `describirMutate` (puro, para dry-run/auditoría).
 */
import { AUTONOMOUS_REAL, assertSimulado } from '@soec/cia';
import { CONFINAMIENTO, WRITE_CREDENTIAL_REF, construirMutateNegativa, construirRollbackNegativa, esCapacidadHabilitada, type ActionTypeAds, type OperacionMutate } from './capacidad-negativa';

const HOSTS_AUTORIZADOS = new Set<string>(['googleads.googleapis.com', 'oauth2.googleapis.com']);

/** Se intentó una operación no habilitada en esta etapa. */
export class OperacionNoHabilitadaError extends Error {}

export interface SolicitudWrite {
  readonly actionType: string;
  readonly customerId: string;
  readonly campaignId: string;
  readonly entityRef: string; // término
}

export class GoogleAdsWriteAdapter {
  readonly nombre = 'google-ads-write';
  readonly capacidad = 'ejecucion-ads-write';
  /** Referencia OPACA del secreto de escritura (separada del Reader). El valor NO se resuelve en G2-A. */
  readonly credentialRef = WRITE_CREDENTIAL_REF;
  /** Host de escritura (sujeto a allowlist). */
  private readonly host = 'googleads.googleapis.com';

  /** Valida capacidad + confinamiento y DESCRIBE el mutate (puro, no se envía). Lanza si algo no cuadra. */
  describirMutate(s: SolicitudWrite): OperacionMutate {
    if (!esCapacidadHabilitada(s.actionType)) throw new OperacionNoHabilitadaError(`operación no habilitada en G2-A: ${s.actionType}`);
    if (s.customerId !== CONFINAMIENTO.customerId) throw new OperacionNoHabilitadaError('customerId fuera del confinamiento de tenant');
    const op = construirMutateNegativa(s.customerId, s.campaignId, s.entityRef);
    if (!HOSTS_AUTORIZADOS.has(this.host)) throw new OperacionNoHabilitadaError('host no autorizado (egress default-deny)');
    return op;
  }

  /** Describe el rollback (puro, no se envía). */
  describirRollback(customerId: string, criterionResourceName: string): OperacionMutate {
    return construirRollbackNegativa(customerId, criterionResourceName);
  }

  /**
   * Camino de EJECUCIÓN REAL. En G2-A está BLOQUEADO: `assertSimulado('REAL')` lanza mientras AUTONOMOUS_REAL
   * sea false. No existe todavía envío HTTP a `mutate`. Presente sólo para que el bloqueo sea DEMOSTRABLE.
   */
  async ejecutarReal(_op: OperacionMutate): Promise<never> {
    assertSimulado('REAL'); // lanza ModoRealBloqueado mientras AUTONOMOUS_REAL=false
    // Inalcanzable en G2-A. En G2-B aquí iría el fetch a googleAds:mutate con la credencial de escritura.
    throw new OperacionNoHabilitadaError('ejecución real no habilitada');
  }

  /** ¿El interruptor maestro permite ejecutar de verdad? En G2-A: false. */
  static get puedeEjecutarReal(): boolean {
    return AUTONOMOUS_REAL as boolean;
  }

  /** Lista de tipos de acción soportados (sólo los habilitados en la etapa). */
  soporta(actionType: string): actionType is ActionTypeAds {
    return esCapacidadHabilitada(actionType);
  }
}
