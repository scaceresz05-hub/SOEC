/**
 * @soec/aprendizaje · dominio · Aprendizaje de marketing basado en experimentos (Bloque G).
 *
 * El aprendizaje NO es texto libre: se estructura en CUATRO CAPAS explícitamente separadas,
 * para no confundir lo que se midió con lo que se cree ni con lo que se generaliza:
 *   1. ResultadoObservado — hechos del experimento (deterministas; provienen de `@soec/medicion`).
 *   2. Interpretacion — lectura razonada del resultado, con sus supuestos (NO es un hecho).
 *   3. Conclusion — qué se decide dado el soporte de evidencia (suficiente / insuficiente).
 *   4. AprendizajeReutilizable — enunciado generalizable, con su ámbito y condiciones.
 *
 * Guardarraíl multi-tenant: un aprendizaje nacido en una organización (p. ej. SmileFlow) NO
 * puede aplicarse a otra (p. ej. SSR Control) sin una DECISIÓN HUMANA explícita. Nunca se
 * transfiere solo. Event-sourced (`aprendizaje:<org>:<id>`).
 */
import type { RecordedEvent } from '@soec/contracts';

/** Capa 1: hechos observados del experimento. Reflejan `ResultadoExperimento` de @soec/medicion. */
export interface ResultadoObservado {
  readonly experimentoId: string;
  readonly ganador: 'control' | 'variante' | null;
  readonly valorControl: number;
  readonly valorVariante: number;
  readonly observaciones: number;
  readonly evidencia: string;
}

/** Capa 2: interpretación razonada. Declara sus supuestos; nunca se presenta como hecho. */
export interface Interpretacion {
  readonly texto: string;
  readonly supuestos: readonly string[];
  readonly confianza: 'baja' | 'media' | 'alta';
}

/** Capa 3: conclusión, condicionada al soporte de evidencia. */
export interface Conclusion {
  readonly enunciado: string;
  readonly soporte: 'evidencia_suficiente' | 'evidencia_insuficiente';
  readonly accionRecomendada: string;
}

/** Capa 4: aprendizaje generalizable, con ámbito y condiciones de validez. */
export interface AprendizajeReutilizable {
  readonly enunciado: string;
  readonly condiciones: readonly string[];
  /** Ámbitos (organizaciones/segmentos) donde se cree aplicable; NO autoriza por sí mismo. */
  readonly ambitoSugerido: readonly string[];
}

export type EstadoAprendizaje = 'REGISTRADO' | 'APLICADO';

/** Registro de una aplicación del aprendizaje a una organización, con su respaldo humano. */
export interface AplicacionAprendizaje {
  readonly organizacionDestino: string;
  readonly actorHumano: string;
  readonly decisionId: string;
  readonly justificacion: string;
  readonly en: string;
}

export interface Aprendizaje {
  readonly aprendizajeId: string;
  readonly organizacionOrigen: string;
  readonly observado: ResultadoObservado | null;
  readonly interpretacion: Interpretacion | null;
  readonly conclusion: Conclusion | null;
  readonly reutilizable: AprendizajeReutilizable | null;
  readonly aplicaciones: readonly AplicacionAprendizaje[];
  readonly estado: EstadoAprendizaje;
  readonly autor: string;
  readonly en: string;
  readonly version: number;
  readonly existe: boolean;
}

export const EVENTOS_APRENDIZAJE = { registrado: 'aprendizaje.registrado', aplicado: 'aprendizaje.aplicado' } as const;

export function aprendizajeStreamId(organizacionId: string, aprendizajeId: string): string {
  return `aprendizaje:${organizacionId}:${aprendizajeId}`;
}

export function estadoInicialAprendizaje(organizacionOrigen: string, aprendizajeId: string): Aprendizaje {
  return {
    aprendizajeId,
    organizacionOrigen,
    observado: null,
    interpretacion: null,
    conclusion: null,
    reutilizable: null,
    aplicaciones: [],
    estado: 'REGISTRADO',
    autor: '',
    en: '',
    version: 0,
    existe: false,
  };
}

type PayloadRegistrado = Pick<Aprendizaje, 'observado' | 'interpretacion' | 'conclusion' | 'reutilizable'>;

export function aplicarAprendizaje(state: Aprendizaje, event: RecordedEvent): Aprendizaje {
  const next = { ...state, version: state.version + 1, existe: true };
  switch (event.type) {
    case EVENTOS_APRENDIZAJE.registrado: {
      const p = event.payload as PayloadRegistrado;
      return { ...next, ...p, autor: String(event.actor), en: event.recordedAt };
    }
    case EVENTOS_APRENDIZAJE.aplicado: {
      const p = event.payload as AplicacionAprendizaje;
      return { ...next, aplicaciones: [...state.aplicaciones, p], estado: 'APLICADO' };
    }
    default:
      return next;
  }
}

export function reconstruirAprendizaje(organizacionOrigen: string, aprendizajeId: string, events: readonly RecordedEvent[]): Aprendizaje {
  return events.reduce(aplicarAprendizaje, estadoInicialAprendizaje(organizacionOrigen, aprendizajeId));
}
