/**
 * @soec/comercio · PUERTOS. Fronteras reemplazables hacia una plataforma de comercio.
 *
 * El dominio NUNCA llama a un SDK ni a una URL concreta: consume estos puertos. WooCommerce es hoy
 * la primera implementación; Shopify o una API propia encajarían sin cambiar nada aguas arriba.
 *
 * `CommerceCatalogSource` es SÓLO LECTURA por tipo: no declara ninguna operación de escritura, de
 * modo que ninguna implementación puede ofrecer una sin salirse del contrato.
 */
import type { CommerceCatalogSnapshot } from './dominio/snapshot';
import type { CommerceOrder } from './dominio/pedido';

/** Fuente de catálogo. Sólo lectura: leer el catálogo público jamás modifica la tienda. */
export interface CommerceCatalogSource {
  /** Identificador OPACO de la fuente. Forma parte de la clave lógica de cada recurso. */
  readonly source: string;
  readonly soloLectura: true;
  /** Lee el catálogo completo. `ahora` se inyecta (determinismo en pruebas). */
  leerCatalogo(organizationId: string, ahora: string): Promise<CommerceCatalogSnapshot>;
}

export type EstadoFuentePedidos =
  'CREDENTIALS_REQUIRED' | 'CONNECTED_READ_ONLY' | 'NOT_CONFIGURED' | 'ERROR';

/**
 * Fuente de PEDIDOS. Declarada, NO implementada: leer pedidos exige credenciales privadas que
 * todavía no existen. Mientras el estado no sea `CONNECTED_READ_ONLY`, `leerPedidos` DEBE lanzar.
 *
 * Consecuencia deliberada: SOEC no puede reportar «0 ventas» por esta vía. Sólo puede reportar
 * `SALES = PENDING_CREDENTIALS`.
 */
export interface CommerceOrdersSource {
  readonly source: string;
  readonly soloLectura: true;
  readonly estado: EstadoFuentePedidos;
  leerPedidos(
    organizationId: string,
    desde: string,
    hasta: string,
  ): Promise<readonly CommerceOrder[]>;
}

export class FuenteDePedidosNoDisponibleError extends Error {
  constructor(
    readonly source: string,
    readonly estado: EstadoFuentePedidos,
  ) {
    super(
      `la fuente de pedidos '${source}' no está disponible (${estado}). ` +
        'SOEC no puede afirmar que no hay ventas: sólo que no puede leerlas.',
    );
    this.name = 'FuenteDePedidosNoDisponibleError';
  }
}
