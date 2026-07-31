/**
 * @soec/programas · dominio · Programa de marketing (estructura configurable por negocio).
 *
 * Agregado que porta la FORMA del programa —objetivos, presupuesto simulado, segmentos, hipótesis
 * y las campañas vinculadas— sin re-modelar las campañas/contenidos/decisiones (esos son agregados
 * A–J, referenciados por id). Ids scopeados por programa (evita la colisión de ids fijos del demo).
 * Todo presupuesto es SIMULADO. Event-sourced (`programa:<org>:<programaId>`).
 */
import type { RecordedEvent } from '@soec/contracts';

export type EstadoPrograma = 'BORRADOR' | 'LISTO' | 'EN_EJECUCION' | 'EVALUADO';

export interface Segmento {
  readonly id: string;
  readonly nombre: string;
  readonly descripcion: string;
  readonly problemas: readonly string[];
  readonly necesidades: readonly string[];
  readonly criterios: readonly string[];
  readonly prioridad: number;
}

export interface Hipotesis {
  readonly id: string;
  readonly segmentoId: string;
  readonly problema: string;
  readonly propuesta: string;
  readonly mensaje: string;
  readonly canalSimulado: string;
  readonly accionEsperada: string;
  readonly evidencia: readonly string[];
  readonly informacionFaltante: readonly string[];
  readonly confianza: 'BAJA' | 'MEDIA' | 'ALTA';
  readonly estado: 'ABIERTA' | 'EN_PRUEBA' | 'RETENIDA' | 'DESCARTADA';
  readonly criterioContinuacion: string;
}

/** Referencia a una campaña (agregado A–J) vinculada al programa, con su presupuesto simulado. */
export interface CampaniaRef {
  readonly campaignId: string;
  readonly segmentoId: string;
  readonly hipotesisId: string;
  readonly decisionId: string;
  readonly presupuestoSimulado: number;
  readonly duracionHipotetica: string;
  readonly contenidoIds: readonly string[];
}

export interface Programa {
  readonly id: string;
  readonly organizacionId: string;
  readonly nombre: string;
  readonly objetivoPrincipal: string;
  readonly objetivosSecundarios: readonly string[];
  readonly estado: EstadoPrograma;
  readonly presupuestoTotalSimulado: number;
  readonly moneda: string;
  readonly fechaInicioHipotetica: string;
  readonly fechaFinHipotetica: string;
  readonly segmentos: readonly Segmento[];
  readonly hipotesis: readonly Hipotesis[];
  readonly campanias: readonly CampaniaRef[];
  readonly autor: string;
  readonly en: string;
  readonly version: number;
  readonly existe: boolean;
}

export const EVENTOS_PROGRAMA = {
  creado: 'programa.creado',
  segmentoAgregado: 'programa.segmento_agregado',
  hipotesisAgregada: 'programa.hipotesis_agregada',
  campaniaVinculada: 'programa.campania_vinculada',
  contenidoVinculado: 'programa.contenido_vinculado',
  transicionado: 'programa.transicionado',
} as const;

export function programaStreamId(organizacionId: string, programaId: string): string {
  return `programa:${organizacionId}:${programaId}`;
}

/** Presupuesto simulado ya comprometido por las campañas del programa. */
export function presupuestoComprometido(p: Programa): number {
  return p.campanias.reduce((s, c) => s + c.presupuestoSimulado, 0);
}

/** Un programa es EJECUTABLE si tiene ≥1 campaña, cada una con decisión y ≥1 contenido, y el
 *  presupuesto comprometido no excede el total. Sin esto, el ciclo no puede correr. */
export function programaEjecutable(p: Programa): { ok: boolean; motivo: string } {
  if (p.campanias.length === 0) return { ok: false, motivo: 'el programa no tiene campañas' };
  for (const c of p.campanias) {
    if (!c.decisionId) return { ok: false, motivo: `la campaña ${c.campaignId} no tiene decisión` };
    if (c.contenidoIds.length === 0) return { ok: false, motivo: `la campaña ${c.campaignId} no tiene contenido` };
  }
  if (presupuestoComprometido(p) > p.presupuestoTotalSimulado) {
    return { ok: false, motivo: 'el presupuesto comprometido excede el total del programa' };
  }
  return { ok: true, motivo: 'programa completo' };
}

export function estadoInicialPrograma(organizacionId: string, programaId: string): Programa {
  return {
    id: programaId,
    organizacionId,
    nombre: '',
    objetivoPrincipal: '',
    objetivosSecundarios: [],
    estado: 'BORRADOR',
    presupuestoTotalSimulado: 0,
    moneda: 'CLP',
    fechaInicioHipotetica: '',
    fechaFinHipotetica: '',
    segmentos: [],
    hipotesis: [],
    campanias: [],
    autor: '',
    en: '',
    version: 0,
    existe: false,
  };
}

type PayloadCreado = Pick<Programa, 'nombre' | 'objetivoPrincipal' | 'objetivosSecundarios' | 'presupuestoTotalSimulado' | 'moneda' | 'fechaInicioHipotetica' | 'fechaFinHipotetica'>;

export function aplicarPrograma(state: Programa, event: RecordedEvent): Programa {
  const next = { ...state, version: state.version + 1, existe: true };
  switch (event.type) {
    case EVENTOS_PROGRAMA.creado: {
      const p = event.payload as PayloadCreado;
      return { ...next, ...p, autor: String(event.actor), en: event.recordedAt };
    }
    case EVENTOS_PROGRAMA.segmentoAgregado:
      return { ...next, segmentos: [...state.segmentos, event.payload as Segmento] };
    case EVENTOS_PROGRAMA.hipotesisAgregada:
      return { ...next, hipotesis: [...state.hipotesis, event.payload as Hipotesis] };
    case EVENTOS_PROGRAMA.campaniaVinculada:
      return { ...next, campanias: [...state.campanias, event.payload as CampaniaRef] };
    case EVENTOS_PROGRAMA.contenidoVinculado: {
      const p = event.payload as { campaignId: string; contenidoId: string };
      return {
        ...next,
        campanias: state.campanias.map((c) =>
          c.campaignId === p.campaignId ? { ...c, contenidoIds: [...c.contenidoIds, p.contenidoId] } : c,
        ),
      };
    }
    case EVENTOS_PROGRAMA.transicionado:
      return { ...next, estado: (event.payload as { estado: EstadoPrograma }).estado };
    default:
      return next;
  }
}

export function reconstruirPrograma(organizacionId: string, programaId: string, events: readonly RecordedEvent[]): Programa {
  return events.reduce(aplicarPrograma, estadoInicialPrograma(organizacionId, programaId));
}
