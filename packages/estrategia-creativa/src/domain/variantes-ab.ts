/**
 * @soec/estrategia-creativa · dominio · Variantes A/B con CONTROL EXPERIMENTAL (Tramo 4, M3).
 *
 * Una prueba A/B cambia UNA sola dimensión principal por vez (gancho, CTA, ángulo, formato, longitud,
 * prueba social) manteniendo constantes el resto; nunca se llama A/B a dos piezas completamente
 * distintas sin control. Cada variante declara qué hipótesis prueba. Event-sourced, multi-tenant,
 * simulado/no productivo. No genera efectos externos.
 */
import type { RecordedEvent } from '@soec/contracts';

export type ElementoAB = 'gancho' | 'cta' | 'angulo' | 'formato' | 'longitud' | 'prueba_social';
export type EstadoVariante = 'BORRADOR' | 'EN_PRUEBA' | 'GANADORA' | 'DESCARTADA';

export interface VarianteAB {
  readonly varianteId: string;
  readonly piezaBaseId: string;
  readonly hipotesisQuePrueba: string;
  /** La única dimensión que cambia respecto de la base. */
  readonly elementoModificado: ElementoAB;
  /** Descripción del cambio controlado y su valor en la variante. */
  readonly diferenciaControlada: string;
  /** Elementos que se mantienen constantes (control experimental). */
  readonly elementosConstantes: readonly string[];
  readonly criterioExito: string;
  readonly estado: EstadoVariante;
}

export interface ExperimentoABState {
  readonly organizacionId: string;
  readonly piezaBaseId: string;
  readonly version: number;
  readonly existe: boolean;
  readonly variantes: readonly VarianteAB[];
}

export const EVENTOS_AB = {
  abierto: 'ab.experimento_abierto',
  variante: 'ab.variante_agregada',
  transicion: 'ab.variante_transicionada',
} as const;

export function experimentoABStreamId(organizacionId: string, piezaBaseId: string): string {
  return `ab:${organizacionId}:${piezaBaseId}`;
}

export function estadoInicialExperimentoAB(organizacionId: string, piezaBaseId: string): ExperimentoABState {
  return { organizacionId, piezaBaseId, version: 0, existe: false, variantes: [] };
}

export interface EntradaVariante {
  readonly varianteId: string;
  readonly hipotesisQuePrueba: string;
  readonly elementoModificado: ElementoAB;
  readonly diferenciaControlada: string;
  readonly elementosConstantes: readonly string[];
  readonly criterioExito: string;
}

/** Valida el control experimental: hipótesis obligatoria, cambio declarado en UNA dimensión, y —si ya
 * hay variantes— que compartan los mismos elementos constantes (no dos piezas distintas). */
export function validarVariante(state: ExperimentoABState, v: EntradaVariante): { ok: boolean; motivo: string } {
  if (!v.varianteId?.trim()) return { ok: false, motivo: 'varianteId obligatorio' };
  if (!v.hipotesisQuePrueba?.trim()) return { ok: false, motivo: 'una variante A/B debe declarar la hipótesis que prueba' };
  if (!v.diferenciaControlada?.trim()) return { ok: false, motivo: 'la variante debe declarar su diferencia controlada' };
  if (v.elementosConstantes.length === 0) return { ok: false, motivo: 'debe declarar los elementos constantes (control)' };
  // C-5: la variable modificada NO puede declararse también como constante (contradicción del control).
  if (v.elementosConstantes.includes(v.elementoModificado)) {
    return { ok: false, motivo: `el elemento modificado '${v.elementoModificado}' no puede estar entre los constantes` };
  }
  const otra = state.variantes[0];
  if (otra) {
    const a = [...otra.elementosConstantes].sort().join('|');
    const b = [...v.elementosConstantes].sort().join('|');
    if (a !== b) return { ok: false, motivo: 'las variantes deben compartir los mismos elementos constantes (control experimental)' };
  }
  return { ok: true, motivo: '' };
}

export function aplicarExperimentoAB(state: ExperimentoABState, event: RecordedEvent): ExperimentoABState {
  const next = { ...state, version: state.version + 1 };
  switch (event.type) {
    case EVENTOS_AB.abierto:
      return { ...next, existe: true };
    case EVENTOS_AB.variante: {
      const p = event.payload as VarianteAB;
      if (state.variantes.some((x) => x.varianteId === p.varianteId)) return next; // idempotente
      return { ...next, variantes: [...state.variantes, p] };
    }
    case EVENTOS_AB.transicion: {
      const p = event.payload as { varianteId: string; estado: EstadoVariante };
      return { ...next, variantes: state.variantes.map((x) => (x.varianteId === p.varianteId ? { ...x, estado: p.estado } : x)) };
    }
    default:
      return next;
  }
}

export function reconstruirExperimentoAB(organizacionId: string, piezaBaseId: string, events: readonly RecordedEvent[]): ExperimentoABState {
  return events.reduce(aplicarExperimentoAB, estadoInicialExperimentoAB(organizacionId, piezaBaseId));
}
