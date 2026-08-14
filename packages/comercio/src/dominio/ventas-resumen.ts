/**
 * @soec/comercio · dominio · LÍNEA BASE DE VENTAS (Sales Intelligence).
 *
 * Deriva, de forma PURA y determinista, sólo lo que el snapshot demuestra. Nada que exija datos
 * ausentes se calcula: margen, beneficio, CAC, ROAS y LTV económico quedan `DesconocidoOValor`,
 * jamás cero.
 *
 * NOMBRE DELIBERADO: `ingresoObservadoEnLaFuente`, no «ingresos de la empresa». Mientras existan
 * canales sin instrumentar (WhatsApp, transferencia, mostrador), esta fuente NO es el 100% del
 * negocio y el tipo lo dice: `coberturaDelNegocio` es `PARCIAL` o `DESCONOCIDA`.
 */
import { desconocido, conocido, type DesconocidoOValor } from './pedido';
import type { CommerceOrderObserved } from './venta';

export interface ConteoPorClave {
  readonly clave: string;
  readonly n: number;
}

export interface IngresoPorClave {
  readonly clave: string;
  readonly pedidos: number;
  readonly unidades: number;
  readonly ingreso: number;
}

export interface LineaBaseDeVentas {
  readonly organizationId: string;
  readonly source: string;
  readonly observedAt: string;

  readonly pedidos: number;
  readonly pedidosConEvidenciaDePago: number;
  readonly pedidosSinEvidenciaDePago: number;
  readonly fechaMin: string | null;
  readonly fechaMax: string | null;
  readonly moneda: string | null;

  /**
   * VALOR BRUTO de los pedidos observados en la fuente (GROSS_ORDER_VALUE_OBSERVED): suma de TODOS
   * los pedidos con total conocido, con pago CONFIRMADO o no. No es revenue ni ingreso de la empresa.
   * Puede incluir pedidos con pago UNKNOWN: es "lo que pasó por la tienda", no "lo que se cobró".
   */
  readonly ingresoObservadoEnLaFuente: DesconocidoOValor;
  /**
   * REVENUE ELEGIBLE (REVENUE_COUNTS_ONLY_ELIGIBLE_ORDERS): suma de los totales de los pedidos con
   * evidencia de pago CONFIRMED, MENOS los reembolsos DEMOSTRABLES sobre esos mismos pedidos. Un
   * pedido `processing` sin fecha de pago NO cuenta aquí aunque figure en el bruto. `UNKNOWN` si
   * ningún pedido confirmado tiene total conocido.
   */
  readonly ingresoConfirmado: DesconocidoOValor;
  /**
   * Reembolsos DEMOSTRABLES aplicados a pedidos confirmados (ya restados de `ingresoConfirmado`).
   * `UNKNOWN` si ningún pedido confirmado expone su lista de reembolsos: no se asume 0.
   */
  readonly reembolsosConfirmados: DesconocidoOValor;
  readonly ticketPromedio: DesconocidoOValor;
  readonly articulosPorPedido: DesconocidoOValor;
  readonly unidadesVendidas: number;

  readonly clientesUnicosSeudonimos: number;
  readonly clientesRecurrentes: number;
  readonly tasaDeRecompra: DesconocidoOValor;
  readonly pedidosDeInvitado: number;
  readonly pedidosDeRegistrado: number;

  readonly estados: readonly ConteoPorClave[];
  readonly mediosDePago: readonly ConteoPorClave[];
  readonly metodosDeEnvio: readonly ConteoPorClave[];
  readonly porMes: readonly IngresoPorClave[];
  readonly porRegion: readonly IngresoPorClave[];
  readonly porProducto: readonly IngresoPorClave[];
  /** Qué parte del ingreso concentran los 5 productos mayores (0..1). `null` si no hay ingreso. */
  readonly concentracionTop5: number | null;

