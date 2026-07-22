/**
 * Interruptor maestro de pausa (F2-CTRL-01 §9). Pausa real e integrada con el plano
 * operacional (no meramente visual): cuando el departamento —o un canal, campaña o
 * tipo de acción— está pausado, no se producen nuevos efectos ejecutables (publicar,
 * optimizar con efecto, escalar); las lecturas, la verificación y la auditoría
 * continúan. Append-only; conserva quién pausó, por qué y cuándo.
 */
import type { RecordedEvent } from '@soec/contracts';

/**
 * El TIPO de alcance es un catálogo EXTENSIBLE (departamento/canal/campania/modulo/…):
 * el núcleo no lo conoce semánticamente. Un departamento futuro (p. ej. `inventario`)
 * puede pausar `inventario:almacen-1` sin modificar @soec/control.
 */
export type TipoAlcance = string;

export interface Alcance {
  readonly tipo: TipoAlcance;
  readonly valor: string; // '*' para el alcance completo (global)
}

/** Alcance global del departamento/organización; su pausa tiene precedencia sobre todo. */
export const ALCANCE_GLOBAL: Alcance = { tipo: 'departamento', valor: '*' };

/** Un alcance válido tiene un tipo con formato de catálogo y un valor no vacío. */
export function esAlcanceValido(a: Alcance): boolean {
  return /^[a-z][a-z0-9_]{1,40}$/.test(a.tipo) && typeof a.valor === 'string' && a.valor.length > 0;
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

/**
 * ¿Está pausado un efecto para alguno de estos alcances? El algoritmo trabaja por
 * igualdad y precedencia (la pausa GLOBAL precede a todo), SIN conocer la semántica de
 * cada departamento. El llamador aporta la cadena de ancestros del alcance a evaluar
 * (organización → departamento → módulo/capacidad → entidad); el núcleo solo compara
 * contra las pausas activas. Un alcance futuro válido funciona sin tocar este agregado.
 */
export function estaPausado(state: PausaState, alcances: readonly Alcance[] = []): boolean {
  if (state.activas[clave(ALCANCE_GLOBAL)]) return true; // precedencia de la pausa global
  for (const a of alcances) if (state.activas[clave(a)]) return true;
  return false;
}

export function pausaTotalActiva(state: PausaState): boolean {
  return !!state.activas['departamento:*'];
}
