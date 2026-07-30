/**
 * @soec/decisiones-mkt · dominio · Decisión de marketing rica y auditable (Bloque B).
 *
 * Distinta de `@soec/decision` (que gobierna el OBJETIVO ESTRATÉGICO vigente del
 * departamento): esta es la decisión OPERATIVA de marketing que puede convertirse en una
 * campaña, con hipótesis, alternativas, ejecución y evaluación. Reutiliza la tipología de
 * evidencia de `@soec/negocio` (no la duplica) y respeta la Constitución:
 * - una decisión NO_EVALUABLE nunca se vuelve campaña ejecutable;
 * - la ausencia de información nunca se transforma en conclusión;
 * - una hipótesis permanece identificada como hipótesis (no se guarda como hecho);
 * - toda alternativa descartada conserva su razón;
 * - la decisión se traza hasta fuentes/evidencias; una nueva recomendación indica qué
 *   aprendizaje la cambió. Máquina de estados verificable. Event-sourced.
 */
import type { RecordedEvent } from '@soec/contracts';
import type { TipoEvidencia } from '@soec/negocio';

export type EstadoDecision =
  | 'BORRADOR'
  | 'NO_EVALUABLE'
  | 'PROPUESTA'
  | 'PENDIENTE_APROBACION'
  | 'APROBADA'
  | 'RECHAZADA'
  | 'EN_EJECUCION'
  | 'DETENIDA'
  | 'COMPLETADA'
  | 'FALLIDA'
  | 'EVALUADA';

/** Un hecho observado conserva su origen epistémico (no se asume). */
export interface HechoObservado {
  readonly enunciado: string;
  readonly origen: TipoEvidencia;
  readonly fuente: string | null;
  readonly evidenciaId: string | null;
}
/** Una hipótesis SIEMPRE queda marcada como hipótesis. */
export interface Hipotesis {
  readonly id: string;
  readonly enunciado: string;
  readonly tipo: 'HIPOTESIS';
}
/** Una alternativa descartada conserva su razón (invariante). */
export interface Alternativa {
  readonly id: string;
  readonly descripcion: string;
  readonly elegida: boolean;
  readonly razonDescarte: string | null;
}

export interface EntradaDecision {
  readonly organizacionId: string;
  readonly objetivo: string;
  readonly contexto: string;
  readonly hechos: readonly HechoObservado[];
  readonly fuentes: readonly string[];
  readonly faltantesObligatorios: readonly string[];
  readonly inferencias: readonly string[];
  readonly hipotesis: readonly Hipotesis[];
  readonly alternativas: readonly Alternativa[];
  readonly justificacion: string;
  readonly riesgos: readonly string[];
  readonly confianza: 'ALTA' | 'MEDIA' | 'BAJA' | null;
  readonly criterioExito: string;
  readonly criterioFracaso: string;
  readonly aprobacionRequerida: boolean;
  readonly nivelAutonomia: number;
  /** Si esta decisión reemplaza una recomendación previa, qué aprendizaje la cambió. */
  readonly aprendizajeQueLaCambio: string | null;
}

export interface DecisionMkt extends EntradaDecision {
  readonly decisionId: string;
  readonly estado: EstadoDecision;
  readonly resultado: string | null;
  readonly autor: string;
  readonly en: string;
  readonly version: number;
  readonly existe: boolean;
}

// --- Máquina de estados verificable ----------------------------------------

