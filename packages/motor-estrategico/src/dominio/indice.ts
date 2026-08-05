/**
 * @soec/motor-estrategico · dominio · ÍNDICE de afirmaciones por organización.
 *
 * Permite CONSULTAR el conocimiento estratégico (listar por clase, recorrer el grafo) sin conocer de
 * antemano los ids. Event-sourced sobre `estrategico-indice:<org>`, reconstruible por replay. La
 * inscripción es idempotente y autorreparable (misma disciplina que el índice de hipótesis, H-6).
 */
import type { RecordedEvent } from '@soec/contracts';
import type { ClaseAfirmacion } from './afirmacion';

export interface EntradaIndice {
  readonly afirmacionId: string;
  readonly clase: ClaseAfirmacion;
  readonly enunciado: string;
}

export interface IndiceEstrategicoState {
  readonly organizacionId: string;
  readonly version: number;
  readonly afirmaciones: readonly EntradaIndice[];
}

export const EVENTOS_INDICE_ESTRATEGICO = {
  registrada: 'estrategico-indice.registrada',
} as const;

export function indiceEstrategicoStreamId(organizacionId: string): string {
  return `estrategico-indice:${organizacionId}`;
}

export function estadoInicialIndice(organizacionId: string): IndiceEstrategicoState {
  return { organizacionId, version: 0, afirmaciones: [] };
}

export function aplicarIndice(state: IndiceEstrategicoState, event: RecordedEvent): IndiceEstrategicoState {
  const next = { ...state, version: state.version + 1 };
  if (event.type !== EVENTOS_INDICE_ESTRATEGICO.registrada) return next;
  const p = event.payload as EntradaIndice;
  if (state.afirmaciones.some((a) => a.afirmacionId === p.afirmacionId)) return next; // idempotente
  return {
    ...next,
    afirmaciones: [...state.afirmaciones, { afirmacionId: p.afirmacionId, clase: p.clase, enunciado: p.enunciado }],
  };
}

export function reconstruirIndice(
  organizacionId: string,
  events: readonly RecordedEvent[],
): IndiceEstrategicoState {
  return events.reduce(aplicarIndice, estadoInicialIndice(organizacionId));
}
