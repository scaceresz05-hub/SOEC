/**
 * @soec/motor-optimizacion · dominio · CICLO DE OPTIMIZACIÓN (agregado event-sourced, M9).
 *
 * Modela el ciclo canónico: estado vigente → evidencia → oportunidades → alternativas → comparación →
 * propuesta → aprobación humana → nueva versión. Construido por PASOS event-sourced (cada uno es una
 * frontera real de fallo/recuperación). M9 termina en una PROPUESTA APROBABLE, nunca en una ejecución.
 * Multi-tenant, determinista, historia append-only.
 *
 * Estados: ABIERTO · RECOPILANDO_EVIDENCIA · EVALUABLE · NO_EVALUABLE · PROPUESTAS_GENERADAS ·
 *          PENDIENTE_APROBACION · APROBADO · RECHAZADO · APLICADO_SIMULADO · OBSOLETO · CANCELADO.
 */
import type { RecordedEvent } from '@soec/contracts';
import type { Oportunidad, Alternativa } from './optimizacion-tipos';
import type { AlternativaComparada } from './comparacion';

export type EstadoCiclo =
  | 'ABIERTO' | 'RECOPILANDO_EVIDENCIA' | 'EVALUABLE' | 'NO_EVALUABLE' | 'PROPUESTAS_GENERADAS'
  | 'PENDIENTE_APROBACION' | 'APROBADO' | 'RECHAZADO' | 'APLICADO_SIMULADO' | 'OBSOLETO' | 'CANCELADO';

export interface VersionesBase {
  readonly hipotesisId: string;
  readonly hipotesisVersion: number;
  readonly piezaId: string;
  readonly piezaVersion: number;
  readonly varianteId: string;
  readonly varianteVersion: number;
  readonly planRef: string; // ordenId de M7 (plan operacional vigente)
}

export interface CuerpoCiclo {
  readonly objetivo: string;
  readonly segmento: string;
  readonly versionesBase: VersionesBase | null;
  readonly evaluacionesM8: readonly string[];
  readonly aprendizajes: readonly string[];
  readonly contradicciones: readonly string[];
  readonly presupuestoDisponible: number;
  readonly oportunidades: readonly Oportunidad[];
  readonly alternativas: readonly Alternativa[];
  readonly comparacion: readonly AlternativaComparada[];
  readonly propuestaId: string | null;
  readonly explicacion: string;
}

export interface CicloState {
  readonly organizacionId: string;
  readonly cicloId: string;
  readonly version: number;
  readonly existe: boolean;
  readonly estado: EstadoCiclo;
  readonly cuerpo: CuerpoCiclo;
  readonly motivo: string | null;
}

export const EVENTOS_CICLO = {
  abierto: 'ciclo.abierto',
  evidencia: 'ciclo.evidencia_recopilada',
  evaluabilidad: 'ciclo.evaluabilidad',
  oportunidad: 'ciclo.oportunidad_registrada',
  alternativa: 'ciclo.alternativa_registrada',
  comparacion: 'ciclo.comparacion',
  propuestas: 'ciclo.propuestas_generadas',
  pendiente: 'ciclo.pendiente_aprobacion',
  resuelto: 'ciclo.resuelto',
  aplicado: 'ciclo.aplicado',
  obsoleto: 'ciclo.obsoleto',
  cancelado: 'ciclo.cancelado',
} as const;

export function cicloStreamId(organizacionId: string, cicloId: string): string {
  return `ciclo-opt:${organizacionId}:${cicloId}`;
}

const CUERPO_VACIO: CuerpoCiclo = {
  objetivo: '', segmento: '', versionesBase: null, evaluacionesM8: [], aprendizajes: [], contradicciones: [],
  presupuestoDisponible: 0, oportunidades: [], alternativas: [], comparacion: [], propuestaId: null, explicacion: '',
};

export function estadoInicialCiclo(organizacionId: string, cicloId: string): CicloState {
  return { organizacionId, cicloId, version: 0, existe: false, estado: 'ABIERTO', cuerpo: CUERPO_VACIO, motivo: null };
}

