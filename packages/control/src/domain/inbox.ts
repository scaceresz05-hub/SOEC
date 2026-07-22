/**
 * Buzón de control: alertas y notificaciones internas (F2-CTRL-01 §17, §18). Agregado
 * por organización que acumula alertas (deduplicadas por clave estable, con estado y
 * resolución) y notificaciones internas (vista/atendida/resuelta/descartada). Las
 * notificaciones referencian la alerta/decisión original; no son la fuente de verdad.
 * NO se envían correos, WhatsApp ni push reales.
 */
import type { RecordedEvent } from '@soec/contracts';

export type SeveridadAlerta = 'info' | 'menor' | 'mayor' | 'critico';
export type EstadoAlerta = 'abierta' | 'atendida' | 'resuelta';
export type TipoAlerta =
  | 'presupuesto'
  | 'gasto_anomalo'
  | 'publicacion_fallida'
  | 'publicacion_desconocida'
  | 'credencial'
  | 'canal'
  | 'activo'
  | 'politica'
  | 'contenido'
  | 'metrica'
  | 'evidencia'
  | 'optimizacion'
  | 'vencimiento';

export interface Alerta {
  readonly clave: string; // estable → deduplicación
  readonly tipo: TipoAlerta;
  readonly severidad: SeveridadAlerta;
  readonly origen: string;
  readonly entidad: string;
  readonly evidencia: string;
  readonly impacto: string;
  readonly accionAutomatica: string;
  readonly accionHumana: string;
  readonly estado: EstadoAlerta;
  readonly en: string;
}

export type EstadoNotificacion = 'nueva' | 'vista' | 'atendida' | 'resuelta' | 'descartada';
export type ClaseNotificacion = 'informativa' | 'advertencia' | 'decision_requerida' | 'riesgo' | 'resultado' | 'resumen';

export interface Notificacion {
  readonly id: string;
  readonly clase: ClaseNotificacion;
  readonly texto: string;
  readonly refAlerta: string | null;
  readonly refDecision: string | null;
  readonly estado: EstadoNotificacion;
  readonly en: string;
}

export const EVENTOS_INBOX = {
  alertaRegistrada: 'ctrl.alerta_registrada',
  alertaResuelta: 'ctrl.alerta_resuelta',
  notiRegistrada: 'ctrl.noti_registrada',
  notiMarcada: 'ctrl.noti_marcada',
} as const;

export function inboxStreamId(organizationId: string): string {
  return `ctrlbox:${organizationId}`;
}

export interface InboxState {
  readonly organizationId: string;
  readonly version: number;
  readonly alertas: Readonly<Record<string, Alerta>>;
  readonly notificaciones: Readonly<Record<string, Notificacion>>;
}

export function estadoInicialInbox(organizationId: string): InboxState {
  return { organizationId, version: 0, alertas: {}, notificaciones: {} };
}

interface PAlerta {
  alerta: Omit<Alerta, 'estado' | 'en'>;
}
interface PAlertaResuelta {
  clave: string;
  estado: EstadoAlerta;
}
interface PNoti {
  notificacion: Omit<Notificacion, 'estado' | 'en'>;
}
interface PNotiMarcada {
  id: string;
  estado: EstadoNotificacion;
}

export function aplicarInbox(state: InboxState, event: RecordedEvent): InboxState {
  const next = { ...state, version: state.version + 1 };
  switch (event.type) {
    case EVENTOS_INBOX.alertaRegistrada: {
      const p = event.payload as PAlerta;
      const prev = state.alertas[p.alerta.clave];
      // Deduplicación: no se crea una alerta nueva por el mismo problema abierto.
      if (prev && prev.estado !== 'resuelta') return next;
      return { ...next, alertas: { ...state.alertas, [p.alerta.clave]: { ...p.alerta, estado: 'abierta', en: event.recordedAt } } };
    }
    case EVENTOS_INBOX.alertaResuelta: {
      const p = event.payload as PAlertaResuelta;
      const a = state.alertas[p.clave];
      if (!a) return next;
      return { ...next, alertas: { ...state.alertas, [p.clave]: { ...a, estado: p.estado } } };
    }
    case EVENTOS_INBOX.notiRegistrada: {
      const p = event.payload as PNoti;
      return { ...next, notificaciones: { ...state.notificaciones, [p.notificacion.id]: { ...p.notificacion, estado: 'nueva', en: event.recordedAt } } };
    }
    case EVENTOS_INBOX.notiMarcada: {
      const p = event.payload as PNotiMarcada;
      const n = state.notificaciones[p.id];
      if (!n) return next;
      return { ...next, notificaciones: { ...state.notificaciones, [p.id]: { ...n, estado: p.estado } } };
    }
    default:
      return next;
  }
}

export function reconstruirInbox(organizationId: string, events: readonly RecordedEvent[]): InboxState {
  return events.reduce(aplicarInbox, estadoInicialInbox(organizationId));
}