  // ── Lo que NO se puede afirmar con estos datos ───────────────────────────────
  readonly margenBruto: DesconocidoOValor;
  readonly beneficio: DesconocidoOValor;
  readonly cac: DesconocidoOValor;
  readonly roas: DesconocidoOValor;
  readonly ltv: DesconocidoOValor;
  readonly ingresoAtribuido: DesconocidoOValor;
  /** Ventas fuera de esta fuente (WhatsApp, transferencia, mostrador). */
  readonly ventasFueraDeLaFuente: DesconocidoOValor;
  readonly coberturaDelNegocio: 'TOTAL_DEL_NEGOCIO' | 'PARCIAL' | 'DESCONOCIDA';
}

function contar(valores: readonly (string | null)[]): readonly ConteoPorClave[] {
  const m = new Map<string, number>();
  for (const v of valores) {
    const k = v ?? '(desconocido)';
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()]
    .map(([clave, n]) => ({ clave, n }))
    .sort((a, b) => b.n - a.n || a.clave.localeCompare(b.clave));
}

function agrupar(
  pedidos: readonly CommerceOrderObserved[],
  clave: (p: CommerceOrderObserved) => string,
): readonly IngresoPorClave[] {
  const m = new Map<string, { pedidos: number; unidades: number; ingreso: number }>();
  for (const p of pedidos) {
    const k = clave(p);
    const acc = m.get(k) ?? { pedidos: 0, unidades: 0, ingreso: 0 };
    acc.pedidos += 1;
    acc.unidades += p.lineas.reduce((s, l) => s + l.cantidad, 0);
    if (p.total.conocido) acc.ingreso += p.total.valor;
    m.set(k, acc);
  }
  return [...m.entries()]
    .map(([clave2, v]) => ({ clave: clave2, ...v }))
    .sort((a, b) => b.ingreso - a.ingreso || a.clave.localeCompare(b.clave));
}

/**
 * Deriva la línea base. PURA. Sólo se calcula lo demostrable; el resto queda desconocido.
 *
 * @param coberturaDelNegocio la declara la composición a partir del estado de las FUENTES: mientras
 *        haya canales sin instrumentar, es `PARCIAL`. No se deduce de los datos.
 */
