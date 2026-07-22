/**
 * Interruptor maestro de pausa (F2-CTRL-01 §9). Pausa real e integrada con el plano
 * operacional (no meramente visual): cuando el departamento —o un canal, campaña o
 * tipo de acción— está pausado, no se producen nuevos efectos ejecutables (publicar,
 * optimizar con efecto, escalar); las lecturas, la verificación y la auditoría
 * continúan. Append-only; conserva quién pausó, por qué y cuándo.
 */
import type { RecordedEvent } from '@soec/contracts';

export type TipoAlcance = 'departamento' | 'canal' | 'campania' | 'tipo_accion';

export interface Alcance {
  readonly tipo: TipoAlcance;
  readonly valor: string; // '*' para el departamento completo
}

export interface PausaActiva {
  readonly alcance: Alcance;
  readonly motivo: string;
  readonly actor: string;
  readonly desde: string;
}

export const EVENTOS_PAUSA = {
  activada: 'pausa.activada',
  reanudada: 'pausa.reanudada',
} as const;

export function pausaStreamId(organizationId: string): string {
  return `pausa:${organizationId}`;
}

export interface PausaState {
  readonly organizationId: string;
  readonly version: number;
  readonly activas: Readonly<Record<string, PausaActiva>>;
  readonly historial: readonly { accion: 'activada' | 'reanudada'; alcance: string; actor: string; en: string }[];
}

export function estadoInicialPausa(organizationId: string): PausaState {
  return { organizationId, version: 0, activas: {}, historial: [] };
}

function clave(a: Alcance): string {
  return `${a.tipo}:${a.valor}`;
}

interface PayloadActivada {
  alcance: Alcance;
  motivo: string;
  actor: string;
}
interface PayloadReanudada {
  alcance: Alcance;
  actor: string;
}

export function aplicarPausa(state: PausaState, event: RecordedEvent): PausaState {
  const next = { ...state, version: state.version + 1 };
  switch (event.type) {
    case EVENTOS_PAUSA.activada: {
      const p = event.payload as PayloadActivada;
      const k = clave(p.alcance);
      return {
        ...next,
        activas: { ...state.activas, [k]: { alcance: p.alcance, motivo: p.motivo, actor: p.actor, desde: event.recordedAt } },
        historial: [...state.historial, { accion: 'activada', alcance: k, actor: p.actor, en: event.recordedAt }],
      };
    }
    case EVENTOS_PAUSA.reanudada: {
      const p = event.payload as PayloadReanudada;
      const k = clave(p.alcance);
      const activas = { ...state.activas };
      delete activas[k];
      return { ...next, activas, historial: [...state.historial, { accion: 'reanudada', alcance: k, actor: p.actor, en: event.recordedAt }] };
    }
    default:
      return next;
  }
}

export function reconstruirPausa(organizationId: string, events: readonly RecordedEvent[]): PausaState {
  return events.reduce(aplicarPausa, estadoInicialPausa(organizationId));
}

/** ¿Está pausado un efecto en este contexto? La pausa del departamento propaga a todo. */
export function estaPausado(state: PausaState, ctx: { canal?: string; campania?: string; tipoAccion?: string } = {}): boolean {
  if (state.activas['departamento:*']) return true;
  if (ctx.canal && state.activas[`canal:${ctx.canal}`]) return true;
  if (ctx.campania && state.activas[`campania:${ctx.campania}`]) return true;
  if (ctx.tipoAccion && state.activas[`tipo_accion:${ctx.tipoAccion}`]) return true;
  return false;
}

export function pausaTotalActiva(state: PausaState): boolean {
  return !!state.activas['departamento:*'];
}
