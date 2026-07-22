/**
 * Adaptación de canal (F2-CONT-01 §4.3, §5.3) — variante específica de la pieza
 * fuente para un canal, sin duplicar la semántica central. Conserva las
 * afirmaciones y advertencias de la pieza (la adaptación no eleva la certeza ni
 * elimina disclaimers esenciales).
 */
import type { Afirmacion } from './afirmacion';
import type { Canal, Formato } from './canales';

export type EstadoAdaptacion = 'pendiente' | 'adaptando' | 'adaptada' | 'validando' | 'bloqueada' | 'lista' | 'utilizada' | 'reemplazada';

export interface Adaptacion {
  readonly id: string;
  readonly canal: Canal;
  readonly formato: Formato;
  readonly version: number;
  readonly titulo: string;
  readonly cuerpo: string;
  readonly descripcion: string;
  readonly altText: string;
  readonly hashtags: readonly string[];
  readonly llamadaAccion: string;
  readonly urlObjetivo: string;
  readonly metadatos: Readonly<Record<string, string>>;
  readonly instruccionesVisuales: string;
  readonly duracionEstimadaSeg: number;
  /** Afirmaciones conservadas desde la pieza fuente (no elevadas). */
  readonly afirmaciones: readonly Afirmacion[];
  /** Advertencias/disclaimers conservados (esenciales, no se eliminan). */
  readonly advertencias: readonly string[];
  readonly activosRequeridos: readonly string[];
  readonly estado: EstadoAdaptacion;
  readonly motivoBloqueo: string | null;
  readonly procedencia: string;
}

const TRANSICIONES_ADAPTACION: Readonly<Record<EstadoAdaptacion, readonly EstadoAdaptacion[]>> = {
  pendiente: ['adaptando'],
  adaptando: ['adaptada', 'bloqueada'],
  adaptada: ['validando', 'bloqueada'],
  validando: ['lista', 'bloqueada'],
  bloqueada: ['adaptando', 'reemplazada'],
  lista: ['utilizada', 'reemplazada'],
  utilizada: ['reemplazada'],
  reemplazada: [],
};

export function transicionAdaptacionValida(desde: EstadoAdaptacion, hacia: EstadoAdaptacion): boolean {
  return (TRANSICIONES_ADAPTACION[desde] ?? []).includes(hacia);
}
