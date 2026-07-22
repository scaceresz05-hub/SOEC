/**
 * Pieza fuente (F2-CONT-01 §4.2) — el contenido semántico principal antes de
 * adaptarlo a un canal. Conserva tesis, estructura, mensaje, cuerpo, CTA, hechos,
 * afirmaciones (con procedencia), supuestos, advertencias, idioma, versión,
 * procedencia y estado editorial. Una misma pieza origina varias adaptaciones.
 */
import type { Afirmacion } from './afirmacion';

export type EstadoPieza =
  | 'propuesta'
  | 'generando'
  | 'generada'
  | 'en_validacion'
  | 'rechazada'
  | 'revisable'
  | 'valida'
  | 'reemplazada'
  | 'archivada';

export interface PiezaFuente {
  readonly version: number;
  readonly tituloInterno: string;
  readonly tesis: string;
  readonly estructura: readonly string[];
  readonly mensaje: string;
  readonly cuerpo: string;
  readonly llamadaAccion: string;
  readonly hechosUtilizados: readonly string[];
  readonly afirmaciones: readonly Afirmacion[];
  readonly referencias: readonly string[];
  readonly supuestos: readonly string[];
  readonly advertencias: readonly string[];
  readonly idioma: string;
  /** Procedencia: qué versión de prompt/proveedor la produjo. */
  readonly procedencia: string;
  readonly estado: EstadoPieza;
}

const TRANSICIONES_PIEZA: Readonly<Record<EstadoPieza, readonly EstadoPieza[]>> = {
  propuesta: ['generando', 'archivada'],
  generando: ['generada', 'rechazada'],
  generada: ['en_validacion', 'archivada'],
  en_validacion: ['valida', 'revisable', 'rechazada'],
  revisable: ['generando', 'rechazada', 'archivada'],
  valida: ['reemplazada', 'archivada'],
  rechazada: ['revisable', 'archivada'],
  reemplazada: [],
  archivada: [],
};

export function transicionPiezaValida(desde: EstadoPieza, hacia: EstadoPieza): boolean {
  return (TRANSICIONES_PIEZA[desde] ?? []).includes(hacia);
}
