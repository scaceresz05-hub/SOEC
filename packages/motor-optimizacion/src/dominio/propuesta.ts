/**
 * @soec/motor-optimizacion · dominio · PROPUESTA DE OPTIMIZACIÓN (agregado event-sourced, versionado).
 *
 * Artefacto gobernado que describe QUÉ convendría cambiar. NO modifica nada por sí mismo. Requiere
 * aprobación humana (canónica). Al aplicarse crea NUEVAS versiones (nunca sobrescribe historia) y registra
 * el vínculo de derivación. Una propuesta rechazada no puede aplicarse; una aprobada pero obsoleta requiere
 * nueva revisión. Naturaleza SIMULADO.
 *
 * Estados: BORRADOR → PENDIENTE_APROBACION → (APROBADA | RECHAZADA) · APROBADA → APLICADA_SIMULADA · *→OBSOLETA.
 */
import type { RecordedEvent } from '@soec/contracts';
import type { Alternativa } from './optimizacion-tipos';
import type { VersionesBase } from './ciclo';

export type EstadoPropuesta = 'BORRADOR' | 'PENDIENTE_APROBACION' | 'APROBADA' | 'RECHAZADA' | 'APLICADA_SIMULADA' | 'OBSOLETA';

export interface Derivacion {
  readonly macrobloque: 'M5' | 'M6' | 'M7';
  readonly artefacto: string;
  readonly versionAnterior: string;
  readonly versionNueva: string;
}

export interface CuerpoPropuesta {
  readonly cicloId: string;
  readonly versionesBase: VersionesBase;
  readonly alternativaElegida: Alternativa | null;
  readonly alternativasDescartadas: readonly string[];
  readonly artefactosAfectados: readonly string[];
  readonly hipotesisId: string | null;
  readonly kpis: readonly string[];
  readonly evidencia: readonly string[];
  readonly contraevidencia: readonly string[];
  readonly impactoEsperado: string;
  readonly costoEstimado: number;
  readonly riesgos: readonly string[];
  readonly rollbackLogico: string;
  readonly explicacion: string;
  readonly naturaleza: 'SIMULADO';
}

export interface AprobacionPropuesta {
  readonly actorHumano: string;
  readonly decisionId: string;
  readonly justificacion: string;
}

export interface PropuestaState {
  readonly organizacionId: string;
  readonly propuestaId: string;
  readonly version: number;
  readonly existe: boolean;
  readonly estado: EstadoPropuesta;
  readonly cuerpo: CuerpoPropuesta | null;
  readonly aprobacion: AprobacionPropuesta | null;
  readonly derivaciones: readonly Derivacion[];
  readonly motivoObsolescencia: string | null;
}

export const EVENTOS_PROPUESTA = {
  creada: 'propuesta.creada',
  pendiente: 'propuesta.pendiente_aprobacion',
  aprobada: 'propuesta.aprobada',
  rechazada: 'propuesta.rechazada',
  aplicada: 'propuesta.aplicada_simulada',
  obsoleta: 'propuesta.obsoleta',
} as const;

export function propuestaStreamId(organizacionId: string, propuestaId: string): string {
  return `propuesta-opt:${organizacionId}:${propuestaId}`;
}

export function estadoInicialPropuesta(organizacionId: string, propuestaId: string): PropuestaState {
  return { organizacionId, propuestaId, version: 0, existe: false, estado: 'BORRADOR', cuerpo: null, aprobacion: null, derivaciones: [], motivoObsolescencia: null };
}

const TERMINALES: readonly EstadoPropuesta[] = ['RECHAZADA', 'APLICADA_SIMULADA', 'OBSOLETA'];

export function aplicarPropuesta(state: PropuestaState, event: RecordedEvent): PropuestaState {
  const next = { ...state, version: state.version + 1 };
  const p = event.payload as Record<string, unknown>;
  switch (event.type) {
    case EVENTOS_PROPUESTA.creada:
      if (state.existe) return next; // idempotente
      return { ...next, existe: true, estado: 'BORRADOR', cuerpo: p.cuerpo as CuerpoPropuesta };
    case EVENTOS_PROPUESTA.pendiente:
      if (state.estado !== 'BORRADOR') return next;
      return { ...next, estado: 'PENDIENTE_APROBACION' };
    case EVENTOS_PROPUESTA.aprobada:
      if (state.estado !== 'PENDIENTE_APROBACION') return next; // no autoaprobar desde otro estado
      return { ...next, estado: 'APROBADA', aprobacion: p.aprobacion as AprobacionPropuesta };
    case EVENTOS_PROPUESTA.rechazada:
      if (state.estado !== 'PENDIENTE_APROBACION') return next;
      return { ...next, estado: 'RECHAZADA', aprobacion: p.aprobacion as AprobacionPropuesta };
    case EVENTOS_PROPUESTA.aplicada:
      if (state.estado !== 'APROBADA') return next; // sólo se aplica lo APROBADO
      return { ...next, estado: 'APLICADA_SIMULADA', derivaciones: (p.derivaciones as Derivacion[]) ?? [] };
    case EVENTOS_PROPUESTA.obsoleta:
      if (TERMINALES.includes(state.estado)) return next;
      return { ...next, estado: 'OBSOLETA', motivoObsolescencia: (p.motivo as string) ?? null };
    default:
      return next;
  }
}

export function reconstruirPropuesta(organizacionId: string, propuestaId: string, events: readonly RecordedEvent[]): PropuestaState {
  return events.reduce(aplicarPropuesta, estadoInicialPropuesta(organizacionId, propuestaId));
}
