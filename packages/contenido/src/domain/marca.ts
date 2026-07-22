/**
 * Identidad de marca (F2-CONT-01 §7) — fuente de verdad VERSIONADA que la fábrica
 * consume para producir contenido coherente. No es un editor visual: es el contrato
 * de marca (tono, vocabulario, mensajes obligatorios, disclaimers, colores/tipos
 * como referencias estructuradas) que gobierna toda pieza y adaptación.
 * Event-sourced; una pieza histórica conserva la versión exacta que la produjo.
 */
import type { Attribution, RecordedEvent } from '@soec/contracts';

/** Referencia estructurada a un color (no se renderiza aquí; es dato de marca). */
export interface ReferenciaColor {
  readonly nombre: string;
  readonly hex: string;
  readonly uso: string;
}
export interface ReferenciaTipografia {
  readonly nombre: string;
  readonly uso: string;
}

export interface ContenidoMarca {
  readonly nombre: string;
  readonly descripcion: string;
  readonly proposito: string;
  readonly personalidad: readonly string[];
  readonly tono: string;
  readonly vocabularioPreferido: readonly string[];
  readonly expresionesProhibidas: readonly string[];
  readonly publico: string;
  readonly propuestaValor: string;
  readonly diferenciadores: readonly string[];
  readonly colores: readonly ReferenciaColor[];
  readonly tipografias: readonly ReferenciaTipografia[];
  readonly estiloVisual: string;
  readonly estiloFotografico: string;
  readonly estiloIlustracion: string;
  readonly usoLogotipo: string;
  readonly mensajesObligatorios: readonly string[];
  readonly disclaimers: readonly string[];
  readonly territorios: readonly string[];
  readonly idiomas: readonly string[];
}

export interface VersionMarca extends ContenidoMarca {
  readonly version: number;
  readonly vigenciaDesde: string;
  readonly atribucion: Attribution;
}

export const EVENTOS_MARCA = {
  registrada: 'marca.version_registrada',
  publicada: 'marca.version_publicada',
} as const;

export function marcaStreamId(marcaId: string): string {
  return `marca:${marcaId}`;
}

export interface MarcaState {
  readonly marcaId: string;
  readonly organizationId: string;
  readonly version: number;
  readonly existe: boolean;
  readonly versiones: Readonly<Record<number, VersionMarca>>;
  readonly vigente: number | null;
}

export function estadoInicialMarca(marcaId: string, organizationId: string): MarcaState {
  return { marcaId, organizationId, version: 0, existe: false, versiones: {}, vigente: null };
}

interface PayloadRegistrada {
  version: VersionMarca;
}
interface PayloadVersion {
  version: number;
}

export function aplicarMarca(state: MarcaState, event: RecordedEvent): MarcaState {
  const next = { ...state, version: state.version + 1 };
  switch (event.type) {
    case EVENTOS_MARCA.registrada: {
      const p = event.payload as PayloadRegistrada;
      return { ...next, existe: true, versiones: { ...state.versiones, [p.version.version]: p.version } };
    }
    case EVENTOS_MARCA.publicada: {
      const p = event.payload as PayloadVersion;
      return { ...next, vigente: p.version };
    }
    default:
      return next;
  }
}

export function reconstruirMarca(marcaId: string, organizationId: string, events: readonly RecordedEvent[]): MarcaState {
  return events.reduce(aplicarMarca, estadoInicialMarca(marcaId, organizationId));
}

export function versionVigenteMarca(state: MarcaState): VersionMarca | null {
  if (!state.existe || state.vigente === null) return null;
  return state.versiones[state.vigente] ?? null;
}
