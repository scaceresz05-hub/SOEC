/**
 * @soec/secretos · dominio · REGISTRO de referencias de secreto (M4-B). Gobierna, event-sourced y
 * multi-tenant, QUÉ referencias existen para una organización y su rotación. Guarda SÓLO metadatos:
 * `nombreLogico → { secretRef, version, actor, en }`. NUNCA el valor de un secreto (Art. 4). El valor
 * se resuelve exclusivamente en el adaptador de frontera (`SecretStore`), fuera de este dominio.
 */
import type { RecordedEvent } from '@soec/contracts';

export interface RegistroSecretoState {
  readonly organizationId: string;
  readonly nombreLogico: string;
  readonly version: number; // versión de eventos
  readonly existe: boolean;
  readonly secretRef: string | null; // REFERENCIA (nunca el valor)
  readonly rotaciones: number; // cuántas veces se rotó (Art. 7)
  readonly actor: string | null;
  readonly en: string | null;
}

export const EVENTOS_SECRETO = { registrada: 'secreto.referencia_registrada', rotada: 'secreto.referencia_rotada' } as const;

export function registroSecretoStreamId(org: string, nombreLogico: string): string {
  return `secreto:${org}:${nombreLogico}`;
}

export function estadoInicialRegistroSecreto(org: string, nombreLogico: string): RegistroSecretoState {
  return { organizationId: org, nombreLogico, version: 0, existe: false, secretRef: null, rotaciones: 0, actor: null, en: null };
}

export function aplicarRegistroSecreto(state: RegistroSecretoState, ev: RecordedEvent): RegistroSecretoState {
  const next = { ...state, version: state.version + 1 };
  if (ev.type === EVENTOS_SECRETO.registrada) {
    const p = ev.payload as { secretRef: string; actor: string; en: string };
    return { ...next, existe: true, secretRef: p.secretRef, actor: p.actor, en: p.en };
  }
  if (ev.type === EVENTOS_SECRETO.rotada) {
    const p = ev.payload as { secretRef: string; actor: string; en: string };
    return { ...next, secretRef: p.secretRef, rotaciones: state.rotaciones + 1, actor: p.actor, en: p.en };
  }
  return next;
}

export function reconstruirRegistroSecreto(org: string, nombreLogico: string, eventos: readonly RecordedEvent[]): RegistroSecretoState {
  return eventos.reduce(aplicarRegistroSecreto, estadoInicialRegistroSecreto(org, nombreLogico));
}

// ── Índice por organización (enumeración idempotente/autorreparable) ──────────────────────────────
export interface RegistroSecretoIndice {
  readonly organizationId: string;
  readonly version: number;
  readonly nombres: readonly string[];
}
export const EVENTOS_SECRETO_INDICE = { registrada: 'secreto_indice.registrada' } as const;
export function registroSecretoIndiceStreamId(org: string): string {
  return `secretos:${org}`;
}
export function reconstruirRegistroSecretoIndice(org: string, eventos: readonly RecordedEvent[]): RegistroSecretoIndice {
  return eventos.reduce<RegistroSecretoIndice>(
    (st, ev) => {
      const next = { ...st, version: st.version + 1 };
      if (ev.type === EVENTOS_SECRETO_INDICE.registrada) {
        const p = ev.payload as { nombreLogico: string };
        if (st.nombres.includes(p.nombreLogico)) return next;
        return { ...next, nombres: [...st.nombres, p.nombreLogico] };
      }
      return next;
    },
    { organizationId: org, version: 0, nombres: [] },
  );
}
