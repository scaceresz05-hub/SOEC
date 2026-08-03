/**
 * @soec/motor-creativo · dominio · ÍNDICE de territorios por organización (consultas).
 * Event-sourced (`creativo-territorio-indice:<org>`), idempotente y autorreparable (patrón H-6).
 */
import type { RecordedEvent } from '@soec/contracts';

export interface EntradaIndiceTerritorio {
  readonly territorioId: string;
  readonly tesis: string;
}

export interface IndiceTerritoriosState {
  readonly organizacionId: string;
  readonly version: number;
  readonly territorios: readonly EntradaIndiceTerritorio[];
}

export const EVENTOS_INDICE_TERRITORIO = { registrado: 'creativo-territorio-indice.registrado' } as const;

export function indiceTerritoriosStreamId(organizacionId: string): string {
  return `creativo-territorio-indice:${organizacionId}`;
}

export function reconstruirIndiceTerritorios(
  organizacionId: string,
  events: readonly RecordedEvent[],
): IndiceTerritoriosState {
  return events.reduce<IndiceTerritoriosState>(
    (s, e) => {
      const next = { ...s, version: s.version + 1 };
      if (e.type !== EVENTOS_INDICE_TERRITORIO.registrado) return next;
      const p = e.payload as EntradaIndiceTerritorio;
      if (s.territorios.some((t) => t.territorioId === p.territorioId)) return next;
      return { ...next, territorios: [...s.territorios, { territorioId: p.territorioId, tesis: p.tesis }] };
    },
    { organizacionId, version: 0, territorios: [] },
  );
}
