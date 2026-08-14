/**
 * @soec/comercio · dominio · HALLAZGOS DE CALIDAD DE DATOS.
 *
 * SOEC OBSERVA la calidad del catálogo; no la corrige. Ningún hallazgo modifica la tienda: son
 * afirmaciones sobre lo que la fuente pública permite (o no) demostrar.
 *
 * Cada hallazgo es DEMOSTRABLE desde el snapshot: lleva su conteo y su procedencia. No hay juicios
 * de valor ni recomendaciones aquí — eso es trabajo del Director, más arriba.
 */
import type { CommerceCategory, CommerceProduct } from './catalogo';

export type CodigoHallazgo =
  | 'MISSING_SKU'
  | 'MISSING_BRAND'
  | 'MISSING_ATTRIBUTES'
  | 'MISSING_IMAGE'
  | 'EMPTY_CATEGORY'
  | 'PRODUCT_CATEGORY_LINK_NOT_DEMOSTRABLE'
  | 'DUPLICATE_PRODUCT_CANDIDATE'
  | 'DUPLICATE_CATEGORY_NAME'
  | 'CATEGORY_NAME_WITH_INVISIBLE_CHARS'
  | 'MISSING_PRICE';

export type SeveridadHallazgo = 'INFORMATIVO' | 'ATENCION' | 'IMPIDE_MEDIR';

export interface CommerceDataQualityFinding {
  readonly organizationId: string;
  readonly codigo: CodigoHallazgo;
  readonly severidad: SeveridadHallazgo;
  /** Cuántos recursos presentan el hallazgo. Es un conteo REAL sobre el snapshot. */
  readonly afectados: number;
  readonly total: number;
  readonly detalle: string;
  /** Muestra acotada de identificadores afectados, para poder verificarlo a mano. */
  readonly ejemplos: readonly string[];
}

const MUESTRA = 5;
/**
 * Caracteres invisibles que ensucian nombres de taxonomía y rompen coincidencias exactas.
 * Se escriben escapados a propósito: un invisible literal en el código sería, él mismo, el problema.
 * U+200B–U+200D (espacios de ancho cero), U+2060 (word joiner), U+FEFF (BOM).
 */
const INVISIBLES = /[\u200B-\u200D\u2060\uFEFF]/;

/**
 * Deriva los hallazgos DEMOSTRABLES de un snapshot. Función pura: mismo snapshot, mismos hallazgos.
 * Sólo emite un hallazgo cuando hay al menos un afectado.
 */
export function detectarHallazgos(
  organizationId: string,
  productos: readonly CommerceProduct[],
  categorias: readonly CommerceCategory[],
): readonly CommerceDataQualityFinding[] {
  const out: CommerceDataQualityFinding[] = [];
  const total = productos.length;

  const emitir = (
    codigo: CodigoHallazgo,
    severidad: SeveridadHallazgo,
    afectadosIds: readonly string[],
    totalBase: number,
    detalle: string,
  ): void => {
    if (afectadosIds.length === 0) return;
    out.push({
      organizationId,
      codigo,
      severidad,
      afectados: afectadosIds.length,
      total: totalBase,
      detalle,
      ejemplos: afectadosIds.slice(0, MUESTRA),
    });
  };

  const id = (p: CommerceProduct): string => p.procedencia.externalId;

  emitir(
    'MISSING_SKU',
    'ATENCION',
    productos.filter((p) => p.sku === null).map(id),
    total,
    'productos sin SKU propio: el identificador estable debe ser el externalId de la fuente',
  );
  emitir(
    'MISSING_BRAND',
    'INFORMATIVO',
    productos.filter((p) => p.marcas.length === 0).map(id),
    total,
    'productos sin marca declarada (limita Shopping y filtrado por marca)',
  );
  emitir(
    'MISSING_ATTRIBUTES',
    'INFORMATIVO',
    productos.filter((p) => p.atributos.length === 0).map(id),
    total,
    'productos sin atributos estructurados',
  );
  emitir(
    'MISSING_IMAGE',
    'ATENCION',
    productos.filter((p) => p.imagenes === 0).map(id),
    total,
    'productos sin imagen',
  );
  emitir(
    'MISSING_PRICE',
    'IMPIDE_MEDIR',
    productos.filter((p) => p.precio.valor === null).map(id),
    total,
    'productos sin precio observable',
  );
  emitir(
    'PRODUCT_CATEGORY_LINK_NOT_DEMOSTRABLE',
    'IMPIDE_MEDIR',
    productos.filter((p) => p.relacionCategorias === 'NO_DEMOSTRABLE').map(id),
    total,
    'la fuente pública no permite demostrar a qué categoría pertenece el producto',
  );

  // Productos con nombre idéntico: CANDIDATOS a duplicado. No se afirma que lo sean.
  const porNombre = new Map<string, string[]>();
  for (const p of productos) {
    const k = p.nombre.trim().toLowerCase();
    porNombre.set(k, [...(porNombre.get(k) ?? []), id(p)]);
  }
  emitir(
    'DUPLICATE_PRODUCT_CANDIDATE',
    'INFORMATIVO',
    [...porNombre.values()].filter((v) => v.length > 1).flat(),
    total,
    'productos que comparten nombre exacto: candidatos a duplicado (no confirmado)',
  );

  // ── Taxonomía ──────────────────────────────────────────────────────────────
  const idCat = (c: CommerceCategory): string => c.procedencia.externalId;
  emitir(
    'EMPTY_CATEGORY',
    'ATENCION',
    categorias.filter((c) => (c.conteoDeclarado ?? 0) === 0).map(idCat),
    categorias.length,
    'categorías sin productos declarados por la fuente',
  );

  const porNombreCat = new Map<string, string[]>();
  for (const c of categorias) {
    const k = c.nombre.replace(INVISIBLES, '').trim().toLowerCase();
    porNombreCat.set(k, [...(porNombreCat.get(k) ?? []), idCat(c)]);
  }
  emitir(
    'DUPLICATE_CATEGORY_NAME',
    'ATENCION',
    [...porNombreCat.values()].filter((v) => v.length > 1).flat(),
    categorias.length,
    'categorías distintas con el mismo nombre: la taxonomía es ambigua para el usuario',
  );
  emitir(
    'CATEGORY_NAME_WITH_INVISIBLE_CHARS',
    'ATENCION',
    categorias.filter((c) => INVISIBLES.test(c.nombre)).map(idCat),
    categorias.length,
    'nombres de categoría con caracteres invisibles: rompen coincidencias exactas y feeds',
  );

  return out;
}
