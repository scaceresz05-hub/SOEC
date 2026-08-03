/**
 * @soec/plataforma-capacidades · dominio · Índice de capacidades por organización (enumeración
 * multi-tenant, event-sourced, idempotente y autorreparable). No guarda estado de la capacidad, sólo
 * su existencia + tipo, para poder listarlas sin barrer streams.
 */
import type { RecordedEvent } from '@soec/contracts';

export interface CapacidadIndiceItem {
  readonly capacidadId: string;
  readonly tipo: string;
}
export interface CapacidadIndice {
  readonly organizationId: string;
  readonly version: number;
  readonly capacidades: readonly CapacidadIndiceItem[];
}

export const EVENTOS_CAP_INDICE = { registrada: 'capacidad_indice.registrada' } as const;

export function capacidadIndiceStreamId(org: string): string {
  return `capacidades-externas:${org}`;
}

export function reconstruirCapacidadIndice(org: string, eventos: readonly RecordedEvent[]): CapacidadIndice {
  return eventos.reduce<CapacidadIndice>(
    (st, ev) => {
      const next = { ...st, version: st.version + 1 };
      if (ev.type === EVENTOS_CAP_INDICE.registrada) {
        const p = ev.payload as CapacidadIndiceItem;
        if (st.capacidades.some((c) => c.capacidadId === p.capacidadId)) return next;
        return { ...next, capacidades: [...st.capacidades, p] };
      }
      return next;
    },
    { organizationId: org, version: 0, capacidades: [] },
  );
}
