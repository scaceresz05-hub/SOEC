/**
 * @soec/motor-medicion · dominio · OBSERVACIÓN OPERACIONAL (agregado event-sourced, M8).
 *
 * Un HECHO observado a partir de una ejecución de M7 — SIN interpretarlo. No es medición, ni evaluación,
 * ni aprendizaje: solo «esto se observó». Distingue estrictamente lo esperado de lo observado, y la
 * NATURALEZA del dato (SIMULADA/ESTIMADA — NUNCA REAL en M8). La ausencia de valor es `valor: null`,
 * jamás 0. Multi-tenant (el stream lleva la organización). Determinista (instantes inyectados).
 *
 * Estados: REGISTRADA → VALIDADA | INVALIDA · VALIDADA → DESCARTADA | SUPERADA (por una observación posterior).
 */
import type { RecordedEvent } from '@soec/contracts';
import type { NivelCalidad } from '@soec/medicion';

// El DOMINIO reconoce tres naturalezas, pero las RUTAS DE ENTRADA están separadas por tipo (Opción C):
//   - `registrar(...)`   sólo admite `NaturalezaSimulable` (SIMULADA | ESTIMADA) — invariante M8 intacto.
//   - `registrarReal(...)` es la ÚNICA puerta que produce REAL, con procedencia/evidencia externa obligatoria.
// REAL no es «otro valor del enum»: es un régimen epistemológico distinto (procedencia, idempotencia, traza).
export type NaturalezaSimulable = 'SIMULADA' | 'ESTIMADA';
export type NaturalezaDato = NaturalezaSimulable | 'REAL';
export type EstadoObservacion = 'REGISTRADA' | 'VALIDADA' | 'INVALIDA' | 'DESCARTADA' | 'SUPERADA';
export type UnidadObservacion = 'conteo' | 'monetario' | 'segundos' | 'porcentaje' | 'ratio';

/**
 * Procedencia OBLIGATORIA de una observación REAL. Sin esto, un hecho no puede reclamar ser REAL.
 * No contiene PII: identifica el evento externo y su atribución de medición, nunca a la persona.
 */
export interface ProvenanciaReal {
  readonly provider: string;           // p. ej. 'smileflow-growth'
  readonly externalEventId: string;    // id estable del evento en el proveedor (clave natural de idempotencia)
  readonly eventName: string;          // p. ej. 'demo_requested'
  readonly occurredAt: string;         // cuándo ocurrió en el proveedor (ISO)
  readonly ingestedAt: string;         // cuándo lo ingirió SOEC (ISO, inyectado)
  readonly source: string | null;
  readonly utmSource: string | null;
  readonly utmMedium: string | null;
  readonly utmCampaign: string | null;
  readonly utmContent: string | null;
  readonly leadRef: string | null;     // correlación pseudónima (nunca PII)
  readonly diagnostico: boolean;       // true si el evento es reconocible como TEST/DIAG (excluir del aprendizaje)
}

/** Referencia versionada a un artefacto de M6 (no se copia; se referencia por id+versión). */
export interface RefVersion {
  readonly id: string;
  readonly version: number;
}

export interface DatosObservacion {
  readonly ordenId: string;
  readonly executionId: string;
  readonly pieza: RefVersion;
  readonly variante: RefVersion | null;
  readonly hipotesisId: string | null;
  readonly kpiId: string;
  readonly instante: string;
  readonly fuente: string; // p. ej. 'ejecucion-simulada-m7'
  readonly metrica: string; // nombre canónico de la métrica observada
  readonly valor: number | null; // null = AUSENCIA (nunca 0 por defecto)
  readonly unidad: UnidadObservacion;
  readonly naturaleza: NaturalezaDato; // SIMULADA/ESTIMADA — nunca REAL
  readonly calidad: NivelCalidad;
  readonly cobertura: number; // [0,1]
  readonly limitaciones: readonly string[];
  readonly evidenciaOperacionalRef: string | null; // referencia a la evidencia de M7 (no su contenido)
  readonly provenanciaReal?: ProvenanciaReal | null; // presente SÓLO en observaciones REAL (naturaleza='REAL')
}

export interface ObservacionState {
  readonly organizacionId: string;
  readonly observacionId: string;
  readonly version: number;
  readonly existe: boolean;
  readonly estado: EstadoObservacion;
  readonly datos: DatosObservacion | null;
  readonly motivo: string | null;
  readonly supersedidaPor: string | null;
}

