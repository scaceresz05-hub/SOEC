/**
 * @soec/programas · dominio · Índices de enumeración (patrón `@soec/evaluacion`).
 *
 * El EventStore solo tiene `readStream`; para LISTAR se mantiene un stream de índice:
 *   - `orgindice`      → registro de organizaciones piloto (ids + nombre) para el selector.
 *   - `progindice:<org>` → lista de programas por organización.
 * El registro de organizaciones es una lista de ids/nombres (como el catálogo actual); los DATOS
 * de cada organización permanecen aislados en sus streams `…:<org>:…`.
 */
import type { RecordedEvent } from '@soec/contracts';

// ── Índice de organizaciones (registro global de pilotos) ────────────────────────────────────
export const EVENTOS_ORGINDICE = { registrada: 'orgindice.registrada' } as const;
export function orgIndiceStreamId(): string {
  return 'orgindice';
}
export interface EntradaOrg {
  readonly org: string;
  readonly nombre: string;
}
export interface OrgIndice {
  readonly organizaciones: readonly EntradaOrg[];
  readonly version: number;
}
export function reconstruirOrgIndice(events: readonly RecordedEvent[]): OrgIndice {
  return events.reduce<OrgIndice>(
    (s, e) => {
      const next = { ...s, version: s.version + 1 };
      if (e.type !== EVENTOS_ORGINDICE.registrada) return next;
      const p = e.payload as EntradaOrg;
      if (s.organizaciones.some((o) => o.org === p.org)) return next;
      return { ...next, organizaciones: [...s.organizaciones, p] };
    },
    { organizaciones: [], version: 0 },
  );
}

// ── Índice de programas por organización ─────────────────────────────────────────────────────
export const EVENTOS_PROGINDICE = { registrado: 'progindice.registrado' } as const;
export function progIndiceStreamId(organizacionId: string): string {
  return `progindice:${organizacionId}`;
}
export interface EntradaPrograma {
  readonly programaId: string;
  readonly nombre: string;
}
export interface ProgIndice {
  readonly programas: readonly EntradaPrograma[];
  readonly version: number;
}
export function reconstruirProgIndice(events: readonly RecordedEvent[]): ProgIndice {
  return events.reduce<ProgIndice>(
    (s, e) => {
      const next = { ...s, version: s.version + 1 };
      if (e.type !== EVENTOS_PROGINDICE.registrado) return next;
      const p = e.payload as EntradaPrograma;
      if (s.programas.some((x) => x.programaId === p.programaId)) return next;
      return { ...next, programas: [...s.programas, p] };
    },
    { programas: [], version: 0 },
  );
}
