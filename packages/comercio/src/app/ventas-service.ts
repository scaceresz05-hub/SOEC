/**
 * @soec/comercio · aplicación · PERSISTENCIA DE PEDIDOS OBSERVADOS.
 *
 * IDEMPOTENCIA REAL por `organizationId + source + externalOrderId`: reingerir el histórico NO
 * duplica ventas. A diferencia del catálogo —donde cada corrida es una observación nueva y legítima—
 * un pedido es un HECHO del pasado: se registra una vez y sólo se vuelve a escribir si su contenido
 * CAMBIÓ en la fuente (p. ej. pasó de `processing` a `completed`, o apareció la fecha de pago).
 *
 * La organización del contexto es la AUTORIDAD: un snapshot que diga pertenecer a otra se rechaza.
 */
import {
  ConcurrencyError,
  type Attribution,
  type EventStore,
  type RequestContext,
} from '@soec/contracts';
import { claveComercial } from '../dominio/catalogo';
import type { CommerceOrderObserved, CommerceSalesSnapshot } from '../dominio/venta';
import { calcularLineaBaseDeVentas, type LineaBaseDeVentas } from '../dominio/ventas-resumen';

export const EVENTOS_VENTAS = {
  pedidoObservado: 'comercio.pedido.observado',
  indicePedido: 'comercio.indice.pedido_registrado',
  ventasObservadas: 'comercio.ventas.observadas',
} as const;

export function pedidoStreamId(org: string, source: string, externalOrderId: string): string {
  return `comercio-pedido:${org}:${source}:${externalOrderId}`;
}
export function indicePedidosStreamId(org: string, source: string): string {
  return `comercio-pedidos-indice:${org}:${source}`;
}
export function ventasStreamId(org: string, source: string): string {
  return `comercio-ventas:${org}:${source}`;
}

export interface ResultadoIngestaVentas {
  readonly organizationId: string;
  readonly source: string;
  readonly pedidosLeidos: number;
  readonly pedidosNuevos: number;
  readonly pedidosActualizados: number;
  readonly pedidosSinCambios: number;
  readonly lineaBase: LineaBaseDeVentas;
}

/**
 * Serialización CANÓNICA: claves ordenadas de forma recursiva.
 *
 * Hace falta porque el pedido recién leído de la fuente conserva el orden de claves con que se
 * construyó, mientras que el recuperado de PostgreSQL vuelve con el orden que `jsonb` impone (por
 * longitud y alfabético). Comparar con `JSON.stringify` a secas haría que TODO pedido pareciera
 * modificado en cada corrida, y la idempotencia sería sólo aparente.
 */
function canonico(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(canonico).join(',')}]`;
  const entradas = Object.entries(v as Record<string, unknown>)
    .filter(([, valor]) => valor !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entradas.map(([k, valor]) => `${JSON.stringify(k)}:${canonico(valor)}`).join(',')}}`;
}

/**
 * Igualdad de CONTENIDO. Se ignora `observedAt`: cuándo miró SOEC no cambia el hecho comercial.
 * Si nada más cambió, no se escribe nada — idempotencia efectiva, no sólo de identidad.
 */
function mismoPedido(a: CommerceOrderObserved, b: CommerceOrderObserved): boolean {
  const sinObservedAt = (p: CommerceOrderObserved): unknown => ({
    ...p,
    procedencia: { ...p.procedencia, observedAt: null },
  });
  return canonico(sinObservedAt(a)) === canonico(sinObservedAt(b));
}

export class VentasComercioService {
  constructor(private readonly store: EventStore) {}

  private org(ctx: RequestContext): string {
    return String(ctx.organizationId);
  }

