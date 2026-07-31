/**
 * @soec/crm-comercial · dominio · Índice de enumeración de contactos (patrón `@soec/programas`).
 *
 * El EventStore solo tiene `readStream`; para LISTAR los contactos de una organización se mantiene
 * un stream de índice `crmindice:<org>` con ids + nombre. Los DATOS de cada contacto permanecen
 * aislados en su propio stream `crm:<org>:<contactoId>`.
 */
import type { RecordedEvent } from '@soec/contracts';

export const EVENTOS_CRMINDICE = { registrado: 'crmindice.registrado' } as const;

export function crmIndiceStreamId(organizacionId: string): string {
  return `crmindice:${organizacionId}`;
}

export interface EntradaContacto {
  readonly contactoId: string;
  readonly nombre: string;
}

export interface CrmIndice {
  readonly contactos: readonly EntradaContacto[];
  readonly version: number;
}

export function reconstruirCrmIndice(events: readonly RecordedEvent[]): CrmIndice {
  return events.reduce<CrmIndice>(
    (s, e) => {
      const next = { ...s, version: s.version + 1 };
      if (e.type !== EVENTOS_CRMINDICE.registrado) return next;
      const p = e.payload as EntradaContacto;
      if (s.contactos.some((c) => c.contactoId === p.contactoId)) return next;
      return { ...next, contactos: [...s.contactos, p] };
    },
    { contactos: [], version: 0 },
  );
}

// ── Índice de hipótesis comerciales por organización ─────────────────────────────────────────
export const EVENTOS_HIPINDICE = { registrada: 'hipindice.registrada' } as const;

export function hipIndiceStreamId(organizacionId: string): string {
  return `hipindice:${organizacionId}`;
}

export interface EntradaHipotesis {
  readonly hipotesisId: string;
  readonly enunciado: string;
}

export interface HipIndice {
  readonly hipotesis: readonly EntradaHipotesis[];
  readonly version: number;
}

export function reconstruirHipIndice(events: readonly RecordedEvent[]): HipIndice {
  return events.reduce<HipIndice>(
    (s, e) => {
      const next = { ...s, version: s.version + 1 };
      if (e.type !== EVENTOS_HIPINDICE.registrada) return next;
      const p = e.payload as EntradaHipotesis;
      if (s.hipotesis.some((h) => h.hipotesisId === p.hipotesisId)) return next;
      return { ...next, hipotesis: [...s.hipotesis, p] };
    },
    { hipotesis: [], version: 0 },
  );
}
