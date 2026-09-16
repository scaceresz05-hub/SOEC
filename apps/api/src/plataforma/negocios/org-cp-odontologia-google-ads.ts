/**
 * CP Odontología · EJECUCIÓN GEOGRÁFICA EN GOOGLE ADS (Growth fase 5.1).
 *
 * Dos conceptos distintos que no deben mezclarse:
 *
 *  · ALCANCE COMERCIAL (`ALCANCE_COMERCIAL_CP_ODONTOLOGIA`): Provincia de Curicó, 9/9 comunas. Es lo que
 *    declaran las campañas en SOEC y lo que el gateway exige al crear o editar un borrador.
 *  · EJECUCIÓN EN GOOGLE ADS (este módulo): 6/9 comunas. Romeral, Hualañé y Vichuquén no tienen una
 *    unidad geográfica utilizable en Google Ads sin ampliar deliberadamente fuera de la provincia, así que
 *    NO se segmentan. Nunca se sustituye una comuna por una unidad mayor (provincia, región, país, radio).
 *
 * Módulo puro: no llama a Google ni escribe nada. Es la regla contra la que se valida la arquitectura
 * Search (`docs/growth/cp-odontologia-google-search.json`) antes de crearla en la cuenta de Ads.
 */
import { ALCANCE_COMERCIAL_CP_ODONTOLOGIA } from './org-cp-odontologia';

export const COMUNAS_EJECUTABLES_GOOGLE_ADS_CP: readonly string[] = [
  'Curicó', 'Molina', 'Teno', 'Sagrada Familia', 'Rauco', 'Licantén',
];

export const COMUNAS_NO_EJECUTABLES_GOOGLE_ADS_CP: readonly string[] = ['Romeral', 'Hualañé', 'Vichuquén'];

export type TipoUbicacionGoogleAds = 'COMUNA' | 'PROVINCIA' | 'REGION' | 'PAIS' | 'RADIO';

export interface UbicacionGoogleAds {
  readonly tipo: TipoUbicacionGoogleAds;
  readonly nombre: string;
}

export type MotivoRechazoUbicacion =
  | 'UNIDAD_MAYOR_QUE_COMUNA'
  | 'FUERA_DE_LA_PROVINCIA'
  | 'NO_EJECUTABLE_EN_GOOGLE_ADS';

export interface ResultadoSegmentacionGoogleAds {
  readonly ok: boolean;
  readonly rechazadas: readonly { readonly ubicacion: UbicacionGoogleAds; readonly motivo: MotivoRechazoUbicacion }[];
  readonly criterioInvalido: boolean;
}

/**
 * Valida una segmentación de Google Ads para CP. Sólo pasan COMUNAS de la lista ejecutable con criterio
 * de PRESENCIA. Una lista vacía se rechaza: «sin segmentación» en Google Ads significa todo el país.
 */
export function validarSegmentacionGoogleAdsCp(
  ubicaciones: readonly UbicacionGoogleAds[],
  criterioUbicacion: string,
): ResultadoSegmentacionGoogleAds {
  const comercial = new Set(ALCANCE_COMERCIAL_CP_ODONTOLOGIA.comunas);
  const ejecutables = new Set(COMUNAS_EJECUTABLES_GOOGLE_ADS_CP);
  const rechazadas: { ubicacion: UbicacionGoogleAds; motivo: MotivoRechazoUbicacion }[] = [];
  for (const u of ubicaciones) {
    if (u.tipo !== 'COMUNA') rechazadas.push({ ubicacion: u, motivo: 'UNIDAD_MAYOR_QUE_COMUNA' });
    else if (!comercial.has(u.nombre)) rechazadas.push({ ubicacion: u, motivo: 'FUERA_DE_LA_PROVINCIA' });
    else if (!ejecutables.has(u.nombre)) rechazadas.push({ ubicacion: u, motivo: 'NO_EJECUTABLE_EN_GOOGLE_ADS' });
  }
  const criterioInvalido = criterioUbicacion !== 'PRESENCIA';
  return { ok: ubicaciones.length > 0 && rechazadas.length === 0 && !criterioInvalido, rechazadas, criterioInvalido };
}

/** Texto canónico del requisito operativo geográfico de las campañas de CP en SOEC. */
export const REQUISITO_GEO_GOOGLE_ADS_CP =
  'Territorio: alcance comercial Provincia de Curicó, 9/9 comunas. Ejecución en Google Ads: sólo Curicó, Molina, Teno, Sagrada Familia, Rauco y Licantén (6/9), con la opción de presencia (personas ubicadas o habitualmente presentes), nunca «presencia o interés». Romeral, Hualañé y Vichuquén no se segmentan en Google Ads porque no tienen una unidad geográfica utilizable sin salir de la provincia; nunca se segmenta fuera de la Provincia de Curicó.';
