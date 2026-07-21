/**
 * Acción operativa — unidad de ejecución autorizada por política.
 * Append-only: solicitada → (denegada | autorizada → ejecutada → verificada) → [revertida].
 * Conserva la trazabilidad completa exigida por ADR-0009 D-6.
 */
import type { Attribution, RecordedEvent } from '@soec/contracts';
import type { ClaseRiesgo } from './policy';

/** Lo que se propone ejecutar. `productoIntelectualRef` ancla la trazabilidad al conocimiento de origen. */
export interface AccionPropuesta {
  readonly tipo: string;
  readonly canal: string;
  readonly contenido: string;
  readonly costo: number;
  readonly productoIntelectualRef: string;
}

export type MotivoDenegacion =
  | 'sin_politica'
  | 'politica_no_vigente'
  | 'accion_prohibida'
  | 'canal_no_autorizado'
  | 'afirmacion_prohibida'
  | 'requiere_aprobacion'
  | 'nivel_autonomia_insuficiente'
  | 'presupuesto_excedido';

export interface Decision {
  readonly permitida: boolean;
  readonly motivo: MotivoDenegacion | null;
  readonly detalle: string;
  readonly policyVersion: number | null;
  readonly riesgo: ClaseRiesgo | null;
}

/** Efecto (simulado en este bloque; nunca real). */
export interface Efecto {
  readonly externalId: string;
  readonly ok: boolean;
  readonly detalle: string;
  readonly simulado: true;
}

export type EstadoAccion = 'solicitada' | 'denegada' | 'autorizada' | 'ejecutada' | 'verificada' | 'revertida';

export const EVENTOS_ACC = {
  solicitada: 'acc.solicitada',
  denegada: 'acc.denegada',
  autorizada: 'acc.autorizada',
  ejecutada: 'acc.ejecutada',
  verificada: 'acc.verificada',
  revertida: 'acc.revertida',
} as const;

export function accStreamId(executionId: string): string {
  return `acc:${executionId}`;
}

export interface AccionState {
  readonly executionId: string;
  readonly organizationId: string;
  readonly version: number;
  readonly existe: boolean;
  readonly accion: AccionPropuesta | null;
  readonly policyId: string;
  readonly policyVersion: number | null;
  readonly estado: EstadoAccion | null;
  readonly decision: Decision | null;
  readonly efecto: Efecto | null;
  readonly costoConsumido: number;
  readonly verificado: boolean;
  readonly revertida: boolean;
  readonly mecanismo: string;
  readonly historial: readonly { estado: EstadoAccion; en: string }[];
}

export function estadoInicialAccion(executionId: string, organizationId: string): AccionState {
  return {
    executionId,
    organizationId,
    version: 0,
    existe: false,
    accion: null,
    policyId: '',
    policyVersion: null,
    estado: null,
    decision: null,
    efecto: null,
    costoConsumido: 0,
    verificado: false,
    revertida: false,
    mecanismo: '',
    historial: [],
  };
}

interface PayloadSolicitada {
  accion: AccionPropuesta;
  policyId: string;
  policyVersion: number | null;
  decision: Decision;
}
interface PayloadEjecutada {
  efecto: Efecto;
  costoConsumido: number;
  mecanismo: string;
}
interface PayloadVerificada {
  verificado: boolean;
}

function conHistorial(state: AccionState, estado: EstadoAccion, en: string): AccionState {
  return { ...state, estado, historial: [...state.historial, { estado, en }] };
}

export function aplicarAccion(state: AccionState, event: RecordedEvent): AccionState {
  const next = { ...state, version: state.version + 1 };
  switch (event.type) {
    case EVENTOS_ACC.solicitada: {
      const p = event.payload as PayloadSolicitada;
      return conHistorial(
        { ...next, existe: true, accion: p.accion, policyId: p.policyId, policyVersion: p.policyVersion, decision: p.decision },
        'solicitada',
        event.recordedAt,
      );
    }
    case EVENTOS_ACC.denegada:
      return conHistorial(next, 'denegada', event.recordedAt);
    case EVENTOS_ACC.autorizada:
      return conHistorial(next, 'autorizada', event.recordedAt);
    case EVENTOS_ACC.ejecutada: {
      const p = event.payload as PayloadEjecutada;
      return conHistorial({ ...next, efecto: p.efecto, costoConsumido: p.costoConsumido, mecanismo: p.mecanismo }, 'ejecutada', event.recordedAt);
    }
    case EVENTOS_ACC.verificada: {
      const p = event.payload as PayloadVerificada;
      return conHistorial({ ...next, verificado: p.verificado }, 'verificada', event.recordedAt);
    }
    case EVENTOS_ACC.revertida:
      return conHistorial({ ...next, revertida: true }, 'revertida', event.recordedAt);
    default:
      return next;
  }
}

export function reconstruirAccion(executionId: string, organizationId: string, events: readonly RecordedEvent[]): AccionState {
  return events.reduce(aplicarAccion, estadoInicialAccion(executionId, organizationId));
}

export interface Attribuido {
  readonly attribution: Attribution;
}
