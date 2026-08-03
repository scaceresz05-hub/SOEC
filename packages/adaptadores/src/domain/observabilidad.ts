/**
 * @soec/adaptadores · dominio · OBSERVABILIDAD OPERATIVA (M4-C-B). Evidencia que responde qué adaptador/
 * capacidad/organización/versión/contrato/estado/salud/intento/duración/error/breaker/retry/límite/actores.
 * NO contiene secreto, secretRef innecesaria, payload sensible, mensaje original del proveedor, stack ni
 * cause. La duración declara su NATURALEZA (REAL/ESTIMADA/SIMULADA). Versionada.
 */
import type { ClaseErrorAdaptador } from './errores-normalizados';
import type { EstadoRegistroAdaptador, SaludRegistro } from './registro-adaptador';
import type { EstadoBreaker } from './operativo-tipos';

export const EVIDENCIA_OPERATIVA_VERSION = 3;
export const EVIDENCIA_INTENTO_VERSION = 1;

export type NaturalezaDuracion = 'REAL' | 'ESTIMADA' | 'SIMULADA';
export type ModoIntencion = 'SIMULADO' | 'REAL';

/** Gate que produjo un rechazo (temprano o reevaluado). `null` si la ejecución llegó al sandbox con éxito de gates. */
export type GateRechazo = 'CICLO_VIDA' | 'MODO_REAL' | 'ACTIVACION' | 'INTEGRIDAD' | 'COMPATIBILIDAD' | 'SALUD' | 'BREAKER' | 'SEMIABIERTO' | 'CONCURRENCIA' | 'PRESUPUESTO' | 'CANCELACION' | null;

export interface EvidenciaOperativa {
  readonly evidenciaVersion: number;
  readonly organizationId: string;
  readonly adaptadorIdLogico: string;
  readonly capacidadId: string;
  readonly contratoId: string;
  readonly contratoVersion: string;
  readonly implementacionVersion: string;
  readonly descriptorVersion: number | null;
  readonly descriptorHuella: string | null;
  readonly estado: EstadoRegistroAdaptador;
  readonly salud: SaludRegistro;
  readonly modoSolicitado: ModoIntencion;
  readonly modoAutorizado: ModoIntencion;
  readonly soportaReal: boolean;
  readonly gateRechazo: GateRechazo;
  /** Gate que detuvo una REEVALUACIÓN entre reintentos (F-CB-3); null si no aplica. */
  readonly gateReevaluado: GateRechazo;
  readonly intento: number;
  readonly maxIntentos: number;
  readonly backoffAplicadoMs: number;
  readonly duracion: number;
  readonly naturalezaDuracion: NaturalezaDuracion;
  readonly codigoError: ClaseErrorAdaptador | null;
  readonly breaker: EstadoBreaker;
  readonly breakerEstadoAntes: EstadoBreaker;
  readonly breakerEstadoDespues: EstadoBreaker;
  readonly leaseSemiabierto: boolean;
  readonly retryAplicado: boolean;
  readonly limiteAlcanzado: boolean;
  readonly actorConfiguro: string | null;
  readonly actorAutorizo: string | null;
  readonly observadoEn: string;
}

/** Evidencia INDEPENDIENTE de un intento (F-CB-3). Reconstruible sin duplicar por replay/idempotencia. */
export interface EvidenciaIntentoAdaptador {
  readonly evidenciaVersion: number;
  readonly organizationId: string;
  readonly requestId: string;
  readonly adaptadorId: string;
  readonly capacidadId: string;
  readonly intento: number;
  readonly iniciadoEn: string;
  readonly terminadoEn: string;
  readonly duracionMs: number;
  readonly naturalezaDuracion: NaturalezaDuracion;
  readonly codigoResultado: string;
  readonly gateDetencion: GateRechazo;
  readonly descriptorVersion: number | null;
  readonly politicaRetryVersion: string;
  readonly politicaBreakerVersion: string;
}
