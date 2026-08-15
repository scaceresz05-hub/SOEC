/**
 * AcquisitionOutcome — el resultado que un negocio considera valioso, en una escala común.
 *
 * SOEC debe dejar de optimizar sólo métricas intermedias (CTR, impresiones). Este modelo unifica la
 * escalera de resultados que hoy vive fragmentada entre `EventoWebTipo` (comercio) y `MetricaCanonica`
 * (medición). Cada negocio declara CUÁLES resultados son comercialmente válidos para él:
 *   · SmileFlow (SaaS): LEAD / DEMO / CUSTOMER;
 *   · C Y P (e-commerce): PURCHASE.
 * Un `LEAD` no es un `CUSTOMER`; el `ENGAGEMENT` no es un resultado comercial. Nada de esto se asume:
 * la validez comercial se lee del perfil del negocio.
 */

export type ResultadoAdquisicion =
  | 'IMPRESSION'
  | 'ENGAGEMENT'
  | 'CLICK'
  | 'SITE_SESSION'
  | 'PRODUCT_VIEW'
  | 'LEAD'
  | 'DEMO'
  | 'MESSAGE'
  | 'CHECKOUT'
  | 'PURCHASE'
  | 'QUALIFIED_LEAD'
  | 'CUSTOMER';

/** Orden aproximado en el embudo (mayor = más cerca del valor comercial). Sólo para ranking. */
const RANGO_EMBUDO: Record<ResultadoAdquisicion, number> = {
  IMPRESSION: 0,
  ENGAGEMENT: 1,
  CLICK: 2,
  SITE_SESSION: 3,
  PRODUCT_VIEW: 4,
  MESSAGE: 5,
  LEAD: 6,
  DEMO: 7,
  CHECKOUT: 8,
  QUALIFIED_LEAD: 9,
  PURCHASE: 10,
  CUSTOMER: 11,
};

export function rangoEmbudo(r: ResultadoAdquisicion): number {
  return RANGO_EMBUDO[r];
}

/** Resultados que representan valor comercial "duro" (no intermedio). */
const RESULTADOS_COMERCIALES_FUERTES: readonly ResultadoAdquisicion[] = [
  'LEAD',
  'DEMO',
  'CHECKOUT',
  'QUALIFIED_LEAD',
  'PURCHASE',
  'CUSTOMER',
];

export function esResultadoComercialFuerte(r: ResultadoAdquisicion): boolean {
  return RESULTADOS_COMERCIALES_FUERTES.includes(r);
}

/**
 * Resultados comerciales válidos para un negocio. Nunca se infiere; se declara en el perfil. Un
 * negocio sin resultados declarados devuelve `[]` (no "todos").
 */
export interface ResultadosDeNegocio {
  readonly organizationId: string;
  readonly resultadosComerciales: readonly ResultadoAdquisicion[];
}

export function esResultadoComercialDe(negocio: ResultadosDeNegocio, r: ResultadoAdquisicion): boolean {
  return negocio.resultadosComerciales.includes(r);
}

/** Invariante explícita: un LEAD nunca cuenta como CUSTOMER. */
export function leadNoEsCliente(): true {
  return (RANGO_EMBUDO.LEAD < RANGO_EMBUDO.CUSTOMER) as true;
}
