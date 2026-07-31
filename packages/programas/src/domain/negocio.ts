/**
 * @soec/programas · dominio · Negocio (perfil comercial configurable por organización).
 *
 * Agregado nuevo que da identidad y contexto comercial a una organización piloto, para que el
 * ciclo autónomo opere sobre un negocio CONCRETO y no sobre una fixture fija. No reemplaza a
 * `@soec/negocio` (conocimiento/SSOT): registra la configuración del piloto. `modoEjecucion` es
 * siempre `PILOT`: canales reales deshabilitados, gasto real 0, resultados simulados.
 * Event-sourced (`negconf:<org>`).
 */
import type { RecordedEvent } from '@soec/contracts';

export type EstadoNegocio = 'BORRADOR' | 'ACTIVO' | 'ARCHIVADO';
export type ModoEjecucion = 'PILOT';

export interface PerfilComercial {
  readonly problemas: readonly string[];
  readonly propuestaValor: string;
  readonly capacidadesVerificadas: readonly string[];
  readonly restricciones: readonly string[];
  readonly diferenciadores: readonly string[];
  readonly informacionFaltante: readonly string[];
}

export const PERFIL_VACIO: PerfilComercial = {
  problemas: [],
  propuestaValor: '',
  capacidadesVerificadas: [],
  restricciones: [],
  diferenciadores: [],
  informacionFaltante: [],
};

export interface Negocio {
  readonly id: string; // = organizacionId
  readonly nombre: string;
  readonly descripcion: string;
  readonly industria: string;
  readonly pais: string;
  readonly moneda: string;
  readonly zonaHoraria: string;
  readonly estado: EstadoNegocio;
  readonly modoEjecucion: ModoEjecucion;
  readonly perfil: PerfilComercial;
  readonly autor: string;
  readonly en: string;
  readonly version: number;
  readonly existe: boolean;
}

export const EVENTOS_NEGOCIO = { registrado: 'negocio.registrado', perfilActualizado: 'negocio.perfil_actualizado' } as const;

export function negocioStreamId(organizacionId: string): string {
  return `negconf:${organizacionId}`;
}

export function estadoInicialNegocio(organizacionId: string): Negocio {
  return {
    id: organizacionId,
    nombre: '',
    descripcion: '',
    industria: '',
    pais: '',
    moneda: 'CLP',
    zonaHoraria: 'America/Santiago',
    estado: 'BORRADOR',
    modoEjecucion: 'PILOT',
    perfil: PERFIL_VACIO,
    autor: '',
    en: '',
    version: 0,
    existe: false,
  };
}

type PayloadRegistrado = Pick<Negocio, 'nombre' | 'descripcion' | 'industria' | 'pais' | 'moneda' | 'zonaHoraria'>;

export function aplicarNegocio(state: Negocio, event: RecordedEvent): Negocio {
  const next = { ...state, version: state.version + 1, existe: true };
  switch (event.type) {
    case EVENTOS_NEGOCIO.registrado: {
      const p = event.payload as PayloadRegistrado;
      return { ...next, ...p, estado: 'ACTIVO', autor: String(event.actor), en: event.recordedAt };
    }
    case EVENTOS_NEGOCIO.perfilActualizado:
      return { ...next, perfil: event.payload as PerfilComercial };
    default:
      return next;
  }
}

export function reconstruirNegocio(organizacionId: string, events: readonly RecordedEvent[]): Negocio {
  return events.reduce(aplicarNegocio, estadoInicialNegocio(organizacionId));
}
