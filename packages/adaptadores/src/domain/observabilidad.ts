/**
 * @soec/adaptadores · dominio · OBSERVABILIDAD OPERATIVA (M4-C-B). Evidencia que responde qué adaptador/
 * capacidad/organización/versión/contrato/estado/salud/intento/duración/error/breaker/retry/límite/actores.
 * NO contiene secreto, secretRef innecesaria, payload sensible, mensaje original del proveedor, stack ni
 * cause. La duración declara su NATURALEZA (REAL/ESTIMADA/SIMULADA). Versionada.
 */
import type { ClaseErrorAdaptador } from './errores-normalizados';
import type { EstadoRegistroAdaptador, SaludRegistro } from './registro-adaptador';
import type { EstadoBreaker } from './operativo-tipos';

export const EVIDENCIA_OPERATIVA_VERSION = 2;

export type NaturalezaDuracion = 'REAL' | 'ESTIMADA' | 'SIMULADA';
export type ModoIntencion = 'SIMULADO' | 'REAL';

/** Gate que produjo un rechazo temprano (trazabilidad). `null` si la ejecución llegó al sandbox. */
export type GateRechazo = 'CICLO_VIDA' | 'MODO_REAL' | 'INTEGRIDAD' | 'COMPATIBILIDAD' | 'SALUD' | 'BREAKER' | 'SEMIABIERTO' | 'CONCURRENCIA' | null;

export interface EvidenciaOperativa {
  readonly evidenciaVersion: number;
  readonly organizationId: string;
  readonly adaptadorIdLogico: string;
  readonly capacidadId: string;
  readonly contratoId: string;
  readonly contratoVersion: string;
  readonly implementacionVersion: string;
  readonly estado: EstadoRegistroAdaptador;
  readonly salud: SaludRegistro;
  readonly modoSolicitado: ModoIntencion;
  readonly modoAutorizado: ModoIntencion;
  readonly soportaReal: boolean;
  readonly gateRechazo: GateRechazo;
  readonly intento: number;
  readonly duracion: number;
  readonly naturalezaDuracion: NaturalezaDuracion;
  readonly codigoError: ClaseErrorAdaptador | null;
  readonly breaker: EstadoBreaker;
  readonly retryAplicado: boolean;
  readonly limiteAlcanzado: boolean;
  readonly actorConfiguro: string | null;
  readonly actorAutorizo: string | null;
  readonly observadoEn: string;
}
