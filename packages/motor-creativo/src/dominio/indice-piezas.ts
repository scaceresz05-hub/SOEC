/**
 * @soec/motor-creativo · dominio · ÍNDICE de piezas (paquetes) gobernadas por organización.
 * Permite a M7 listar piezas aprobadas sin conocer los ids. Event-sourced, idempotente (patrón H-6).
 */
import type { RecordedEvent } from '@soec/contracts';

export const EVENTOS_INDICE_PIEZAS = { registrada: 'creativo-pieza-indice.registrada' } as const;

export function indicePiezasStreamId(organizacionId: string): string {
  return `creativo-pieza-indice:${organizacionId}`;
}

export interface IndicePiezasState {
  readonly organizacionId: string;
  readonly version: number;
  readonly paquetes: readonly string[];
}

export function reconstruirIndicePiezas(organizacionId: string, events: readonly RecordedEvent[]): IndicePiezasState {
  return events.reduce<IndicePiezasState>(
    (s, e) => {
      const next = { ...s, version: s.version + 1 };
      if (e.type !== EVENTOS_INDICE_PIEZAS.registrada) return next;
      const p = e.payload as { paqueteId: string };
      if (s.paquetes.includes(p.paqueteId)) return next;
      return { ...next, paquetes: [...s.paquetes, p.paqueteId] };
    },
    { organizacionId, version: 0, paquetes: [] },
  );
}
