/**
 * @soec/crm-comercial · dominio · HIPÓTESIS COMERCIAL — cierra el lazo hipótesis → evidencia →
 * resultado → aprendizaje en un ÚNICO agregado (hueco detectado en la auditoría: hoy está repartido
 * entre decisiones-mkt, medición y aprendizaje sin backreference estructural).
 *
 * Respeta Evaluabilidad: una hipótesis sin evidencia NO es evaluable (no se le asigna confianza como
 * si fuera un hecho); el "por qué funcionó/fracasó" es obligatorio al registrar el aprendizaje.
 * Event-sourced en stream `hipotesis:<org>:<hipotesisId>`.
 */
import type { RecordedEvent } from '@soec/contracts';
import { type Confianza, type TipoEvidencia } from '@soec/negocio';

export type EstadoHipotesis = 'ABIERTA' | 'EN_PRUEBA' | 'CONFIRMADA' | 'REFUTADA' | 'INCONCLUSA';
export type Veredicto = 'CONFIRMADA' | 'REFUTADA' | 'INCONCLUSA';

export interface EvidenciaHipotesis {
  readonly evidenciaId: string;
  readonly descripcion: string;
  readonly origen: TipoEvidencia;
  /** true = respalda la hipótesis; false = la contradice. */
  readonly aFavor: boolean;
}

export interface ResultadoHipotesis {
  readonly descripcion: string;
  readonly valor: number | null;
  readonly veredicto: Veredicto;
  readonly en: string;
}

export interface AprendizajeHipotesis {
  /** Por qué se cree que funcionó/fracasó (obligatorio: nunca "funcionó" a secas). */
  readonly porQue: string;
  /** Enunciado reutilizable/condiciones, si aplica. */
  readonly transferible: string | null;
}

export interface HipotesisState {
  readonly organizacionId: string;
  readonly hipotesisId: string;
  readonly version: number;
  readonly existe: boolean;
  readonly enunciado: string;
  readonly contexto: string;
  readonly estado: EstadoHipotesis;
  readonly evidencias: readonly EvidenciaHipotesis[];
  readonly resultado: ResultadoHipotesis | null;
  readonly aprendizaje: AprendizajeHipotesis | null;
}

export const EVENTOS_HIPOTESIS = {
  registrada: 'hip.registrada',
  evidencia: 'hip.evidencia_agregada',
  transicionada: 'hip.transicionada',
  resultado: 'hip.resultado_registrado',
  aprendizaje: 'hip.aprendizaje_registrado',
} as const;

export function hipotesisStreamId(organizacionId: string, hipotesisId: string): string {
  return `hipotesis:${organizacionId}:${hipotesisId}`;
}

export function estadoInicialHipotesis(organizacionId: string, hipotesisId: string): HipotesisState {
  return { organizacionId, hipotesisId, version: 0, existe: false, enunciado: '', contexto: '', estado: 'ABIERTA', evidencias: [], resultado: null, aprendizaje: null };
}

/** Transiciones válidas de la máquina de estados de una hipótesis. */
export function transicionValida(desde: EstadoHipotesis, hacia: EstadoHipotesis): boolean {
  if (desde === 'ABIERTA' && hacia === 'EN_PRUEBA') return true;
  if (desde === 'EN_PRUEBA' && (hacia === 'CONFIRMADA' || hacia === 'REFUTADA' || hacia === 'INCONCLUSA')) return true;
  return false;
}

export function aplicarHipotesis(state: HipotesisState, event: RecordedEvent): HipotesisState {
  const next = { ...state, version: state.version + 1 };
  switch (event.type) {
    case EVENTOS_HIPOTESIS.registrada: {
      const p = event.payload as { enunciado: string; contexto: string };
      return { ...next, existe: true, enunciado: p.enunciado, contexto: p.contexto };
    }
    case EVENTOS_HIPOTESIS.evidencia: {
      const p = event.payload as EvidenciaHipotesis;
      return { ...next, evidencias: [...state.evidencias, p] };
    }
    case EVENTOS_HIPOTESIS.transicionada: {
      const p = event.payload as { estado: EstadoHipotesis };
      return { ...next, estado: p.estado };
    }
    case EVENTOS_HIPOTESIS.resultado: {
      const p = event.payload as ResultadoHipotesis;
      return { ...next, resultado: p, estado: p.veredicto };
    }
    case EVENTOS_HIPOTESIS.aprendizaje: {
      const p = event.payload as AprendizajeHipotesis;
      return { ...next, aprendizaje: p };
    }
    default:
      return next;
  }
}

export function reconstruirHipotesis(organizacionId: string, hipotesisId: string, events: readonly RecordedEvent[]): HipotesisState {
  return events.reduce(aplicarHipotesis, estadoInicialHipotesis(organizacionId, hipotesisId));
}

// ── Evaluación explicable de una hipótesis ──────────────────────────────────────────────────────

export interface EvaluacionHipotesis {
  readonly evaluable: boolean;
  readonly confianza: Confianza;
  readonly aFavor: number;
  readonly enContra: number;
  readonly sintesis: string;
  readonly faltantes: readonly string[];
}

const ORIGENES_FUERTES: readonly TipoEvidencia[] = ['HECHO_VERIFICADO', 'DATO_IMPORTADO'];

/**
 * Evalúa una hipótesis a partir de su evidencia (Evaluabilidad: sin evidencia NO es evaluable). La
 * confianza refleja el balance de evidencia, no una opinión: fuerte a favor sin contra → ALTA.
 */
export function evaluarHipotesis(state: HipotesisState): EvaluacionHipotesis {
  const aFavor = state.evidencias.filter((e) => e.aFavor).length;
  const enContra = state.evidencias.filter((e) => !e.aFavor).length;
  const faltantes: string[] = [];
  if (state.evidencias.length === 0) {
    return { evaluable: false, confianza: null, aFavor: 0, enContra: 0, sintesis: 'sin evidencia: la hipótesis aún no es evaluable', faltantes: ['sin evidencia registrada'] };
  }
  const favorFuerte = state.evidencias.filter((e) => e.aFavor && ORIGENES_FUERTES.includes(e.origen)).length;
  let confianza: Confianza;
  if (enContra > aFavor) confianza = 'BAJA';
  else if (favorFuerte >= 1 && enContra === 0) confianza = 'ALTA';
  else confianza = 'MEDIA';
  if (!state.resultado) faltantes.push('sin resultado observado aún');
  const sintesis = `${aFavor} a favor / ${enContra} en contra (${favorFuerte} de evidencia fuerte)`;
  return { evaluable: true, confianza, aFavor, enContra, sintesis, faltantes };
}
