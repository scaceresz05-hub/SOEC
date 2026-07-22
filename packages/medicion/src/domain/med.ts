/**
 * Agregado de medición de una publicación (F2-MET-01 §28). Acumula métricas
 * normalizadas (respetando correcciones por secuencia del proveedor), calidad,
 * indicadores, atribución, anomalías y la última evaluación. Reevaluable con datos
 * tardíos sin duplicar. Append-only; reconstrucción idéntica.
 */
import type { RecordedEvent } from '@soec/contracts';
import type { Anomalia } from './anomaly';
import type { Atribucion } from './attribution';
import type { Evaluacion } from './evaluation';
import type { Indicador } from './indicator';
import type { NivelCalidad } from './quality';
import type { MetricaCanonica } from './vocabulary';
import type { MetricaNormalizada } from './metrics';

export const EVENTOS_MED = {
  sincronizado: 'med.sincronizado',
  evaluado: 'med.evaluado',
} as const;

export function medStreamId(publicationId: string): string {
  return `med:${publicationId}`;
}

export interface ValorMetrica {
  readonly valor: number;
  readonly proveedorSeq: number;
  readonly estimada: boolean;
}

export interface MedState {
  readonly publicationId: string;
  readonly organizationId: string;
  readonly version: number;
  readonly existe: boolean;
  readonly campaniaRef: string;
  readonly objetivoRef: string;
  readonly metricas: Readonly<Partial<Record<MetricaCanonica, ValorMetrica>>>;
  readonly observacionesTotales: number;
  readonly duplicadosDescartados: number;
  readonly correcciones: number;
  readonly calidad: NivelCalidad;
  readonly indicadores: readonly Indicador[];
  readonly atribucion: Atribucion | null;
  readonly anomalias: readonly Anomalia[];
  readonly evaluacion: Evaluacion | null;
  readonly sincronizaciones: number;
}

export function estadoInicialMed(publicationId: string, organizationId: string): MedState {
  return {
    publicationId,
    organizationId,
    version: 0,
    existe: false,
    campaniaRef: '',
    objetivoRef: '',
    metricas: {},
    observacionesTotales: 0,
    duplicadosDescartados: 0,
    correcciones: 0,
    calidad: 'no_disponible',
    indicadores: [],
    atribucion: null,
    anomalias: [],
    evaluacion: null,
    sincronizaciones: 0,
  };
}

export interface PayloadSincronizado {
  campaniaRef: string;
  objetivoRef: string;
  metricas: MetricaNormalizada[];
  observaciones: number;
  duplicadosDescartados: number;
  correcciones: number;
  calidad: NivelCalidad;
}
export interface PayloadEvaluado {
  indicadores: Indicador[];
  atribucion: Atribucion | null;
  anomalias: Anomalia[];
  evaluacion: Evaluacion | null;
}

function fusionarMetricas(actuales: MedState['metricas'], entrantes: readonly MetricaNormalizada[]): { metricas: MedState['metricas']; correcciones: number } {
  const out: Partial<Record<MetricaCanonica, ValorMetrica>> = { ...actuales };
  let correcciones = 0;
  for (const m of entrantes) {
    const prev = out[m.metrica];
    // Corrección: se sobrescribe un valor previo con una secuencia del proveedor mayor.
    if (!prev) {
      out[m.metrica] = { valor: m.valor, proveedorSeq: m.proveedorSeq, estimada: m.estimada };
    } else if (m.proveedorSeq > prev.proveedorSeq) {
      out[m.metrica] = { valor: m.valor, proveedorSeq: m.proveedorSeq, estimada: m.estimada };
      if (m.valor !== prev.valor) correcciones += 1;
    }
  }
  return { metricas: out, correcciones };
}

export function aplicarMed(state: MedState, event: RecordedEvent): MedState {
  const next = { ...state, version: state.version + 1 };
  switch (event.type) {
    case EVENTOS_MED.sincronizado: {
      const p = event.payload as PayloadSincronizado;
      const fus = fusionarMetricas(state.metricas, p.metricas);
      return {
        ...next,
        existe: true,
        campaniaRef: p.campaniaRef || state.campaniaRef,
        objetivoRef: p.objetivoRef || state.objetivoRef,
        metricas: fus.metricas,
        observacionesTotales: state.observacionesTotales + p.observaciones,
        duplicadosDescartados: state.duplicadosDescartados + p.duplicadosDescartados,
        correcciones: state.correcciones + p.correcciones + fus.correcciones,
        calidad: p.calidad,
        sincronizaciones: state.sincronizaciones + 1,
      };
    }
    case EVENTOS_MED.evaluado: {
      const p = event.payload as PayloadEvaluado;
      return { ...next, indicadores: p.indicadores, atribucion: p.atribucion, anomalias: p.anomalias, evaluacion: p.evaluacion };
    }
    default:
      return next;
  }
}

export function reconstruirMed(publicationId: string, organizationId: string, events: readonly RecordedEvent[]): MedState {
  return events.reduce(aplicarMed, estadoInicialMed(publicationId, organizationId));
}

/** Métricas como mapa simple metrica→valor (para indicadores/anomalías). */
export function valoresDe(state: MedState): Partial<Record<MetricaCanonica, number>> {
  const out: Partial<Record<MetricaCanonica, number>> = {};
  for (const [k, v] of Object.entries(state.metricas)) out[k as MetricaCanonica] = v?.valor ?? 0;
  return out;
}
