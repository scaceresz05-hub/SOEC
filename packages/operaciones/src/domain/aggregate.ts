/**
 * Agregado event-sourced de una ejecución de operación intelectual.
 * Append-only: solicitud → (ejecutada | abstenida). El producto anterior nunca se
 * sobrescribe; una nueva ejecución es una nueva historia (#18 de la orden).
 */
import type { RecordedEvent } from '@soec/contracts';
import type { CorteEce, ProductoIntelectual, TipoOperacion } from './product';

export const EVENTOS_OI = {
  solicitada: 'oi.solicitada',
  ejecutada: 'oi.ejecutada',
  abstenida: 'oi.abstenida',
} as const;

export function oiStreamId(executionId: string): string {
  return `oi:${executionId}`;
}

export type EstadoEjecucion = 'solicitada' | 'ejecutada' | 'abstenida';

export interface OiState {
  readonly executionId: string;
  readonly organizationId: string;
  readonly version: number;
  readonly existe: boolean;
  readonly operacion: TipoOperacion | null;
  readonly proposito: string;
  readonly eceId: string;
  readonly eceCorte: CorteEce | null;
  readonly mecanismo: string;
  readonly mecanismoVersion: string;
  readonly estado: EstadoEjecucion | null;
  readonly producto: ProductoIntelectual | null;
  readonly solicitadoEn: string | null;
  readonly terminadoEn: string | null;
  readonly historial: readonly { estado: EstadoEjecucion; en: string }[];
}

export function estadoInicialOi(executionId: string, organizationId: string): OiState {
  return {
    executionId,
    organizationId,
    version: 0,
    existe: false,
    operacion: null,
    proposito: '',
    eceId: '',
    eceCorte: null,
    mecanismo: '',
    mecanismoVersion: '',
    estado: null,
    producto: null,
    solicitadoEn: null,
    terminadoEn: null,
    historial: [],
  };
}

interface PayloadSolicitada {
  operacion: TipoOperacion;
  proposito: string;
  eceId: string;
  eceCorte: CorteEce;
  mecanismo: string;
  mecanismoVersion: string;
}
interface PayloadResultado {
  producto: ProductoIntelectual;
}

export function aplicarOi(state: OiState, event: RecordedEvent): OiState {
  const next = { ...state, version: state.version + 1 };
  if (event.type === EVENTOS_OI.solicitada) {
    const p = event.payload as PayloadSolicitada;
    return {
      ...next,
      existe: true,
      operacion: p.operacion,
      proposito: p.proposito,
      eceId: p.eceId,
      eceCorte: p.eceCorte,
      mecanismo: p.mecanismo,
      mecanismoVersion: p.mecanismoVersion,
      estado: 'solicitada',
      solicitadoEn: event.recordedAt,
      historial: [{ estado: 'solicitada', en: event.recordedAt }],
    };
  }
  if (event.type === EVENTOS_OI.ejecutada || event.type === EVENTOS_OI.abstenida) {
    const p = event.payload as PayloadResultado;
    const estado: EstadoEjecucion = event.type === EVENTOS_OI.ejecutada ? 'ejecutada' : 'abstenida';
    return {
      ...next,
      estado,
      producto: p.producto,
      terminadoEn: event.recordedAt,
      historial: [...state.historial, { estado, en: event.recordedAt }],
    };
  }
  return next;
}

export function reconstruirOi(
  executionId: string,
  organizationId: string,
  events: readonly RecordedEvent[],
): OiState {
  return events.reduce(aplicarOi, estadoInicialOi(executionId, organizationId));
}
