/**
 * Activos (F2-CONT-01 §4.4, §12) — elementos utilizables por una publicación. En
 * este bloque los activos visuales son ESPECIFICACIONES estructuradas verificables
 * (brief visual, storyboard, guion), no imágenes o videos finales de un proveedor
 * externo. El modelo queda preparado para archivos reales en un bloque futuro.
 */
import type { TipoActivo } from './canales';

/** Especificación de imagen (no la imagen final). */
export interface EspecificacionImagen {
  readonly relacionAspecto: string;
  readonly composicion: string;
  readonly elementos: readonly string[];
  readonly textosIncorporados: readonly string[];
  readonly usoLogotipo: string;
  readonly referenciasMarca: readonly string[];
  readonly instrucciones: string;
  readonly altText: string;
}

/** Escena de un storyboard para video/reel. */
export interface Escena {
  readonly orden: number;
  readonly descripcion: string;
  readonly duracionSeg: number;
  readonly locucion: string;
  readonly subtitulo: string;
}

export interface GuionVisual {
  readonly relacionAspecto: string;
  readonly duracionTotalSeg: number;
  readonly escenas: readonly Escena[];
  readonly musicaReferencia: string;
}

export interface Activo {
  readonly id: string;
  readonly tipo: TipoActivo;
  readonly descripcion: string;
  /** Contenido textual (para activos de texto) o vacío. */
  readonly texto: string;
  /** Especificación de imagen si aplica. */
  readonly imagen: EspecificacionImagen | null;
  /** Guion visual (video/reel/carrusel) si aplica. */
  readonly guion: GuionVisual | null;
  readonly altText: string;
  /** Procedencia: nunca un activo sin origen declarado. */
  readonly procedencia: string;
}
