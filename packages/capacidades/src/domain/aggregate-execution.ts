/**
 * Agregado de ejecución de capacidad (append-only).
 * solicitada → paso_ejecutado* → (compuesta | abstenida). El producto histórico no
 * se recalcula; una nueva versión de capacidad o un nuevo ECE es una nueva ejecución.
 */
import type { RecordedEvent } from '@soec/contracts';
import type { PasoEjecutado, ProductoCapacidad } from './product';

export const EVENTOS_CAPEXEC = {
  solicitada: 'capexec.solicitada',
  paso: 'capexec.paso_ejecutado',
  compuesta: 'capexec.compuesta',
  abstenida: 'capexec.abstenida',
} as const;

export function capexecStreamId(executionId: string): string {
  return `capexec:${executionId}`;
}

export type EstadoEjecucionCap = 'solicitada' | 'compuesta' | 'abstenida';

export interface CapExecState {
  readonly executionId: string;
  readonly organizationId: string;
  readonly version: number;
  readonly existe: boolean;
  readonly capabilityId: string;
  readonly definicionVersion: number;
  readonly proposito: string;
  readonly eceId: string;
  readonly estado: EstadoEjecucionCap | null;
  readonly pasos: readonly PasoEjecutado[];
  readonly producto: ProductoCapacidad | null;
  readonly solicitadoEn: string | null;
  readonly terminadoEn: string | null;
  readonly historial: readonly { estado: EstadoEjecucionCap; en: string }[];
}

export function estadoInicialCapExec(executionId: string, organizationId: string): CapExecState {
  return {
    executionId,
    organizationId,
    version: 0,
    existe: false,
    capabilityId: '',
    definicionVersion: 0,
    proposito: '',
    eceId: '',
    estado: null,
    pasos: [],
    producto: null,
    solicitadoEn: null,
    terminadoEn: null,
    historial: [],
  };
}

interface PayloadSolicitada {
  capabilityId: string;
  version: number;
  proposito: string;
  eceId: string;
}
interface PayloadResultado {
  producto: ProductoCapacidad;
}

export function aplicarCapExec(state: CapExecState, event: RecordedEvent): CapExecState {
  const next = { ...state, version: state.version + 1 };
  if (event.type === EVENTOS_CAPEXEC.solicitada) {
    const p = event.payload as PayloadSolicitada;
    return {
      ...next,
      existe: true,
      capabilityId: p.capabilityId,
      definicionVersion: p.version,
      proposito: p.proposito,
      eceId: p.eceId,
      estado: 'solicitada',
      solicitadoEn: event.recordedAt,
      historial: [{ estado: 'solicitada', en: event.recordedAt }],
    };
  }
  if (event.type === EVENTOS_CAPEXEC.paso) {
    const paso = event.payload as PasoEjecutado;
    return { ...next, pasos: [...state.pasos, paso] };
  }
  if (event.type === EVENTOS_CAPEXEC.compuesta || event.type === EVENTOS_CAPEXEC.abstenida) {
    const p = event.payload as PayloadResultado;
    const estado: EstadoEjecucionCap = event.type === EVENTOS_CAPEXEC.compuesta ? 'compuesta' : 'abstenida';
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

export function reconstruirCapExec(
  executionId: string,
  organizationId: string,
  events: readonly RecordedEvent[],
): CapExecState {
  return events.reduce(aplicarCapExec, estadoInicialCapExec(executionId, organizationId));
}
