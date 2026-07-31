/**
 * @soec/crm-comercial · dominio · Agregado CONTACTO (persona/lead individual).
 *
 * Es el hueco real del "CRM inteligente": no existía ninguna entidad de contacto individual. Cada
 * contacto vive en su stream `crm:<org>:<contactoId>` (aislado por organización) y acumula su
 * historial de ACTIVIDAD (hechos con tiempo del mundo) y ATRIBUTOS (con su origen epistémico). El
 * scoring y las recomendaciones se derivan de este estado, nunca se inventan.
 */
import type { RecordedEvent } from '@soec/contracts';
import type { TipoEvidencia } from '@soec/negocio';

/** Tipos de actividad observable de un contacto. COMPRA/RESPUESTA_* son hechos; VISITA una señal. */
export type ActividadTipo =
  | 'VISITA'
  | 'CONSULTA'
  | 'COMPRA'
  | 'RESPUESTA_POSITIVA'
  | 'RESPUESTA_NEGATIVA'
  | 'NO_ASISTIO'
  | 'CONTACTO_SALIENTE';

export interface Actividad {
  readonly actividadId: string;
  readonly tipo: ActividadTipo;
  readonly detalle: string;
  /** Tiempo del mundo (cuándo ocurrió), base de la recencia. */
  readonly en: string;
  /** Monto asociado (p. ej. de una COMPRA), si aplica. */
  readonly valor: number | null;
  /** Origen epistémico de la observación (H-4: la confianza del scoring deriva de aquí). */
  readonly origen: TipoEvidencia;
}

/** Origen por defecto de una actividad observada (un hecho registrado por el sistema). */
export function origenPorDefecto(_tipo: ActividadTipo): TipoEvidencia {
  return 'HECHO_VERIFICADO';
}

export interface AtributoContacto {
  readonly valor: string;
  readonly origen: TipoEvidencia;
}

export interface ContactoState {
  readonly organizacionId: string;
  readonly contactoId: string;
  readonly version: number;
  readonly existe: boolean;
  readonly nombre: string;
  readonly email: string | null;
  readonly telefono: string | null;
  readonly actividades: readonly Actividad[];
  readonly atributos: Readonly<Record<string, AtributoContacto>>;
  readonly creadoEn: string | null;
  readonly ultimaActividadEn: string | null;
}

export const EVENTOS_CONTACTO = {
  registrado: 'crm.contacto_registrado',
  actividad: 'crm.actividad_registrada',
  atributo: 'crm.atributo_registrado',
} as const;

export function contactoStreamId(organizacionId: string, contactoId: string): string {
  return `crm:${organizacionId}:${contactoId}`;
}

export function estadoInicialContacto(organizacionId: string, contactoId: string): ContactoState {
  return {
    organizacionId,
    contactoId,
    version: 0,
    existe: false,
    nombre: '',
    email: null,
    telefono: null,
    actividades: [],
    atributos: {},
    creadoEn: null,
    ultimaActividadEn: null,
  };
}

interface PRegistrado {
  nombre: string;
  email: string | null;
  telefono: string | null;
  origen: TipoEvidencia;
}
interface PActividad {
  actividadId: string;
  tipo: ActividadTipo;
  detalle: string;
  valor: number | null;
  origen?: TipoEvidencia;
}
interface PAtributo {
  clave: string;
  valor: string;
  origen: TipoEvidencia;
}

function masReciente(a: string | null, b: string): string {
  return a && Date.parse(a) >= Date.parse(b) ? a : b;
}

export function aplicarContacto(state: ContactoState, event: RecordedEvent): ContactoState {
  const next = { ...state, version: state.version + 1 };
  switch (event.type) {
    case EVENTOS_CONTACTO.registrado: {
      const p = event.payload as PRegistrado;
      return { ...next, existe: true, nombre: p.nombre, email: p.email, telefono: p.telefono, creadoEn: state.creadoEn ?? event.recordedAt };
    }
    case EVENTOS_CONTACTO.actividad: {
      const p = event.payload as PActividad;
      const act: Actividad = { actividadId: p.actividadId, tipo: p.tipo, detalle: p.detalle, en: event.occurredAt, valor: p.valor, origen: p.origen ?? origenPorDefecto(p.tipo) };
      return { ...next, actividades: [...state.actividades, act], ultimaActividadEn: masReciente(state.ultimaActividadEn, event.occurredAt) };
    }
    case EVENTOS_CONTACTO.atributo: {
      const p = event.payload as PAtributo;
      return { ...next, atributos: { ...state.atributos, [p.clave]: { valor: p.valor, origen: p.origen } } };
    }
    default:
      return next;
  }
}

export function reconstruirContacto(organizacionId: string, contactoId: string, events: readonly RecordedEvent[]): ContactoState {
  return events.reduce(aplicarContacto, estadoInicialContacto(organizacionId, contactoId));
}
