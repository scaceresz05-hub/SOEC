/**
 * @soec/comercio · aplicación · PERSISTENCIA DEL CATÁLOGO COMO OBSERVACIONES SOEC.
 *
 * Convierte un snapshot de catálogo en observaciones event-sourced, SIEMPRE bajo la organización del
 * `RequestContext`. Los identificadores de stream incluyen la organización y la fuente, de modo que
 * dos organizaciones con el MISMO `externalId` en la MISMA plataforma coexisten sin colisión.
 *
 * Estas observaciones viven en un eje PROPIO (`comercio:*`) y no se mezclan con las de M8/Growth:
 * un catálogo no es una métrica de campaña ni un evento de embudo.
 *
 * Historia APPEND-ONLY, no idempotente por diseño: cada corrida es una OBSERVACIÓN NUEVA en un
 * instante distinto, y observar dos veces es un hecho legítimo (permite ver cómo cambia el catálogo).
 * Lo que sí se garantiza es que una carrera entre corridas no rompe la ingesta, y que la lectura
 * (`ultimoCatalogo`, `cargarProducto`) devuelve siempre la ÚLTIMA observación.
 *
 * Nada de esto escribe en la tienda: la tienda es sólo lectura.
 */
import {
  ConcurrencyError,
  type Attribution,
  type EventStore,
  type RequestContext,
} from '@soec/contracts';
import { claveComercial, type CommerceCategory, type CommerceProduct } from '../dominio/catalogo';
import {
  resumirCatalogo,
  type CommerceCatalogSnapshot,
  type ResumenCatalogo,
} from '../dominio/snapshot';
import type { CommerceDataQualityFinding } from '../dominio/calidad';

export const EVENTOS_COMERCIO = {
  productoObservado: 'comercio.producto.observado',
  categoriaObservada: 'comercio.categoria.observada',
  catalogoObservado: 'comercio.catalogo.observado',
  indiceProducto: 'comercio.indice.producto_registrado',
} as const;

export function productoStreamId(org: string, source: string, externalId: string): string {
  return `comercio-producto:${org}:${source}:${externalId}`;
}
export function categoriaStreamId(org: string, source: string, externalId: string): string {
  return `comercio-categoria:${org}:${source}:${externalId}`;
}
export function catalogoStreamId(org: string, source: string): string {
  return `comercio-catalogo:${org}:${source}`;
}
export function indiceProductosStreamId(org: string, source: string): string {
  return `comercio-productos-indice:${org}:${source}`;
}

/** Cabecera del catálogo observado: resumen derivado + hallazgos + procedencia. Sin datos crudos. */
export interface CatalogoObservado {
  readonly organizationId: string;
  readonly source: string;
  readonly observedAt: string;
  readonly resumen: ResumenCatalogo;
  readonly hallazgos: readonly CommerceDataQualityFinding[];
  readonly completo: boolean;
  readonly advertencias: readonly string[];
  /** Identificadores externos de las categorías observadas, para poder releerlas. */
  readonly categoriaIds: readonly string[];
}

export interface ResultadoIngestaCatalogo {
  readonly organizationId: string;
  readonly source: string;
  readonly productosPersistidos: number;
  readonly categoriasPersistidas: number;
  readonly resumen: ResumenCatalogo;
  readonly hallazgos: readonly CommerceDataQualityFinding[];
}

export class CatalogoComercioService {
  constructor(private readonly store: EventStore) {}

  private org(ctx: RequestContext): string {
    return String(ctx.organizationId);
  }

  /** Append tolerante a carreras: la reingesta concurrente no rompe la corrida. */
  private async append(
    ctx: RequestContext,
    streamId: string,
    type: string,
    payload: unknown,
    a: Attribution,
    ocurridoEn: string,
  ): Promise<void> {
    const eventos = await this.store.readStream(ctx, streamId);
    try {
      await this.store.append(ctx, streamId, eventos.length, [
        { type, payload, attribution: a, occurredAt: ocurridoEn },
      ]);
    } catch (e) {
      if (!(e instanceof ConcurrencyError)) throw e;
    }
  }

