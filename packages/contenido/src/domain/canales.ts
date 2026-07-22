/**
 * Perfiles de canal (F2-CONT-01 §11) — descripción ABSTRACTA de cada canal, sin
 * conexión real ni SDK. Definen formatos, límites, campos requeridos, tipos de
 * activo, reglas de llamada a la acción y validaciones. Una pieza fuente se
 * convierte en varias adaptaciones sin duplicar su semántica central.
 */

export type Canal = 'blog' | 'instagram' | 'facebook' | 'linkedin' | 'meta_ads' | 'correo';

export type Formato =
  | 'articulo'
  | 'post_social'
  | 'carrusel'
  | 'reel'
  | 'anuncio'
  | 'correo'
  | 'landing';

export type TipoActivo = 'texto' | 'imagen' | 'video' | 'audio' | 'miniatura' | 'carrusel' | 'documento';

export interface PerfilCanal {
  readonly canal: Canal;
  readonly formatos: readonly Formato[];
  readonly formatoPorDefecto: Formato;
  /** Límite de caracteres del cuerpo (0 = sin límite práctico). */
  readonly limiteCuerpo: number;
  readonly limiteTitulo: number;
  readonly requiereTitulo: boolean;
  readonly requiereCta: boolean;
  readonly requiereAltText: boolean;
  readonly permiteHashtags: boolean;
  readonly maxHashtags: number;
  readonly activosSoportados: readonly TipoActivo[];
  readonly esPagado: boolean;
}

const PERFILES: Readonly<Record<Canal, PerfilCanal>> = {
  blog: {
    canal: 'blog',
    formatos: ['articulo', 'landing'],
    formatoPorDefecto: 'articulo',
    limiteCuerpo: 0,
    limiteTitulo: 70,
    requiereTitulo: true,
    requiereCta: true,
    requiereAltText: true,
    permiteHashtags: false,
    maxHashtags: 0,
    activosSoportados: ['texto', 'imagen', 'miniatura'],
    esPagado: false,
  },
  instagram: {
    canal: 'instagram',
    formatos: ['post_social', 'carrusel', 'reel'],
    formatoPorDefecto: 'post_social',
    limiteCuerpo: 2200,
    limiteTitulo: 0,
    requiereTitulo: false,
    requiereCta: true,
    requiereAltText: true,
    permiteHashtags: true,
    maxHashtags: 30,
    activosSoportados: ['imagen', 'carrusel', 'video', 'miniatura'],
    esPagado: false,
  },
  facebook: {
    canal: 'facebook',
    formatos: ['post_social'],
    formatoPorDefecto: 'post_social',
    limiteCuerpo: 63206,
    limiteTitulo: 0,
    requiereTitulo: false,
    requiereCta: true,
    requiereAltText: true,
    permiteHashtags: true,
    maxHashtags: 10,
    activosSoportados: ['imagen', 'video', 'miniatura'],
    esPagado: false,
  },
  linkedin: {
    canal: 'linkedin',
    formatos: ['post_social', 'articulo'],
    formatoPorDefecto: 'post_social',
    limiteCuerpo: 3000,
    limiteTitulo: 100,
    requiereTitulo: false,
    requiereCta: true,
    requiereAltText: true,
    permiteHashtags: true,
    maxHashtags: 5,
    activosSoportados: ['texto', 'imagen', 'documento'],
    esPagado: false,
  },
  meta_ads: {
    canal: 'meta_ads',
    formatos: ['anuncio'],
    formatoPorDefecto: 'anuncio',
    limiteCuerpo: 125,
    limiteTitulo: 40,
    requiereTitulo: true,
    requiereCta: true,
    requiereAltText: true,
    permiteHashtags: false,
    maxHashtags: 0,
    activosSoportados: ['imagen', 'video'],
    esPagado: true,
  },
  correo: {
    canal: 'correo',
    formatos: ['correo'],
    formatoPorDefecto: 'correo',
    limiteCuerpo: 0,
    limiteTitulo: 90,
    requiereTitulo: true,
    requiereCta: true,
    requiereAltText: false,
    permiteHashtags: false,
    maxHashtags: 0,
    activosSoportados: ['texto', 'imagen'],
    esPagado: false,
  },
};

export function esCanal(canal: string): canal is Canal {
  return canal in PERFILES;
}

export function perfilCanal(canal: string): PerfilCanal | null {
  return esCanal(canal) ? PERFILES[canal] : null;
}

export function todosLosCanales(): readonly Canal[] {
  return Object.keys(PERFILES) as Canal[];
}