  private async ultimoPedido(
    ctx: RequestContext,
    source: string,
    externalOrderId: string,
  ): Promise<CommerceOrderObserved | null> {
    const eventos = await this.store.readStream(
      ctx,
      pedidoStreamId(this.org(ctx), source, externalOrderId),
    );
    let ultimo: CommerceOrderObserved | null = null;
    for (const e of eventos) {
      if (e.type === EVENTOS_VENTAS.pedidoObservado) ultimo = e.payload as CommerceOrderObserved;
    }
    return ultimo;
  }

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
   * Persiste el snapshot de ventas. Sólo escribe los pedidos NUEVOS o CAMBIADOS.
   * @param cobertura qué parte del negocio representa esta fuente (la declara la composición).
   */
  async ingerir(
    ctx: RequestContext,
    snapshot: CommerceSalesSnapshot,
    a: Attribution,
    cobertura: LineaBaseDeVentas['coberturaDelNegocio'] = 'PARCIAL',
  ): Promise<ResultadoIngestaVentas> {
    const org = this.org(ctx);
    if (snapshot.organizationId !== org) {
      throw new Error(
        `snapshot de ventas de '${snapshot.organizationId}' no puede ingerirse en el contexto de '${org}'`,
      );
    }
    for (const p of snapshot.pedidos) {
      if (p.organizationId !== org)
        throw new Error(`pedido de otra organización: ${p.organizationId}`);
      if (p.cliente.organizationId !== org) throw new Error('cliente de otra organización');
    }

    let nuevos = 0;
    let actualizados = 0;
    let sinCambios = 0;

    for (const pedido of snapshot.pedidos) {
      const ext = pedido.procedencia.externalId;
      const previo = await this.ultimoPedido(ctx, snapshot.source, ext);
      if (previo === null) {
        nuevos += 1;
      } else if (mismoPedido(previo, pedido)) {
        sinCambios += 1;
        continue; // idempotente: el mismo hecho no se vuelve a escribir
      } else {
        actualizados += 1;
      }

      await this.append(
        ctx,
        pedidoStreamId(org, snapshot.source, ext),
        EVENTOS_VENTAS.pedidoObservado,
        pedido,
        a,
        pedido.procedencia.observedAt,
      );
      if (previo === null) {
        await this.append(
          ctx,
          indicePedidosStreamId(org, snapshot.source),
          EVENTOS_VENTAS.indicePedido,
          { externalOrderId: ext, clave: claveComercial(org, snapshot.source, ext) },
          a,
          pedido.procedencia.observedAt,
        );
      }
    }

    const lineaBase = calcularLineaBaseDeVentas(
      org,
      snapshot.source,
      snapshot.observedAt,
      snapshot.pedidos,
      cobertura,
    );
    await this.append(
      ctx,
      ventasStreamId(org, snapshot.source),
      EVENTOS_VENTAS.ventasObservadas,
      lineaBase,
      a,
      snapshot.observedAt,
    );

    return {
      organizationId: org,
      source: snapshot.source,
      pedidosLeidos: snapshot.pedidos.length,
      pedidosNuevos: nuevos,
      pedidosActualizados: actualizados,
      pedidosSinCambios: sinCambios,
      lineaBase,
    };
  }

  /** Última línea base observada. `null` si nunca se observó: NUNCA un resumen en cero. */
  async ultimaLineaBase(ctx: RequestContext, source: string): Promise<LineaBaseDeVentas | null> {
    const eventos = await this.store.readStream(ctx, ventasStreamId(this.org(ctx), source));
    let ultima: LineaBaseDeVentas | null = null;
    for (const e of eventos) {
      if (e.type === EVENTOS_VENTAS.ventasObservadas) ultima = e.payload as LineaBaseDeVentas;
    }
    return ultima;
  }

  /** Identificadores externos de pedido observados por esta organización en esa fuente. */
  async listarPedidoIds(ctx: RequestContext, source: string): Promise<readonly string[]> {
    const eventos = await this.store.readStream(ctx, indicePedidosStreamId(this.org(ctx), source));
    const ids = new Set<string>();
    for (const e of eventos) {
      if (e.type === EVENTOS_VENTAS.indicePedido) {
        ids.add((e.payload as { externalOrderId: string }).externalOrderId);
      }
    }
    return [...ids];
  }

  cargarPedido(
    ctx: RequestContext,
    source: string,
    externalOrderId: string,
  ): Promise<CommerceOrderObserved | null> {
    return this.ultimoPedido(ctx, source, externalOrderId);
  }
}