const TRANSICIONES: Readonly<Record<EstadoDecision, readonly EstadoDecision[]>> = {
  BORRADOR: ['PROPUESTA', 'NO_EVALUABLE', 'RECHAZADA'],
  NO_EVALUABLE: ['PROPUESTA', 'RECHAZADA'], // NUNCA directo a APROBADA/ejecutable
  PROPUESTA: ['PENDIENTE_APROBACION', 'NO_EVALUABLE', 'RECHAZADA'],
  PENDIENTE_APROBACION: ['APROBADA', 'RECHAZADA', 'DETENIDA'],
  APROBADA: ['EN_EJECUCION', 'DETENIDA'],
  EN_EJECUCION: ['COMPLETADA', 'FALLIDA', 'DETENIDA'],
  DETENIDA: ['EN_EJECUCION', 'RECHAZADA'],
  COMPLETADA: ['EVALUADA'],
  FALLIDA: ['EVALUADA'],
  RECHAZADA: [],
  EVALUADA: [],
};

export function transicionValida(desde: EstadoDecision, hacia: EstadoDecision): boolean {
  return TRANSICIONES[desde].includes(hacia);
}

/** Evaluable ⇔ no hay información obligatoria faltante. La ausencia no es conclusión. */
export function esEvaluable(d: EntradaDecision): boolean {
  return d.faltantesObligatorios.length === 0;
}

/** Solo una decisión APROBADA puede originar una campaña ejecutable. */
export function esEjecutable(estado: EstadoDecision): boolean {
  return estado === 'APROBADA';
}

/** Validación estructural (invariantes de la Constitución). Devuelve lista de errores. */
export function validarEntrada(d: EntradaDecision): string[] {
  const e: string[] = [];
  if (!d.objetivo.trim()) e.push('objetivo_vacio');
  if (d.alternativas.some((a) => !a.elegida && !(a.razonDescarte ?? '').trim())) e.push('alternativa_descartada_sin_razon');
  if (d.alternativas.length > 0 && !d.alternativas.some((a) => a.elegida)) e.push('sin_alternativa_elegida');
  if (d.hipotesis.some((h) => h.tipo !== 'HIPOTESIS')) e.push('hipotesis_mal_tipada');
  return e;
}

// --- Eventos y reducer ------------------------------------------------------

export const EVENTOS_DECISION = {
  creada: 'decmkt.creada',
  transicionada: 'decmkt.transicionada',
  evaluada: 'decmkt.evaluada',
} as const;

export function decMktStreamId(organizacionId: string, decisionId: string): string {
  return `decmkt:${organizacionId}:${decisionId}`;
}

export function estadoInicialDecision(organizacionId: string, decisionId: string): DecisionMkt {
  return {
    decisionId,
    organizacionId,
    objetivo: '',
    contexto: '',
    hechos: [],
    fuentes: [],
    faltantesObligatorios: [],
    inferencias: [],
    hipotesis: [],
    alternativas: [],
    justificacion: '',
    riesgos: [],
    confianza: null,
    criterioExito: '',
    criterioFracaso: '',
    aprobacionRequerida: true,
    nivelAutonomia: 0,
    aprendizajeQueLaCambio: null,
    estado: 'BORRADOR',
    resultado: null,
    autor: '',
    en: '',
    version: 0,
    existe: false,
  };
}

interface PCreada extends EntradaDecision {
  estadoInicial: EstadoDecision;
}

export function aplicarDecision(state: DecisionMkt, event: RecordedEvent): DecisionMkt {
  const next = { ...state, version: state.version + 1, existe: true };
  switch (event.type) {
    case EVENTOS_DECISION.creada: {
      const p = event.payload as PCreada;
      return { ...next, ...p, estado: p.estadoInicial, autor: String(event.actor), en: event.recordedAt };
    }
    case EVENTOS_DECISION.transicionada: {
      const p = event.payload as { estado: EstadoDecision };
      return { ...next, estado: p.estado };
    }
    case EVENTOS_DECISION.evaluada: {
      const p = event.payload as { resultado: string };
      return { ...next, estado: 'EVALUADA', resultado: p.resultado };
    }
    default:
      return next;
  }
}

export function reconstruirDecision(organizacionId: string, decisionId: string, events: readonly RecordedEvent[]): DecisionMkt {
  return events.reduce(aplicarDecision, estadoInicialDecision(organizacionId, decisionId));
}
