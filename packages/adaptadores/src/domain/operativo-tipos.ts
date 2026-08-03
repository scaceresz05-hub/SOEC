/**
 * @soec/adaptadores · dominio · TIPOS OPERATIVOS compartidos (M4-C-B). Definiciones puras de las políticas
 * y estados operativos del ciclo de vida de un adaptador. La LÓGICA vive en módulos dedicados
 * (compatibilidad, circuit-breaker, retry, concurrencia); aquí sólo los contratos de datos, versionados.
 */
import type { ClaseErrorAdaptador } from './errores-normalizados';

export interface CompatibilidadAdaptador {
  readonly contratoId: string;
  readonly versionesContratoSoportadas: readonly string[];
  readonly implementacionVersion: string;
  readonly evidenciaSchemaVersion: string;
}

export interface LimiteConcurrencia {
  readonly maxConcurrentesPorOrganizacion: number;
  readonly maxConcurrentesPorAdaptador: number;
  readonly maxConcurrentesPorCapacidad: number;
  readonly version: string;
}

export type EstadoBreaker = 'CERRADO' | 'ABIERTO' | 'SEMIABIERTO';

export interface EstadoCircuitBreaker {
  readonly estado: EstadoBreaker;
  readonly fallosConsecutivos: number;
  readonly abiertoDesde: string | null; // instante inyectado (ISO), no reloj interno
}

export interface PoliticaCircuitBreaker {
  readonly maxFallosConsecutivos: number;
  readonly ventanaMs: number;
  readonly tiempoReaperturaMs: number;
  readonly version: string;
}

export interface PoliticaRetry {
  readonly habilitado: boolean;
  readonly maxIntentos: number;
  readonly erroresReintentables: readonly ClaseErrorAdaptador[];
  readonly backoff: 'FIJO' | 'EXPONENCIAL';
  readonly baseMs: number;
  readonly jitter: false; // determinismo: sin jitter en este bloque
  readonly version: string;
}

export const CIRCUIT_BREAKER_CERRADO: EstadoCircuitBreaker = { estado: 'CERRADO', fallosConsecutivos: 0, abiertoDesde: null };
