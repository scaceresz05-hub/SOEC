/**
 * @soec/comercio · dominio · CARRITO, CHECKOUT, PEDIDO E INGRESO.
 *
 * CONTRATOS, no datos. Ninguna organización tiene todavía una fuente de pedidos conectada, así que
 * este módulo define la FORMA que tendrán esos hechos cuando existan — y nada más. No hay fixtures,
 * no hay mocks de runtime, no hay pedidos de ejemplo.
 *
 * Invariantes epistémicos codificados en los tipos:
 *   · `cliente` es opcional: el checkout de invitado es legítimo y no debe degradar el pedido.
 *   · `costo` y `margen` pueden permanecer `null` INDEFINIDAMENTE. No son cero: son desconocidos.
 *   · el ingreso de envío es `DesconocidoOValor`: un envío "por pagar" fuera de la tienda NO es $0.
 */
import type { ProcedenciaComercio } from './catalogo';

/**
 * Valor que puede estar legítimamente sin conocer. Hace IMPOSIBLE confundir «no lo sé» con «es 0»:
 * el consumidor tiene que mirar `conocido` antes de leer `valor`.
 */
export type DesconocidoOValor =
  | { readonly conocido: false; readonly motivo: MotivoDesconocido; readonly valor: null }
  | { readonly conocido: true; readonly valor: number };

export type MotivoDesconocido =
  | 'NO_MEDIDO'
  | 'FUENTE_NO_CONECTADA'
  | 'REQUIERE_CREDENCIALES'
  | 'NO_INSTRUMENTADO'
  | 'PAGO_EXTERNO'
  | 'NO_APLICA';

export const desconocido = (motivo: MotivoDesconocido): DesconocidoOValor => ({
  conocido: false,
  motivo,
  valor: null,
});
export const conocido = (valor: number): DesconocidoOValor => ({ conocido: true, valor });

/** Cliente. `null` es un estado VÁLIDO: WooCommerce permite comprar como invitado. */
export interface CommerceCustomer {
  readonly organizationId: string;
  readonly externalId: string | null;
  readonly esInvitado: boolean;
}

export interface CommerceCartItem {
  readonly productoExternalId: string;
  readonly cantidad: number;
  readonly precioUnitario: DesconocidoOValor;
}

export interface CommerceCart {
  readonly organizationId: string;
  readonly procedencia: ProcedenciaComercio;
  readonly items: readonly CommerceCartItem[];
  readonly total: DesconocidoOValor;
}

export type EstadoCheckout = 'INICIADO' | 'ABANDONADO' | 'COMPLETADO' | 'DESCONOCIDO';

export interface CommerceCheckout {
  readonly organizationId: string;
  readonly procedencia: ProcedenciaComercio;
  readonly estado: EstadoCheckout;
  readonly medioDePago: string | null;
  readonly metodoDeEnvio: string | null;
}

export type EstadoPedido =
  'PENDIENTE' | 'PROCESANDO' | 'COMPLETADO' | 'CANCELADO' | 'REEMBOLSADO' | 'DESCONOCIDO';

/**
 * Pedido. `cliente` puede ser `null` (invitado). `costoDeVenta` y `margen` pueden quedarse en
 * desconocido para siempre sin que el pedido deje de ser válido.
 */
export interface CommerceOrder {
  readonly organizationId: string;
  readonly procedencia: ProcedenciaComercio;
  readonly estado: EstadoPedido;
  readonly cliente: CommerceCustomer | null;
  readonly items: readonly CommerceCartItem[];
  readonly totalBruto: DesconocidoOValor;
  readonly ingresoDeEnvio: DesconocidoOValor;
  readonly costoDeVenta: DesconocidoOValor;
  readonly margen: DesconocidoOValor;
  readonly moneda: string | null;
  readonly ocurridoEn: string | null;
}

/** Ingreso agregado de un período. Cada componente declara si se conoce. */
export interface CommerceRevenue {
  readonly organizationId: string;
  readonly periodo: string;
  readonly moneda: string | null;
  readonly ingresoBruto: DesconocidoOValor;
  readonly ingresoNeto: DesconocidoOValor;
  readonly pedidos: DesconocidoOValor;
  readonly ticketPromedio: DesconocidoOValor;
  readonly margenBruto: DesconocidoOValor;
  /**
   * Qué parte del ingreso del negocio representa esta fuente. Si el negocio también vende por
   * canales no instrumentados (WhatsApp, mostrador), esto NO es el 100%: es desconocido.
   */
  readonly cobertura: 'TOTAL_DEL_NEGOCIO' | 'PARCIAL' | 'DESCONOCIDA';
}