export function calcularLineaBaseDeVentas(
  organizationId: string,
  source: string,
  observedAt: string,
  pedidos: readonly CommerceOrderObserved[],
  coberturaDelNegocio: LineaBaseDeVentas['coberturaDelNegocio'] = 'PARCIAL',
): LineaBaseDeVentas {
  const fechas = pedidos
    .map((p) => p.creadoEn)
    .filter((f): f is string => typeof f === 'string')
    .sort();
  const monedas = new Set(
    pedidos.map((p) => p.moneda).filter((m): m is string => typeof m === 'string'),
  );
  const totales = pedidos.map((p) => p.total).filter((t) => t.conocido) as {
    conocido: true;
    valor: number;
  }[];
  const ingreso = totales.reduce((s, t) => s + t.valor, 0);
  const unidades = pedidos.reduce((s, p) => s + p.lineas.reduce((a, l) => a + l.cantidad, 0), 0);

  // REVENUE ELEGIBLE: sólo pedidos con pago CONFIRMED y total conocido, neto de reembolsos
  // DEMOSTRABLES. La ausencia de fecha de pago excluye el pedido; la ausencia de lista de
  // reembolsos deja el reembolso desconocido (no se resta) pero NO inventa un cero.
  const confirmados = pedidos.filter((p) => p.evidenciaDePago === 'CONFIRMED' && p.total.conocido);
  const brutoConfirmado = confirmados.reduce(
    (s, p) => s + (p.total.conocido ? p.total.valor : 0),
    0,
  );
  const reembolsosConocidos = confirmados.reduce(
    (s, p) => s + (p.reembolso.conocido ? p.reembolso.valor : 0),
    0,
  );
  const algunReembolsoDemostrable = confirmados.some((p) => p.reembolso.conocido);

  const huellas = pedidos.map((p) => p.cliente.huella).filter((h): h is string => h !== null);
  const porHuella = new Map<string, number>();
  for (const h of huellas) porHuella.set(h, (porHuella.get(h) ?? 0) + 1);
  const unicos = porHuella.size;
  const recurrentes = [...porHuella.values()].filter((n) => n > 1).length;

  const porProducto = agrupar(
    pedidos.flatMap((p) =>
      p.lineas.map((l) => ({
        ...p,
        lineas: [l],
        // El ingreso por producto usa el total de LÍNEA, no el del pedido.
        total: l.totalLinea,
      })),
    ),
    (p) => p.lineas[0]?.productoExternalId ?? '(desconocido)',
  );
  const ingresoProductos = porProducto.reduce((s, p) => s + p.ingreso, 0);
  const top5 = porProducto.slice(0, 5).reduce((s, p) => s + p.ingreso, 0);

  return {
    organizationId,
    source,
    observedAt,
    pedidos: pedidos.length,
    pedidosConEvidenciaDePago: pedidos.filter((p) => p.evidenciaDePago === 'CONFIRMED').length,
    pedidosSinEvidenciaDePago: pedidos.filter((p) => p.evidenciaDePago !== 'CONFIRMED').length,
    fechaMin: fechas[0] ?? null,
    fechaMax: fechas[fechas.length - 1] ?? null,
    moneda: monedas.size === 1 ? [...monedas][0]! : null,

    ingresoObservadoEnLaFuente: totales.length > 0 ? conocido(ingreso) : desconocido('NO_MEDIDO'),
    ingresoConfirmado:
      confirmados.length > 0
        ? conocido(brutoConfirmado - reembolsosConocidos)
        : desconocido('NO_MEDIDO'),
    reembolsosConfirmados: algunReembolsoDemostrable
      ? conocido(reembolsosConocidos)
      : desconocido('NO_MEDIDO'),
    ticketPromedio:
      totales.length > 0
        ? conocido(Math.round(ingreso / totales.length))
        : desconocido('NO_MEDIDO'),
    articulosPorPedido:
      pedidos.length > 0
        ? conocido(Number((unidades / pedidos.length).toFixed(2)))
        : desconocido('NO_MEDIDO'),
    unidadesVendidas: unidades,

    clientesUnicosSeudonimos: unicos,
    clientesRecurrentes: recurrentes,
    tasaDeRecompra:
      unicos > 0 ? conocido(Number((recurrentes / unicos).toFixed(4))) : desconocido('NO_MEDIDO'),
    pedidosDeInvitado: pedidos.filter((p) => p.cliente.tipo === 'GUEST').length,
    pedidosDeRegistrado: pedidos.filter((p) => p.cliente.tipo === 'REGISTERED').length,

    estados: contar(pedidos.map((p) => p.estadoOriginal)),
    mediosDePago: contar(pedidos.map((p) => p.medioDePago)),
    metodosDeEnvio: contar(pedidos.map((p) => p.metodoDeEnvio)),
    porMes: agrupar(pedidos, (p) => p.creadoEn?.slice(0, 7) ?? '(desconocido)'),
    porRegion: agrupar(pedidos, (p) => p.geografia.region ?? '(desconocida)'),
    porProducto,
    concentracionTop5: ingresoProductos > 0 ? Number((top5 / ingresoProductos).toFixed(4)) : null,

    // Sin fuente de costos ni de publicidad, nada de esto es calculable. Y no vale cero.
    margenBruto: desconocido('FUENTE_NO_CONECTADA'),
    beneficio: desconocido('FUENTE_NO_CONECTADA'),
    cac: desconocido('NO_INSTRUMENTADO'),
    roas: desconocido('NO_INSTRUMENTADO'),
    ltv: desconocido('FUENTE_NO_CONECTADA'),
    ingresoAtribuido: desconocido('NO_INSTRUMENTADO'),
    ventasFueraDeLaFuente: desconocido('FUENTE_NO_CONECTADA'),
    coberturaDelNegocio,
  };
}
