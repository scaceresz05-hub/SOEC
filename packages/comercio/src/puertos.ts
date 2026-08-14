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
import type { CommerceOrderObserved, CommerceSalesSnapshot } from './dominio/venta';

/** Fuente de catálogo. Sólo lectura: leer el catálogo público jamás modifica la tienda. */
export interface CommerceCatalogSource {
  /** Identificador OPACO de la fuente. Forma parte de la clave lógica de cada recurso. */
  readonly source: string;
  readonly soloLectura: true;
  /** Lee el catálogo completo. `ahora` se inyecta (determinismo en pruebas). */
  leerCatalogo(organizationId: string, ahora: string): Promise<CommerceCatalogSnapshot>;
}

/**
 * Puerto de LECTURA DE VENTAS. Sólo declara operaciones de lectura: el tipo hace imposible que una
 * implementación ofrezca `crearPedido`, `actualizarPedido`, `eliminarPedido`, `actualizarProducto`,
 * `actualizarStock` o `crearCliente` sin salirse del contrato.
 *
 * Una prueba de arquitectura verifica que ninguna implementación introduzca métodos mutantes.
 */
export interface CommerceSalesReadPort {
  readonly source: string;
  readonly soloLectura: true;
  /** Lee TODOS los pedidos del rango indicado, paginando. `ahora` se inyecta (determinismo). */
  listarPedidos(
    organizationId: string,
    ahora: string,
    opts?: { readonly desde?: string; readonly hasta?: string },
  ): Promise<CommerceSalesSnapshot>;
  /** Lee un pedido concreto. `null` si no existe para esta organización. */
  obtenerPedido(
    organizationId: string,
    externalOrderId: string,
    ahora: string,
  ): Promise<CommerceOrderObserved | null>;
  /** Comprobación de credencial y permiso, sin efectos. */
  verificarAcceso(): Promise<VerificacionDeAcceso>;
}

/** Resultado de comprobar la credencial. Nunca contiene la credencial ni fragmentos de ella. */
export interface VerificacionDeAcceso {
  readonly autenticado: boolean;
  readonly puedeLeerPedidos: boolean;
  readonly puedeLeerProductos: boolean;
  /** Código HTTP del intento de autenticación, para diagnosticar sin revelar nada. */
  readonly estadoHttp: number | null;
  readonly detalle: string;
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
