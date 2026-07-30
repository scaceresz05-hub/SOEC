/**
 * @soec/ejecucion-simulada · dominio · Ejecución de canal ESTRICTAMENTE SIMULADA (Bloque E).
 *
 * SOEC no publica en canales reales: cada intento pasa por un adaptador determinista que
 * emula un escenario configurable (éxito, fallo temporal, rate-limit, autorización perdida,
 * rechazo por política, presupuesto agotado, petición duplicada). Todo intento deja un
 * registro auditable con `simulado: true`, adaptador, `requestId` e `idempotencyKey`. La
 * idempotencia garantiza que una petición duplicada NO produce dos publicaciones simuladas.
 * Event-sourced (`ejec:<org>:<contenidoId>`).
 */
import type { RecordedEvent } from '@soec/contracts';

/** Escenarios que el adaptador determinista puede emular. */
export type EscenarioEjecucion =
  | 'SUCCESS'
  | 'TEMPORARY_FAILURE'
  | 'PERMANENT_FAILURE'
  | 'RATE_LIMITED'
  | 'AUTHORIZATION_LOST'
  | 'REJECTED_BY_POLICY'
  | 'DUPLICATE_REQUEST'
  | 'BUDGET_EXHAUSTED';

/** Resultado normalizado de un intento de ejecución. */
export type ResultadoEjecucion =
  | 'PUBLICADA_SIMULADA'
  | 'FALLIDA_TEMPORAL'
  | 'FALLIDA_PERMANENTE'
  | 'RECHAZADA'
  | 'DUPLICADA';

const MAPA_ESCENARIO: Readonly<Record<EscenarioEjecucion, ResultadoEjecucion>> = {
  SUCCESS: 'PUBLICADA_SIMULADA',
  TEMPORARY_FAILURE: 'FALLIDA_TEMPORAL',
  PERMANENT_FAILURE: 'FALLIDA_PERMANENTE',
  RATE_LIMITED: 'FALLIDA_TEMPORAL',
  AUTHORIZATION_LOST: 'RECHAZADA',
  REJECTED_BY_POLICY: 'RECHAZADA',
  DUPLICATE_REQUEST: 'DUPLICADA',
  BUDGET_EXHAUSTED: 'RECHAZADA',
};

export function resultadoDeEscenario(escenario: EscenarioEjecucion): ResultadoEjecucion {
  return MAPA_ESCENARIO[escenario];
}

/** Solo los fallos transitorios se pueden reintentar; los permanentes y rechazos, no. */
export function esReintentable(escenario: EscenarioEjecucion): boolean {
  return escenario === 'TEMPORARY_FAILURE' || escenario === 'RATE_LIMITED';
}

/** Registro auditable de un intento de ejecución simulada. `simulado` es SIEMPRE true. */
export interface RegistroEjecucion {
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly adaptador: string;
  readonly canal: string;
  readonly organizacionId: string;
  readonly contenidoId: string;
  readonly campaniaId: string;
  readonly escenario: EscenarioEjecucion;
  readonly resultado: ResultadoEjecucion;
  readonly reintentable: boolean;
  readonly intento: number;
  readonly simulado: true;
  readonly mensaje: string;
  readonly en: string;
}

export const EVENTOS_EJECUCION = { registrada: 'ejecucion.registrada' } as const;

export function ejecucionStreamId(organizacionId: string, contenidoId: string): string {
  return `ejec:${organizacionId}:${contenidoId}`;
}

export interface EjecucionContenido {
  readonly organizacionId: string;
  readonly contenidoId: string;
  readonly registros: readonly RegistroEjecucion[];
  /** Número de publicaciones simuladas efectivas (una petición duplicada NO lo incrementa). */
  readonly publicacionesSimuladas: number;
  readonly version: number;
}

export function estadoInicialEjecucion(organizacionId: string, contenidoId: string): EjecucionContenido {
  return { organizacionId, contenidoId, registros: [], publicacionesSimuladas: 0, version: 0 };
}

export function aplicarEjecucion(state: EjecucionContenido, event: RecordedEvent): EjecucionContenido {
  const next = { ...state, version: state.version + 1 };
  if (event.type !== EVENTOS_EJECUCION.registrada) return next;
  const r = event.payload as RegistroEjecucion;
  return {
    ...next,
    registros: [...state.registros, r],
    publicacionesSimuladas: state.publicacionesSimuladas + (r.resultado === 'PUBLICADA_SIMULADA' ? 1 : 0),
  };
}

export function reconstruirEjecucion(organizacionId: string, contenidoId: string, events: readonly RecordedEvent[]): EjecucionContenido {
  return events.reduce(aplicarEjecucion, estadoInicialEjecucion(organizacionId, contenidoId));
}

/** Busca el registro que ya publicó con esa idempotencyKey (si existe). */
export function publicacionPrevia(state: EjecucionContenido, idempotencyKey: string): RegistroEjecucion | undefined {
  return state.registros.find((r) => r.idempotencyKey === idempotencyKey && r.resultado === 'PUBLICADA_SIMULADA');
}
