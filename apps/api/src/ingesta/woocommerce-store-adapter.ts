/**
 * apps/api · FRONTERA · Adaptador de la **Store API pública de WooCommerce** — ESTRICTAMENTE LECTURA.
 *
 * Implementa `CommerceCatalogSource` consumiendo únicamente los dos endpoints públicos de catálogo:
 *   GET /wp-json/wc/store/v1/products
 *   GET /wp-json/wc/store/v1/products/categories
 *
 * GARANTÍAS DE NO-MUTACIÓN (verificadas por prueba de arquitectura):
 *   · sólo se emite `GET`; el método está fijado en código y no es parametrizable;
 *   · la lista de rutas permitidas es cerrada: nada de `/cart`, `/checkout`, `/order`, `/batch`;
 *   · no se envía ninguna credencial, cookie ni cabecera de autorización — la lectura es anónima;
 *   · no existe ninguna función de escritura en este módulo.
 *
 * ANOMALÍA DE TAXONOMÍA (observada en la tienda real): el endpoint de productos devuelve
 * `categories: []` aunque el producto SÍ pertenece a una categoría. Por eso:
 *   · las categorías se ingieren por su propio endpoint, de forma independiente;
 *   · la relación producto↔categoría se marca `NO_DEMOSTRABLE` cuando la fuente no la expone.
 * NO se inventa ninguna relación.
 */
import {
  detectarHallazgos,
  numeroOpcional,
  textoOpcional,
  type CommerceCatalogSnapshot,
  type CommerceCatalogSource,
  type CommerceCategory,
  type CommerceProduct,
  type DisponibilidadComercio,
  type RelacionCategorias,
} from '@soec/comercio';

/** Rutas públicas de catálogo permitidas. Cerrada por diseño: nada que mute puede alcanzarse. */
const RUTAS_PERMITIDAS = ['/products', '/products/categories'] as const;
type RutaPermitida = (typeof RUTAS_PERMITIDAS)[number];

const POR_PAGINA = 100;
const MAX_PAGINAS = 50; // tope de seguridad; una tienda mayor se reporta como lectura incompleta

export class OperacionNoPermitidaError extends Error {}

export interface OpcionesWooCommerce {
  /** Base de la Store API, p. ej. `https://tienda.cl/wp-json/wc/store/v1`. Sólo http(s). */
  readonly baseUrl: string;
  /** Inyectable para pruebas. En producción, `globalThis.fetch`. */
  readonly fetchImpl?: typeof fetch;
  readonly userAgent?: string;
}

interface ProductoWoo {
  id: number;
  name?: string;
  permalink?: string;
  sku?: string;
  prices?: {
    price?: string;
    regular_price?: string;
    currency_code?: string;
    currency_minor_unit?: number;
  };
  on_sale?: boolean;
  is_in_stock?: boolean;
  is_purchasable?: boolean;
  is_on_backorder?: boolean;
  images?: unknown[];
  brands?: { name?: string }[];
  attributes?: { name?: string }[];
  categories?: { id?: number; name?: string }[];
}

interface CategoriaWoo {
  id: number;
  name?: string;
  slug?: string;
  parent?: number;
  count?: number;
  permalink?: string;
}

export class WooCommerceStoreAdapter implements CommerceCatalogSource {
  readonly source = 'woocommerce-store-api';
  readonly soloLectura = true as const;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly userAgent: string;

  constructor(opts: OpcionesWooCommerce) {
    const url = new URL(opts.baseUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new OperacionNoPermitidaError(`protocolo no permitido: ${url.protocol}`);
    }
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.userAgent = opts.userAgent ?? 'SOEC/observacion-solo-lectura';
  }