const TERMINALES: readonly EstadoCiclo[] = ['APLICADO_SIMULADO', 'RECHAZADO', 'OBSOLETO', 'CANCELADO', 'NO_EVALUABLE'];
export function cicloTerminal(estado: EstadoCiclo): boolean { return TERMINALES.includes(estado); }

export function aplicarCiclo(state: CicloState, event: RecordedEvent): CicloState {
  const next = { ...state, version: state.version + 1 };
  const c = state.cuerpo;
  const p = event.payload as Record<string, unknown>;
  const set = (cuerpo: Partial<CuerpoCiclo>, estado?: EstadoCiclo): CicloState => ({ ...next, existe: true, cuerpo: { ...c, ...cuerpo }, ...(estado ? { estado } : {}) });
  switch (event.type) {
    case EVENTOS_CICLO.abierto:
      if (state.existe) return next; // idempotente
      return set({ objetivo: p.objetivo as string, segmento: p.segmento as string, versionesBase: p.versionesBase as VersionesBase, presupuestoDisponible: (p.presupuestoDisponible as number) ?? 0 }, 'ABIERTO');
    case EVENTOS_CICLO.evidencia:
      if (state.estado !== 'ABIERTO') return next;
      return set({ evaluacionesM8: p.evaluacionesM8 as string[], aprendizajes: p.aprendizajes as string[], contradicciones: (p.contradicciones as string[]) ?? [] }, 'RECOPILANDO_EVIDENCIA');
    case EVENTOS_CICLO.evaluabilidad:
      if (state.estado !== 'RECOPILANDO_EVIDENCIA') return next;
      return set({ explicacion: (p.motivo as string) ?? '' }, (p.evaluable as boolean) ? 'EVALUABLE' : 'NO_EVALUABLE');
    case EVENTOS_CICLO.oportunidad: {
      const o = p.oportunidad as Oportunidad;
      if (c.oportunidades.some((x) => x.oportunidadId === o.oportunidadId)) return next; // dedup idempotente
      return set({ oportunidades: [...c.oportunidades, o] });
    }
    case EVENTOS_CICLO.alternativa: {
      const alt = p.alternativa as Alternativa;
      if (c.alternativas.some((x) => x.alternativaId === alt.alternativaId)) return next;
      return set({ alternativas: [...c.alternativas, alt] });
    }
    case EVENTOS_CICLO.comparacion:
      if (c.comparacion.length > 0) return next;
      return set({ comparacion: p.comparadas as AlternativaComparada[] });
    case EVENTOS_CICLO.propuestas:
      if (state.estado !== 'EVALUABLE') return next;
      return set({ propuestaId: (p.propuestaId as string) ?? null }, 'PROPUESTAS_GENERADAS');
    case EVENTOS_CICLO.pendiente:
      if (state.estado !== 'PROPUESTAS_GENERADAS') return next;
      return set({ propuestaId: p.propuestaId as string }, 'PENDIENTE_APROBACION');
    case EVENTOS_CICLO.resuelto:
      if (state.estado !== 'PENDIENTE_APROBACION') return next;
      return { ...next, estado: (p.estado as EstadoCiclo) };
    case EVENTOS_CICLO.aplicado:
      if (state.estado !== 'APROBADO') return next;
      return set({ explicacion: (p.explicacion as string) ?? c.explicacion }, 'APLICADO_SIMULADO');
    case EVENTOS_CICLO.obsoleto:
      if (cicloTerminal(state.estado)) return next;
      return { ...next, estado: 'OBSOLETO', motivo: (p.motivo as string) ?? null };
    case EVENTOS_CICLO.cancelado:
      if (cicloTerminal(state.estado)) return next;
      return { ...next, estado: 'CANCELADO', motivo: (p.motivo as string) ?? null };
    default:
      return next;
  }
}

export function reconstruirCiclo(organizacionId: string, cicloId: string, events: readonly RecordedEvent[]): CicloState {
  return events.reduce(aplicarCiclo, estadoInicialCiclo(organizacionId, cicloId));
}
