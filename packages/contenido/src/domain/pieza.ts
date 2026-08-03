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

/** Formatos creativos NEUTRALES (M6): intención/estructura, sin adaptar aún a canal/SDK. */
export type FormatoPieza =
  | 'publicacion_social'
  | 'carrusel'
  | 'video_corto'
  | 'articulo'
  | 'email'
  | 'anuncio'
  | 'landing'
  | 'guion'
  | 'pieza_educativa';

/** Traza epistémica AUTORITATIVA de una afirmación usada en la pieza (M6): rastreable hasta M5. */
export interface TrazaAfirmacion {
  readonly afirmacionId: string;
  readonly version: number;
  readonly estado: string; // EstadoEvaluabilidad de M5 (tipado por el productor M6)
  readonly sentido: string; // A_FAVOR / EN_CONTRA
  readonly vigencia: 'VIGENTE' | 'OBSOLETO';
  readonly proposito: string; // para qué se usa la afirmación
  readonly mensajeId: string; // dónde aparece
}

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
  // ── M6 · gobernanza creativa (ampliación ADITIVA; opcional) ──
  readonly formato?: FormatoPieza;
  readonly objetivo?: string;
  readonly segmento?: string;
  readonly briefId?: string;
  readonly territorioId?: string;
  readonly estrategiaCreativaId?: string;
  readonly mensajesUtilizados?: readonly string[];
  /** Referencias VERSIONADAS a afirmaciones de M5 (base de obsolescencia). */
  readonly referenciasM5?: readonly { readonly afirmacionId: string; readonly version: number }[];
  readonly resultadoValidacion?: 'VALIDO' | 'INVALIDO' | 'REQUIERE_REVISION';
  readonly versionConocimiento?: number;
  readonly naturaleza?: 'SIMULADO';
  /** Traza autoritativa: cada afirmación usada, rastreable hasta M5. */
  readonly trazabilidad?: readonly TrazaAfirmacion[];
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
