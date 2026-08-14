/**
 * @soec/comercio · dominio · EMBUDO DE COMERCIO ELECTRÓNICO.
 *
 * Define el contrato del embudo que se usará CUANDO exista instrumentación. Hoy, en la tienda
 * observada, no hay GA4, ni GTM, ni etiqueta de Ads, ni píxel: el embudo entero está
 * `NO_INSTRUMENTADO`.
 *
 * La distinción que este módulo protege:
 *
 *     0 eventos OBSERVADOS  ╪  0 eventos OCURRIDOS
 *
 * Un paso no instrumentado NO tiene valor cero: no tiene valor. Por eso `EstadoPaso` no admite un
 * número suelto y `PasoEmbudo.eventos` sólo existe cuando el paso está instrumentado.
 */

/** Pasos canónicos del embudo de comercio (vocabulario estándar de e-commerce). */
export const PASOS_EMBUDO_COMERCIO = [
  'view_item_list',
  'select_item',
  'view_item',
  'add_to_cart',
  'view_cart',
  'begin_checkout',
  'purchase',
] as const;

export type PasoEmbudoComercio = (typeof PASOS_EMBUDO_COMERCIO)[number];

export type EstadoInstrumentacion =
  'NO_INSTRUMENTADO' | 'INSTRUMENTADO_SIN_DATOS' | 'INSTRUMENTADO_CON_DATOS' | 'ERROR';

/**
 * Un paso del embudo. `eventos` SÓLO está presente cuando hay instrumentación con datos: el tipo
 * hace imposible reportar «0 eventos» para un paso que nadie está midiendo.
 */
export type PasoEmbudo =
  | {
      readonly paso: PasoEmbudoComercio;
      readonly estado: Exclude<EstadoInstrumentacion, 'INSTRUMENTADO_CON_DATOS'>;
    }
  | {
      readonly paso: PasoEmbudoComercio;
      readonly estado: 'INSTRUMENTADO_CON_DATOS';
      readonly eventos: number;
    };

export interface EmbudoComercio {
  readonly organizationId: string;
  readonly pasos: readonly PasoEmbudo[];
  readonly evaluable: boolean;
}

/** Embudo completo sin instrumentar. Es el estado honesto de una tienda sin analítica. */
export function embudoNoInstrumentado(organizationId: string): EmbudoComercio {
  return {
    organizationId,
    pasos: PASOS_EMBUDO_COMERCIO.map((paso) => ({ paso, estado: 'NO_INSTRUMENTADO' as const })),
    evaluable: false,
  };
}

/** Estado de una capacidad de analítica. Distingue «no configurado» de «configurado sin datos». */
export type EstadoAnalitica =
  'NOT_CONFIGURED' | 'CONNECTED_NO_DATA' | 'CONNECTED_WITH_DATA' | 'ERROR';

export interface CapacidadAnalitica {
  readonly capacidad: 'GA4' | 'GTM' | 'GOOGLE_ADS_TAG' | 'META_PIXEL' | 'ECOMMERCE_TRACKING';
  readonly estado: EstadoAnalitica;
  readonly detalle: string;
}
