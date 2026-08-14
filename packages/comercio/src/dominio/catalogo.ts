/**
 * @soec/comercio · dominio · CATÁLOGO GENÉRICO DE COMERCIO ELECTRÓNICO.
 *
 * Modelo NEUTRAL: no nombra ninguna empresa ni ninguna plataforma. Distribuidora C Y P es hoy su
 * primer consumidor (WooCommerce), pero cualquier organización de e-commerce futura debe poder
 * reutilizarlo sin cambiarlo. Por eso el modelo habla de `source` (opaco) y `externalId`, no de
 * WordPress, Shopify ni ninguna marca.
 *
 * DOS REGLAS EPISTÉMICAS QUE EL MODELO IMPONE POR TIPO:
 *
 *  1. **El SKU NO es clave primaria.** La identidad estable es `organizationId + source + externalId`.
 *     En la tienda observada, 129/129 productos carecen de SKU propio: si el SKU fuera la clave, el
 *     catálogo entero colapsaría en una sola entidad. `sku` es un atributo opcional y nada más.
 *
 *  2. **Desconocido ╪ cero, y ausente ╪ vacío.** Un precio no observado es `null`, no `0`. Una
 *     relación producto↔categoría que la fuente no permite demostrar es `PARCIAL`/`DESCONOCIDA`,
 *     no "sin categorías".
 */

/** Procedencia de una observación de comercio. Nunca se mezcla con otras fuentes del tenant. */
export interface ProcedenciaComercio {
  /** Identificador OPACO de la fuente (p. ej. `woocommerce-store-api`). No es una marca comercial. */
  readonly source: string;
  /** Identificador estable del recurso EN la fuente. Es parte de la clave lógica. */
  readonly externalId: string;
  /** Instante en que SOEC observó el hecho (no cuándo ocurrió en la tienda). */
  readonly observedAt: string;
  /** URL pública consultada, para auditoría. Sin credenciales: esta lectura es anónima. */
  readonly endpoint: string;
}

/**
 * CLAVE LÓGICA de cualquier recurso de comercio. Dos organizaciones pueden tener el MISMO
 * `externalId` en la misma plataforma sin colisionar: la organización forma parte de la clave.
 */
export function claveComercial(organizationId: string, source: string, externalId: string): string {
  if (!organizationId || !source || !externalId) {
    throw new Error('claveComercial exige organizationId, source y externalId');
  }
  return `${organizationId}::${source}::${externalId}`;
}

/** Disponibilidad observada. `DESCONOCIDA` cuando la fuente no la expone; nunca se asume. */
export type DisponibilidadComercio = 'EN_STOCK' | 'SIN_STOCK' | 'EN_ESPERA' | 'DESCONOCIDA';

/**
 * Precio observado. `valor === null` significa NO OBSERVADO — jamás gratis.
 * `unidadMinima` refleja los decimales de la moneda (CLP = 0): el valor se guarda en la unidad
 * declarada por la fuente, sin conversiones silenciosas.
 */
export interface CommercePrice {
  readonly valor: number | null;
  readonly valorRegular: number | null;
  readonly moneda: string | null;
  readonly unidadMinima: number | null;
  readonly enOferta: boolean | null;
}

export const PRECIO_NO_OBSERVADO: CommercePrice = {
  valor: null,
  valorRegular: null,
  moneda: null,
  unidadMinima: null,
  enOferta: null,
};

/** Producto observado en el catálogo. Sólo hechos de la fuente; nada derivado ni supuesto. */
export interface CommerceProduct {
  readonly organizationId: string;
  readonly procedencia: ProcedenciaComercio;
  readonly nombre: string;
  readonly urlPublica: string | null;
  /** Atributo OPCIONAL. Nunca es la clave. Cadena vacía se normaliza a `null`. */
  readonly sku: string | null;
  readonly precio: CommercePrice;
  readonly disponibilidad: DisponibilidadComercio;
  readonly comprable: boolean | null;
  readonly imagenes: number;
  readonly marcas: readonly string[];
  readonly atributos: readonly string[];
  /**
   * Categorías que la fuente asocia AL PRODUCTO. Puede venir vacío aunque el producto sí pertenezca
   * a una categoría: ver `relacionCategorias`.
   */
  readonly categoriasDeclaradas: readonly string[];
  /** Qué tan demostrable es la relación producto↔categoría con esta fuente. */
  readonly relacionCategorias: RelacionCategorias;
}

/**
 * Estado de la relación producto↔categoría.
 *
 * `NO_DEMOSTRABLE` es el caso observado en la tienda actual: el endpoint de productos devuelve
 * `categories: []` aunque el producto sí está categorizado. Por eso el catálogo de categorías se
 * ingiere por SEPARADO y la relación NO se inventa.
 */
export type RelacionCategorias = 'DEMOSTRADA' | 'PARCIAL' | 'NO_DEMOSTRABLE';

/** Categoría observada. Se ingiere de forma INDEPENDIENTE del producto (no es SSOT del producto). */
export interface CommerceCategory {
  readonly organizationId: string;
  readonly procedencia: ProcedenciaComercio;
  readonly nombre: string;
  readonly slug: string | null;
  /** Cuántos productos declara la FUENTE en esta categoría. Es un dato de la fuente, no un cálculo. */
  readonly conteoDeclarado: number | null;
  readonly categoriaPadreExternalId: string | null;
  readonly urlPublica: string | null;
}

/** Normaliza una cadena de la fuente: vacío/espacios ⇒ `null` (ausente), nunca cadena vacía. */
export function textoOpcional(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/** Normaliza un número de la fuente: no numérico ⇒ `null` (no observado), nunca `0`. */
export function numeroOpcional(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
