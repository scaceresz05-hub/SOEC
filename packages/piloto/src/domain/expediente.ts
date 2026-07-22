/**
 * Expediente del piloto (F2-PILOT-01 §15–§18, §23, §24). Documento operacional
 * VERSIONADO que reúne alcance, entorno, criterios de éxito y de suspensión, plan de
 * rollback, checklist de activación y estado. Durante F2-PILOT-01 NUNCA alcanza
 * `autorizado` para un entorno real: la ceremonia de activación permanece bloqueada.
 */
import type { RecordedEvent } from '@soec/contracts';
import type { Entorno } from './entorno';
import type { ResultadoReadiness } from './readiness';

export interface CriterioExito {
  readonly indicador: string;
  readonly lineaBase: number;
  readonly meta: number;
  readonly minimoEvidencia: number;
  readonly ventana: string;
  readonly tolerancia: number;
  readonly peso: number;
}
export interface CriterioSuspension {
  readonly codigo: string;
  readonly severidad: 'menor' | 'mayor' | 'critico';
  readonly accion: 'pausar' | 'retirar' | 'notificar' | 'requiere_aprobacion';
  readonly reversible: boolean;
  readonly descripcion: string;
}
export interface PasoRollback {
  readonly orden: number;
  readonly accion: string;
  readonly reversible: boolean;
  readonly responsable: string;
}
export interface ItemChecklist {
  readonly punto: string;
  readonly estado: 'pendiente' | 'aprobado' | 'bloqueado' | 'no_aplicable';
  readonly evidencia: string;
  readonly bloqueo: boolean;
}

export type EstadoExpediente =
  | 'borrador'
  | 'en_preparacion'
  | 'en_revision'
  | 'listo_para_ensayo'
  | 'ensayo_aprobado'
  | 'listo_para_autorizacion'
  | 'autorizado'
  | 'ejecutando'
  | 'pausado'
  | 'suspendido'
  | 'finalizado'
  | 'cancelado';

export const EVENTOS_EXP = {
  creado: 'exp.creado',
  actualizado: 'exp.actualizado',
  readiness: 'exp.readiness_registrada',
  checklist: 'exp.checklist_evaluada',
  transicion: 'exp.transicion',
  activacionIntentada: 'exp.activacion_intentada',
} as const;

export function expStreamId(expId: string): string {
  return `exp:${expId}`;
}

export interface ExpedienteState {
  readonly expId: string;
  readonly organizationId: string;
  readonly version: number;
  readonly existe: boolean;
  readonly orgRef: string;
  readonly departamento: string;
  readonly entorno: Entorno;
  readonly objetivo: string;
  readonly duracionDias: number;
  readonly criteriosExito: readonly CriterioExito[];
  readonly criteriosSuspension: readonly CriterioSuspension[];
  readonly rollback: readonly PasoRollback[];
  readonly readiness: ResultadoReadiness | null;
  readonly checklist: readonly ItemChecklist[];
  readonly estado: EstadoExpediente;
  readonly intentosActivacion: readonly { en: string; motivoDenegacion: string }[];
  readonly historial: readonly { estado: EstadoExpediente; en: string }[];
}

export function estadoInicialExpediente(expId: string, organizationId: string): ExpedienteState {
  return { expId, organizationId, version: 0, existe: false, orgRef: '', departamento: '', entorno: 'sintetico', objetivo: '', duracionDias: 0, criteriosExito: [], criteriosSuspension: [], rollback: [], readiness: null, checklist: [], estado: 'borrador', intentosActivacion: [], historial: [] };
}

const TRANS: Readonly<Record<EstadoExpediente, readonly EstadoExpediente[]>> = {
  borrador: ['en_preparacion', 'cancelado'],
  en_preparacion: ['en_revision', 'listo_para_ensayo', 'cancelado'],
  en_revision: ['en_preparacion', 'listo_para_ensayo', 'cancelado'],
  listo_para_ensayo: ['ensayo_aprobado', 'en_preparacion', 'cancelado'],
  ensayo_aprobado: ['listo_para_autorizacion', 'en_preparacion', 'cancelado'],
  // 'autorizado' es inalcanzable para un entorno real en este bloque (guardarraíl en el servicio).
  listo_para_autorizacion: ['autorizado', 'ensayo_aprobado', 'cancelado'],
  autorizado: ['ejecutando', 'cancelado'],
  ejecutando: ['pausado', 'suspendido', 'finalizado'],
  pausado: ['ejecutando', 'suspendido', 'finalizado'],
  suspendido: ['finalizado', 'cancelado'],
  finalizado: [],
  cancelado: [],
};
export function transicionExpValida(desde: EstadoExpediente, hacia: EstadoExpediente): boolean {
  if (desde === hacia) return true;
  return (TRANS[desde] ?? []).includes(hacia);
}

export interface PayloadCreado {
  orgRef: string;
  departamento: string;
  entorno: Entorno;
  objetivo: string;
  duracionDias: number;
  criteriosExito: CriterioExito[];
  criteriosSuspension: CriterioSuspension[];
  rollback: PasoRollback[];
}
interface PReadiness {
  readiness: ResultadoReadiness;
}
interface PChecklist {
  checklist: ItemChecklist[];
}
interface PTrans {
  nuevoEstado: EstadoExpediente;
}
interface PIntento {
  motivoDenegacion: string;
}

export function aplicarExpediente(state: ExpedienteState, event: RecordedEvent): ExpedienteState {
  const next = { ...state, version: state.version + 1 };
  switch (event.type) {
    case EVENTOS_EXP.creado:
    case EVENTOS_EXP.actualizado: {
      const p = event.payload as PayloadCreado;
      return { ...next, existe: true, orgRef: p.orgRef, departamento: p.departamento, entorno: p.entorno, objetivo: p.objetivo, duracionDias: p.duracionDias, criteriosExito: p.criteriosExito, criteriosSuspension: p.criteriosSuspension, rollback: p.rollback, estado: state.existe ? state.estado : 'en_preparacion', historial: state.existe ? state.historial : [{ estado: 'en_preparacion', en: event.recordedAt }] };
    }
    case EVENTOS_EXP.readiness:
      return { ...next, readiness: (event.payload as PReadiness).readiness };
    case EVENTOS_EXP.checklist:
      return { ...next, checklist: (event.payload as PChecklist).checklist };
    case EVENTOS_EXP.transicion: {
      const p = event.payload as PTrans;
      if (!transicionExpValida(state.estado, p.nuevoEstado)) return next;
      return { ...next, estado: p.nuevoEstado, historial: [...state.historial, { estado: p.nuevoEstado, en: event.recordedAt }] };
    }
    case EVENTOS_EXP.activacionIntentada: {
      const p = event.payload as PIntento;
      return { ...next, intentosActivacion: [...state.intentosActivacion, { en: event.recordedAt, motivoDenegacion: p.motivoDenegacion }] };
    }
    default:
      return next;
  }
}

export function reconstruirExpediente(expId: string, organizationId: string, events: readonly RecordedEvent[]): ExpedienteState {
  return events.reduce(aplicarExpediente, estadoInicialExpediente(expId, organizationId));
}
