/**
 * apps/api · Lectura VIVA de ventas C Y P desde el SSOT (@soec/comercio), sin store nuevo.
 *
 * Reutiliza `VentasComercioService.ultimaLineaBase` y el contrato de pago canónico
 * (`evidenciaDePago === 'CONFIRMED'`, ya aplicado en `pedidosConEvidenciaDePago`). No reinterpreta
 * `processing`; no fabrica ceros: si la fuente no fue observada, el estado es NOT_AVAILABLE. El margen
 * y la atribución permanecen desconocidos: WooCommerce no demuestra ni el COGS ni el origen del tráfico.
 */
import type { EventStore, RequestContext } from '@soec/contracts';
import { VentasComercioService, type LineaBaseDeVentas } from '@soec/comercio';
import { buscarFuentes } from '../plataforma';
import { VENTANA_DESCONOCIDA, type Ventana } from './economics';

export async function leerVentasCyp(store: EventStore, ctx: RequestContext, org: string): Promise<LineaBaseDeVentas | null> {
  const fuente = buscarFuentes(org).find((f) => f.tipo === 'SALES');
  if (!fuente) return null;
  return new VentasComercioService(store).ultimaLineaBase(ctx, fuente.provider);
}

export interface VentasNormalizadas {
  readonly status: 'CONNECTED_WITH_DATA' | 'CONNECTED_NO_DATA' | 'NOT_AVAILABLE';
  readonly purchases: number | null;
  readonly revenue: number | null;
  readonly revenueUnknown: boolean;
  readonly currency: string | null;
  readonly coverage: string;
  readonly ventana: Ventana;
}

export function normalizarVentas(lb: LineaBaseDeVentas | null): VentasNormalizadas {
  if (lb === null) {
    return {
      status: 'NOT_AVAILABLE',
      purchases: null,
      revenue: null,
      revenueUnknown: true,
      currency: null,
      coverage: 'DESCONOCIDA',
      ventana: VENTANA_DESCONOCIDA,
    };
  }
  const purchases = lb.pedidosConEvidenciaDePago;
  const revenue = lb.ingresoConfirmado.conocido ? lb.ingresoConfirmado.valor : null;
  return {
    status: purchases > 0 ? 'CONNECTED_WITH_DATA' : 'CONNECTED_NO_DATA',
    purchases,
    revenue,
    revenueUnknown: !lb.ingresoConfirmado.conocido,
    currency: lb.moneda,
    coverage: lb.coberturaDelNegocio,
    ventana: { inicio: lb.fechaMin, fin: lb.fechaMax, timezone: 'UTC', freshness: lb.fechaMax },
  };
}