  /**
   * Persiste el snapshot completo. El `organizationId` AUTORITATIVO es el del contexto: si el
   * snapshot dice pertenecer a otra organización, se rechaza (invariante estructural).
   */
  async ingerir(
    ctx: RequestContext,
    snapshot: CommerceCatalogSnapshot,
    a: Attribution,
  ): Promise<ResultadoIngestaCatalogo> {
    const org = this.org(ctx);
    if (snapshot.organizationId !== org) {
      throw new Error(
        `snapshot de '${snapshot.organizationId}' no puede ingerirse en el contexto de '${org}'`,
      );
    }
    for (const p of snapshot.productos) {
      if (p.organizationId !== org)
        throw new Error(`producto de otra organización: ${p.organizationId}`);
    }
    for (const c of snapshot.categorias) {
      if (c.organizationId !== org)
        throw new Error(`categoría de otra organización: ${c.organizationId}`);
    }

    for (const producto of snapshot.productos) {
      const ext = producto.procedencia.externalId;
      await this.append(
        ctx,
        productoStreamId(org, snapshot.source, ext),
        EVENTOS_COMERCIO.productoObservado,
        producto,
        a,
        producto.procedencia.observedAt,
      );
      await this.append(
        ctx,
        indiceProductosStreamId(org, snapshot.source),
        EVENTOS_COMERCIO.indiceProducto,
        { externalId: ext, clave: claveComercial(org, snapshot.source, ext) },
        a,
        producto.procedencia.observedAt,
      );
    }

    for (const categoria of snapshot.categorias) {
      await this.append(
        ctx,
        categoriaStreamId(org, snapshot.source, categoria.procedencia.externalId),
        EVENTOS_COMERCIO.categoriaObservada,
        categoria,
        a,
        categoria.procedencia.observedAt,
      );
    }

    const resumen = resumirCatalogo(snapshot);
    const cabecera: CatalogoObservado = {
      organizationId: org,
      source: snapshot.source,
      observedAt: snapshot.observedAt,
      resumen,
      hallazgos: snapshot.hallazgos,
      completo: snapshot.completo,
      advertencias: snapshot.advertencias,
      categoriaIds: snapshot.categorias.map((c) => c.procedencia.externalId),
    };
    await this.append(
      ctx,
      catalogoStreamId(org, snapshot.source),
      EVENTOS_COMERCIO.catalogoObservado,
      cabecera,
      a,
      snapshot.observedAt,
    );

    return {
      organizationId: org,
      source: snapshot.source,
      productosPersistidos: snapshot.productos.length,
      categoriasPersistidas: snapshot.categorias.length,
      resumen,
      hallazgos: snapshot.hallazgos,
    };
  }

  /** Último catálogo observado de esa fuente. `null` si nunca se observó. NUNCA un resumen en cero. */
  async ultimoCatalogo(ctx: RequestContext, source: string): Promise<CatalogoObservado | null> {
    const eventos = await this.store.readStream(ctx, catalogoStreamId(this.org(ctx), source));
    let ultimo: CatalogoObservado | null = null;
    for (const e of eventos) {
      if (e.type === EVENTOS_COMERCIO.catalogoObservado) ultimo = e.payload as CatalogoObservado;
    }
    return ultimo;
  }

  /** Identificadores externos de producto observados por esa fuente, en esta organización. */
  async listarProductoIds(ctx: RequestContext, source: string): Promise<readonly string[]> {
    const eventos = await this.store.readStream(
      ctx,
      indiceProductosStreamId(this.org(ctx), source),
    );
    const ids = new Set<string>();
    for (const e of eventos) {
      if (e.type === EVENTOS_COMERCIO.indiceProducto) {
        ids.add((e.payload as { externalId: string }).externalId);
      }
    }
    return [...ids];
  }

  /** Producto observado. `null` si esta organización nunca lo observó (aunque otra sí). */
  async cargarProducto(
    ctx: RequestContext,
    source: string,
    externalId: string,
  ): Promise<CommerceProduct | null> {
    const eventos = await this.store.readStream(
      ctx,
      productoStreamId(this.org(ctx), source, externalId),
    );
    let ultimo: CommerceProduct | null = null;
    for (const e of eventos) {
      if (e.type === EVENTOS_COMERCIO.productoObservado) ultimo = e.payload as CommerceProduct;
    }
    return ultimo;
  }

  /** Categorías observadas por esta organización en esa fuente (desde el último catálogo). */
  async listarCategorias(
    ctx: RequestContext,
    source: string,
  ): Promise<readonly CommerceCategory[]> {
    const org = this.org(ctx);
    const cabecera = await this.ultimoCatalogo(ctx, source);
    if (!cabecera) return [];
    const out: CommerceCategory[] = [];
    for (const externalId of cabecera.categoriaIds) {
      const eventos = await this.store.readStream(ctx, categoriaStreamId(org, source, externalId));
      for (const e of eventos) {
        if (e.type === EVENTOS_COMERCIO.categoriaObservada) {
          out[out.length] = e.payload as CommerceCategory;
        }
      }
    }
    return out;
  }
}