export const EVENTOS_OBSERVACION = {
  registrada: 'observacion.registrada',
  registradaReal: 'observacion.registrada-real', // puerta REAL gobernada (Opción C): nace VALIDADA por procedencia externa
  validada: 'observacion.validada',
  invalidada: 'observacion.invalidada',
  descartada: 'observacion.descartada',
  superada: 'observacion.superada',
  diagnosticoReconciliado: 'observacion.diagnostico-reconciliado', // reconciliación convergente de is_test desde la fuente estructural
} as const;

export function observacionStreamId(organizacionId: string, observacionId: string): string {
  return `observacion:${organizacionId}:${observacionId}`;
}

const TRANSICIONES: Readonly<Record<EstadoObservacion, readonly EstadoObservacion[]>> = {
  REGISTRADA: ['VALIDADA', 'INVALIDA', 'DESCARTADA'],
  VALIDADA: ['DESCARTADA', 'SUPERADA'],
  INVALIDA: [],
  DESCARTADA: [],
  SUPERADA: [],
};

export function transicionObservacionValida(desde: EstadoObservacion, hacia: EstadoObservacion): boolean {
  return (TRANSICIONES[desde] ?? []).includes(hacia);
}

export function estadoInicialObservacion(organizacionId: string, observacionId: string): ObservacionState {
  return { organizacionId, observacionId, version: 0, existe: false, estado: 'REGISTRADA', datos: null, motivo: null, supersedidaPor: null };
}

export function aplicarObservacion(state: ObservacionState, event: RecordedEvent): ObservacionState {
  const next = { ...state, version: state.version + 1 };
  switch (event.type) {
    case EVENTOS_OBSERVACION.registrada: {
      if (state.existe) return next; // idempotente por id determinista
      return { ...next, existe: true, estado: 'REGISTRADA', datos: event.payload as DatosObservacion };
    }
    case EVENTOS_OBSERVACION.registradaReal: {
      // Puerta REAL gobernada: una observación REAL nace ya VALIDADA porque su autoridad es la PROCEDENCIA
      // externa obligatoria (no la confrontación contra M7). Idempotente por id determinista (provider+extId).
      if (state.existe) return next;
      return { ...next, existe: true, estado: 'VALIDADA', datos: event.payload as DatosObservacion };
    }
    case EVENTOS_OBSERVACION.validada: {
      if (!transicionObservacionValida(state.estado, 'VALIDADA')) return next;
      // Materializa el contexto AUTORITATIVO de M7 (pieza/variante/executionId/evidenciaRef) sobre el hecho.
      const ctx = (event.payload as { contexto?: Partial<DatosObservacion> }).contexto;
      const datos = state.datos && ctx ? { ...state.datos, ...ctx } : state.datos;
      return { ...next, estado: 'VALIDADA', datos };
    }
    case EVENTOS_OBSERVACION.invalidada:
      if (!transicionObservacionValida(state.estado, 'INVALIDA')) return next;
      return { ...next, estado: 'INVALIDA', motivo: (event.payload as { motivo?: string }).motivo ?? null };
    case EVENTOS_OBSERVACION.descartada:
      if (!transicionObservacionValida(state.estado, 'DESCARTADA')) return next;
      return { ...next, estado: 'DESCARTADA', motivo: (event.payload as { motivo?: string }).motivo ?? null };
    case EVENTOS_OBSERVACION.superada:
      if (!transicionObservacionValida(state.estado, 'SUPERADA')) return next;
      return { ...next, estado: 'SUPERADA', supersedidaPor: (event.payload as { por?: string }).por ?? null };
    case EVENTOS_OBSERVACION.diagnosticoReconciliado: {
      // Reconciliación CONVERGENTE: actualiza SÓLO `provenanciaReal.diagnostico` desde la fuente estructural
      // (is_test del proveedor). NO cambia estado, naturaleza, valor ni ningún otro contenido. No-op si la
      // observación no es REAL o no tiene procedencia (fail-closed). Preserva la historia (append-only).
      if (!state.existe || !state.datos || !state.datos.provenanciaReal) return next;
      const nd = (event.payload as { diagnostico?: boolean }).diagnostico;
      if (typeof nd !== 'boolean') return next;
      return { ...next, datos: { ...state.datos, provenanciaReal: { ...state.datos.provenanciaReal, diagnostico: nd } } };
    }
    default:
      return next;
  }
}

export function reconstruirObservacion(organizacionId: string, observacionId: string, events: readonly RecordedEvent[]): ObservacionState {
  return events.reduce(aplicarObservacion, estadoInicialObservacion(organizacionId, observacionId));
}

/** ¿La observación cuenta como evidencia MEDIBLE (validada y con valor presente)? Ausencia ⇒ no medible. */
export function observacionMedible(st: ObservacionState): boolean {
  return st.existe && st.estado === 'VALIDADA' && st.datos !== null && st.datos.valor !== null;
}
