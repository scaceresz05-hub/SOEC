/**
 * @soec/campanias · dominio · Campaña gobernada derivada de una decisión (Bloque C).
 *
 * Una campaña NO puede ser huérfana: siempre referencia una `decisionId` de
 * `@soec/decisiones-mkt`, de la MISMA organización, y solo nace de una decisión ejecutable
 * (APROBADA) o de un flujo explícitamente permitido por política. No es un simple contenedor
 * de publicaciones: conserva objetivo, público, hipótesis, presupuesto, criterios de éxito y
 * de pausa, nivel de autonomía y aprobaciones. Event-sourced (`campania:<org>:<id>`).
 */
import type { RecordedEvent } from '@soec/contracts';

export type EstadoCampania = 'BORRADOR' | 'ACTIVA' | 'PAUSADA' | 'COMPLETADA' | 'CANCELADA';

export interface Presupuesto {
  readonly monto: number;
  readonly moneda: string;
}

/** Política que gobierna cómo puede nacer una campaña (definida por el usuario). */
export interface PoliticaCampania {
  readonly requiereAprobacion: boolean;
  readonly presupuestoMaximo: number;
  /** Permite campañas operativas no experimentales (sin hipótesis). Por defecto false. */
  readonly permiteNoExperimental: boolean;
}
export const POLITICA_CAMPANIA_CONSERVADORA: PoliticaCampania = {
  requiereAprobacion: true,
  presupuestoMaximo: Number.POSITIVE_INFINITY,
  permiteNoExperimental: false,
};

export interface Campania {
  readonly campaniaId: string;
  readonly organizacionId: string;
  readonly decisionId: string;
  readonly objetivo: string;
  readonly publico: string;
  readonly propuesta: string;
  readonly mensaje: string;
  readonly canal: string;
  readonly contenidoRequerido: readonly string[];
  readonly calendario: string;
  readonly presupuesto: Presupuesto;
  readonly hipotesis: readonly string[];
  readonly metricas: readonly string[];
  readonly criterioExito: string;
  readonly criterioPausa: string;
  readonly nivelAutonomia: number;
  readonly aprobaciones: readonly string[];
  readonly riesgos: readonly string[];
  readonly estado: EstadoCampania;
  readonly autor: string;
  readonly en: string;
  readonly version: number;
  readonly existe: boolean;
}

const TRANSICIONES: Readonly<Record<EstadoCampania, readonly EstadoCampania[]>> = {
  BORRADOR: ['ACTIVA', 'CANCELADA'],
  ACTIVA: ['PAUSADA', 'COMPLETADA', 'CANCELADA'],
  PAUSADA: ['ACTIVA', 'CANCELADA'],
  COMPLETADA: [],
  CANCELADA: [],
};
export function transicionCampaniaValida(desde: EstadoCampania, hacia: EstadoCampania): boolean {
  return TRANSICIONES[desde].includes(hacia);
}

export const EVENTOS_CAMPANIA = { creada: 'campania.creada', transicionada: 'campania.transicionada' } as const;

export function campaniaStreamId(organizacionId: string, campaniaId: string): string {
  return `campania:${organizacionId}:${campaniaId}`;
}

export function estadoInicialCampania(organizacionId: string, campaniaId: string): Campania {
  return {
    campaniaId,
    organizacionId,
    decisionId: '',
    objetivo: '',
    publico: '',
    propuesta: '',
    mensaje: '',
    canal: '',
    contenidoRequerido: [],
    calendario: '',
    presupuesto: { monto: 0, moneda: 'CLP' },
    hipotesis: [],
    metricas: [],
    criterioExito: '',
    criterioPausa: '',
    nivelAutonomia: 0,
    aprobaciones: [],
    riesgos: [],
    estado: 'BORRADOR',
    autor: '',
    en: '',
    version: 0,
    existe: false,
  };
}

export function aplicarCampania(state: Campania, event: RecordedEvent): Campania {
  const next = { ...state, version: state.version + 1, existe: true };
  switch (event.type) {
    case EVENTOS_CAMPANIA.creada:
      return { ...next, ...(event.payload as Omit<Campania, 'autor' | 'en' | 'version' | 'existe'>), autor: String(event.actor), en: event.recordedAt };
    case EVENTOS_CAMPANIA.transicionada:
      return { ...next, estado: (event.payload as { estado: EstadoCampania }).estado };
    default:
      return next;
  }
}

export function reconstruirCampania(organizacionId: string, campaniaId: string, events: readonly RecordedEvent[]): Campania {
  return events.reduce(aplicarCampania, estadoInicialCampania(organizacionId, campaniaId));
}
