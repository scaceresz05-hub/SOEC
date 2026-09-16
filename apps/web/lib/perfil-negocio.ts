/**
 * PRESENTACIÓN del negocio en el panel: qué tipo de negocio es, dónde opera y qué objetivo persigue.
 *
 * Antes el panel tenía dos casos: e-commerce o "Software dental (SaaS)". Todo lo que no era tienda se
 * pintaba como SmileFlow —«Software dental (SaaS)», «Conseguir clínicas interesadas», «pidieron demo»—
 * aunque la API dijera `SERVICIOS`. Así CP Odontología aparecía descrita como un software.
 *
 * Aquí hay tres presentaciones y la de servicios sale de lo que el negocio DECLARA (`tipoDeNegocio`,
 * `objetivoComercial`, `especialidad`, `ubicacionComercial`). Lo que no está declarado no se rellena con
 * la descripción de otro negocio: se dice que falta. E-commerce y SaaS conservan su presentación intacta.
 */

export type Presentacion = 'ECOMMERCE' | 'SAAS' | 'SERVICIOS' | 'OTRO';

export interface IdentidadNegocio {
  readonly modeloDeNegocio: string;
  readonly mercado: string;
  readonly tipoDeNegocio?: string | null;
  readonly objetivoComercial?: string | null;
  readonly especialidad?: { readonly principal: string; readonly tambienPresta: readonly string[] } | null;
  readonly ubicacionComercial?: string | null;
}

export function presentacionDe(modelo: string | null | undefined): Presentacion {
  if (modelo === 'ECOMMERCE_DISTRIBUCION') return 'ECOMMERCE';
  if (modelo === 'SAAS_FUNNEL') return 'SAAS';
  if (modelo === 'SERVICIOS') return 'SERVICIOS';
  return 'OTRO';
}

/** Etiqueta del tipo de negocio. SaaS y e-commerce, las de siempre; servicios, la declarada. */
export function etiquetaTipo(n: IdentidadNegocio): string {
  switch (presentacionDe(n.modeloDeNegocio)) {
    case 'ECOMMERCE':
      return 'E-commerce / distribución';
    case 'SAAS':
      return 'Software dental (SaaS)';
    case 'SERVICIOS':
      return n.tipoDeNegocio?.trim() || 'Servicios';
    default:
      return n.tipoDeNegocio?.trim() || n.modeloDeNegocio;
  }
}

/** Dónde opera comercialmente: el territorio declarado; si no hay, el mercado. */
export function etiquetaUbicacion(n: IdentidadNegocio): string {
  return n.ubicacionComercial?.trim() || n.mercado;
}

/** Objetivo declarado del negocio, o `null` si no lo declaró (nunca el objetivo de otro negocio). */
export function objetivoDeclarado(n: IdentidadNegocio): string | null {
  return n.objetivoComercial?.trim() || null;
}
