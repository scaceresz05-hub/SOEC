/**
 * @soec/comercio · dominio · SNAPSHOT DE CATÁLOGO y su RESUMEN.
 *
 * El snapshot es lo que SOEC observó en un instante, tal cual. El resumen se DERIVA del snapshot de
 * forma pura y determinista: ninguna cifra del resumen puede existir sin un hecho que la respalde.
 * Si algo no se puede calcular (p. ej. rango de precios sin precios), es `null`, no `0`.
 */
import type { CommerceCategory, CommerceProduct } from './catalogo';
import type { CommerceDataQualityFinding } from './calidad';

export interface CommerceCatalogSnapshot {
  readonly organizationId: string;
  readonly source: string;
  readonly observedAt: string;
  readonly productos: readonly CommerceProduct[];
  readonly categorias: readonly CommerceCategory[];
  readonly hallazgos: readonly CommerceDataQualityFinding[];
  /** Si la lectura fue parcial (paginación incompleta, fallo intermedio), se declara. */
  readonly completo: boolean;
  readonly advertencias: readonly string[];
}

export interface ResumenCatalogo {
  readonly productosObservados: number;
  readonly categoriasObservadas: number;
  readonly precioMin: number | null;
  readonly precioMax: number | null;
  readonly moneda: string | null;
  readonly enStock: number;
  readonly sinStock: number;
  readonly disponibilidadDesconocida: number;
  readonly conSku: number;
  readonly conMarca: number;
  readonly conAtributos: number;
  readonly conImagen: number;
  readonly conPrecio: number;
  /** Cuántos productos tienen relación de categoría DEMOSTRABLE. */
  readonly conCategoriaDemostrable: number;
}

/** Deriva el resumen. PURO. Ausencia ⇒ `null`; nunca se rellena con ceros. */
export function resumirCatalogo(s: CommerceCatalogSnapshot): ResumenCatalogo {
  const precios = s.productos
    .map((p) => p.precio.valor)
    .filter((v): v is number => typeof v === 'number');
  const monedas = new Set(
    s.productos.map((p) => p.precio.moneda).filter((m): m is string => typeof m === 'string'),
  );

  return {
    productosObservados: s.productos.length,
    categoriasObservadas: s.categorias.length,
    precioMin: precios.length > 0 ? Math.min(...precios) : null,
    precioMax: precios.length > 0 ? Math.max(...precios) : null,
    // Más de una moneda ⇒ no hay una moneda del catálogo: se declara desconocida.
    moneda: monedas.size === 1 ? [...monedas][0]! : null,
    enStock: s.productos.filter((p) => p.disponibilidad === 'EN_STOCK').length,
    sinStock: s.productos.filter((p) => p.disponibilidad === 'SIN_STOCK').length,
    disponibilidadDesconocida: s.productos.filter((p) => p.disponibilidad === 'DESCONOCIDA').length,
    conSku: s.productos.filter((p) => p.sku !== null).length,
    conMarca: s.productos.filter((p) => p.marcas.length > 0).length,
    conAtributos: s.productos.filter((p) => p.atributos.length > 0).length,
    conImagen: s.productos.filter((p) => p.imagenes > 0).length,
    conPrecio: s.productos.filter((p) => p.precio.valor !== null).length,
    conCategoriaDemostrable: s.productos.filter((p) => p.relacionCategorias === 'DEMOSTRADA')
      .length,
  };
}