  /** ÚNICA salida a la red. GET fijo, ruta de la lista blanca, sin credenciales. */
  private async leer(
    ruta: RutaPermitida,
    params: Record<string, string>,
  ): Promise<{ cuerpo: unknown[]; total: number | null; url: string }> {
    if (!RUTAS_PERMITIDAS.includes(ruta)) {
      throw new OperacionNoPermitidaError(`ruta no permitida en el adaptador de lectura: ${ruta}`);
    }
    const url = new URL(this.baseUrl + ruta);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    const res = await this.fetchImpl(url.toString(), {
      method: 'GET', // fijo: este adaptador no puede mutar nada
      headers: { accept: 'application/json', 'user-agent': this.userAgent },
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`la fuente respondió ${res.status} en ${ruta}`);
    const cuerpo = (await res.json()) as unknown;
    const total = numeroOpcional(res.headers.get('x-wp-total'));
    return { cuerpo: Array.isArray(cuerpo) ? cuerpo : [], total, url: url.toString() };
  }

  async leerCatalogo(organizationId: string, ahora: string): Promise<CommerceCatalogSnapshot> {
    const advertencias: string[] = [];

    // ── Categorías: fuente INDEPENDIENTE de taxonomía ───────────────────────────
    const catRes = await this.leer('/products/categories', { per_page: String(POR_PAGINA) });
    const categorias: CommerceCategory[] = (catRes.cuerpo as CategoriaWoo[]).map((c) => ({
      organizationId,
      procedencia: {
        source: this.source,
        externalId: String(c.id),
        observedAt: ahora,
        endpoint: catRes.url,
      },
      nombre: textoOpcional(c.name) ?? `(sin nombre) ${c.id}`,
      slug: textoOpcional(c.slug),
      conteoDeclarado: numeroOpcional(c.count),
      categoriaPadreExternalId: c.parent && c.parent > 0 ? String(c.parent) : null,
      urlPublica: textoOpcional(c.permalink),
    }));

    // ── Productos: paginación completa ──────────────────────────────────────────
    const productos: CommerceProduct[] = [];
    let pagina = 1;
    let totalDeclarado: number | null = null;
    let completo = true;

    for (;;) {
      const res = await this.leer('/products', {
        per_page: String(POR_PAGINA),
        page: String(pagina),
      });
      if (pagina === 1) totalDeclarado = res.total;
      const lote = res.cuerpo as ProductoWoo[];
      for (const p of lote) productos.push(this.aProducto(organizationId, p, ahora, res.url));
      if (lote.length < POR_PAGINA) break;
      pagina += 1;
      if (pagina > MAX_PAGINAS) {
        completo = false;
        advertencias.push(
          `lectura interrumpida en la página ${MAX_PAGINAS}: el catálogo puede estar incompleto`,
        );
        break;
      }
    }

    // La fuente declara cuántos productos hay: si no coinciden, se DECLARA, no se corrige.
    if (totalDeclarado !== null && totalDeclarado !== productos.length) {
      completo = false;
      advertencias.push(
        `la fuente declara ${totalDeclarado} productos y se leyeron ${productos.length}`,
      );
    }
    if (
      productos.every((p) => p.relacionCategorias === 'NO_DEMOSTRABLE') &&
      categorias.length > 0
    ) {
      advertencias.push(
        'el endpoint de productos no expone la categoría de ningún producto: la relación producto↔categoría NO es demostrable con la API pública',
      );
    }

    return {
      organizationId,
      source: this.source,
      observedAt: ahora,
      productos,
      categorias,
      hallazgos: detectarHallazgos(organizationId, productos, categorias),
      completo,
      advertencias,
    };
  }

  private aProducto(
    organizationId: string,
    p: ProductoWoo,
    ahora: string,
    endpoint: string,
  ): CommerceProduct {
    const declaradas = (p.categories ?? [])
      .map((c) => textoOpcional(c.name))
      .filter((n): n is string => n !== null);
    // Vacío NO significa «sin categoría»: significa que la fuente no lo demuestra.
    const relacion: RelacionCategorias = declaradas.length > 0 ? 'DEMOSTRADA' : 'NO_DEMOSTRABLE';

    let disponibilidad: DisponibilidadComercio = 'DESCONOCIDA';
    if (p.is_on_backorder === true) disponibilidad = 'EN_ESPERA';
    else if (p.is_in_stock === true) disponibilidad = 'EN_STOCK';
    else if (p.is_in_stock === false) disponibilidad = 'SIN_STOCK';

    return {
      organizationId,
      procedencia: { source: this.source, externalId: String(p.id), observedAt: ahora, endpoint },
      nombre: textoOpcional(p.name) ?? `(sin nombre) ${p.id}`,
      urlPublica: textoOpcional(p.permalink),
      // Cadena vacía ⇒ ausente. 129/129 productos de la tienda observada llegan así.
      sku: textoOpcional(p.sku),
      precio: {
        valor: numeroOpcional(p.prices?.price),
        valorRegular: numeroOpcional(p.prices?.regular_price),
        moneda: textoOpcional(p.prices?.currency_code),
        unidadMinima: numeroOpcional(p.prices?.currency_minor_unit),
        enOferta: typeof p.on_sale === 'boolean' ? p.on_sale : null,
      },
      disponibilidad,
      comprable: typeof p.is_purchasable === 'boolean' ? p.is_purchasable : null,
      imagenes: Array.isArray(p.images) ? p.images.length : 0,
      marcas: (p.brands ?? [])
        .map((b) => textoOpcional(b.name))
        .filter((n): n is string => n !== null),
      atributos: (p.attributes ?? [])
        .map((a) => textoOpcional(a.name))
        .filter((n): n is string => n !== null),
      categoriasDeclaradas: declaradas,
      relacionCategorias: relacion,
    };
  }
}
