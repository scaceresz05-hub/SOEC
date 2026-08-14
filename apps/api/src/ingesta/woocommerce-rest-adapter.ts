/**
 * apps/api · FRONTERA · Adaptador de la **REST API v3 privada de WooCommerce** — SOLO LECTURA.
 *
 * Implementa `CommerceSalesReadPort`. Es el único módulo que usa la credencial de la organización, y
 * la usa exclusivamente para LEER.
 *
 * GARANTÍAS DE NO-MUTACIÓN, impuestas por CÓDIGO y no por el permiso configurado en WooCommerce:
 *   · `method: 'GET'` está fijado y no es parametrizable desde fuera;
 *   · la lista de rutas permitidas es CERRADA: `/system_status`, `/orders`, `/products`;
 *   · no existe ninguna función que escriba: el módulo no contiene POST/PUT/PATCH/DELETE ni `/batch`;
 *   · aunque la credencial fuera de escritura, este adaptador no podría mutar nada.
 *
 * GARANTÍAS DE SECRETO:
 *   · la credencial viaja en la cabecera `Authorization: Basic` — NUNCA en la URL, de modo que
 *     ninguna traza, log de servidor o mensaje de error pueda contenerla;
 *   · el valor sólo existe dentro de `SecretoResuelto.usar`;
 *   · los errores incluyen ruta y código HTTP, jamás cabeceras ni credenciales.
 *
 * GARANTÍAS DE PRIVACIDAD: el mapeo a dominio DESCARTA nombre, dirección, email, teléfono, RUT e IP.
 * De la identidad del cliente sólo sobrevive una huella HMAC irreversible y propia de la organización.
 */
import {
  SIN_COSTOS,
  conocido,
  desconocido,
  huellaDeCliente,
  numeroOpcional,
  textoOpcional,
  type AtribucionPedido,
  type CommerceOrderLineObserved,
  type CommerceOrderObserved,
  type CommerceSalesReadPort,
  type CommerceSalesSnapshot,
  type DesconocidoOValor,
  type EstadoDeEntrega,
  type EvidenciaDePago,
  type VerificacionDeAcceso,
} from '@soec/comercio';

/** Rutas GET permitidas. Cerrada por diseño: nada capaz de mutar es alcanzable. */
const RUTAS_PERMITIDAS = ['/system_status', '/orders', '/products'] as const;
type RutaPermitida = (typeof RUTAS_PERMITIDAS)[number];

const POR_PAGINA = 100;
const MAX_PAGINAS = 100;

export class OperacionPrivadaNoPermitidaError extends Error {}

/**
 * Provee la cabecera de autorización SIN que el valor de la credencial salga de su caja opaca.
 * La composición la construye a partir del `SecretStore`; este módulo nunca ve el secreto.
 */
export type ProveedorDeAutorizacion = () => Promise<string>;

export interface OpcionesWooRest {
  /** Base de la REST API, p. ej. `https://tienda.cl/wp-json/wc/v3`. Sólo https en producción. */
  readonly baseUrl: string;
  readonly autorizacion: ProveedorDeAutorizacion;
  readonly fetchImpl?: typeof fetch;
  /** Clave HMAC propia de la organización para seudonimizar clientes. Nunca se registra. */
  readonly claveDeHuella: string;
  readonly userAgent?: string;
}

interface LineaWoo {
  product_id?: number;
  name?: string;
  quantity?: number;
  total?: string;
}
interface DireccionWoo {
  city?: string;
  state?: string;
  country?: string;
  email?: string;
  phone?: string;
}
interface PedidoWoo {
  id: number;
  number?: string;
  status?: string;
  currency?: string;
  date_created_gmt?: string;
  date_paid_gmt?: string;
  date_completed_gmt?: string;
  total?: string;
  discount_total?: string;
  shipping_total?: string;
  total_tax?: string;
  payment_method?: string;
  transaction_id?: string;
  customer_id?: number;
  billing?: DireccionWoo;
  shipping?: DireccionWoo;
  line_items?: LineaWoo[];
  shipping_lines?: { method_id?: string; method_title?: string }[];
}

/** Estados de WooCommerce que la fuente declara como NO pagados. El resto no se presume. */
const ESTADOS_SIN_PAGO = new Set(['cancelled', 'failed', 'refunded', 'pending', 'checkout-draft']);
const ESTADOS_ENTREGADOS = new Set(['completed']);
const ESTADOS_DEVUELTOS = new Set(['refunded']);

export class WooCommerceRestAdapter implements CommerceSalesReadPort {
  readonly source = 'woocommerce-rest-api';
  readonly soloLectura = true as const;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly userAgent: string;

  constructor(private readonly opts: OpcionesWooRest) {
    const url = new URL(opts.baseUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new OperacionPrivadaNoPermitidaError(`protocolo no permitido: ${url.protocol}`);
    }
    if (!opts.claveDeHuella) {
      throw new OperacionPrivadaNoPermitidaError(
        'falta la clave de seudonimización de la organización',
      );
    }
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.userAgent = opts.userAgent ?? 'SOEC/lectura-de-ventas';
  }

  /** ÚNICA salida a la red. GET fijo, ruta de la lista blanca, credencial sólo en la cabecera. */
  private async leer(
    ruta: RutaPermitida,
    params: Record<string, string> = {},
  ): Promise<{ cuerpo: unknown; estado: number; total: number | null }> {
    if (!RUTAS_PERMITIDAS.includes(ruta)) {
      throw new OperacionPrivadaNoPermitidaError(
        `ruta no permitida en el adaptador de lectura: ${ruta}`,
      );
    }
    const url = new URL(this.baseUrl + ruta);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    // Invariante duro: la credencial JAMÁS viaja en la URL.
    if (/consumer_key|consumer_secret/i.test(url.toString())) {
      throw new OperacionPrivadaNoPermitidaError('la credencial no puede viajar en la URL');
    }

    const res = await this.fetchImpl(url.toString(), {
      method: 'GET', // fijo: este adaptador no puede mutar nada
      headers: {
        accept: 'application/json',
        'user-agent': this.userAgent,
        authorization: await this.opts.autorizacion(),
      },
      redirect: 'follow',
    });
    const total = numeroOpcional(res.headers.get('x-wp-total'));
    if (!res.ok) {
      // Mensaje sin cabeceras ni credenciales: sólo ruta y código.
      throw new OperacionPrivadaNoPermitidaError(`la fuente respondió ${res.status} en ${ruta}`);
    }
    return { cuerpo: await res.json(), estado: res.status, total };
  }

  /** Comprueba credencial y permisos con dos GET inocuos. No modifica nada. */
  async verificarAcceso(): Promise<VerificacionDeAcceso> {
    let estadoHttp: number | null = null;
    try {
      const sistema = await this.leer('/system_status');
      estadoHttp = sistema.estado;
    } catch (e) {
      const m = /respondió (\d{3})/.exec(e instanceof Error ? e.message : '');
      return {
        autenticado: false,
        puedeLeerPedidos: false,
        puedeLeerProductos: false,
        estadoHttp: m ? Number(m[1]) : null,
        detalle: e instanceof Error ? e.message : 'fallo desconocido',
      };
    }

    const intentar = async (ruta: RutaPermitida): Promise<boolean> => {
      try {
        await this.leer(ruta, { per_page: '1' });
        return true;
      } catch {
        return false;
      }
    };
    const puedeLeerPedidos = await intentar('/orders');
    const puedeLeerProductos = await intentar('/products');
    return {
      autenticado: true,
      puedeLeerPedidos,
      puedeLeerProductos,
      estadoHttp,
      detalle: 'lectura verificada con GET; no se emitió ninguna operación de escritura',
    };
  }

  async listarPedidos(
    organizationId: string,
    ahora: string,
    opts: { desde?: string; hasta?: string } = {},
  ): Promise<CommerceSalesSnapshot> {
    const advertencias: string[] = [];
    const pedidos: CommerceOrderObserved[] = [];
    let pagina = 1;
    let totalDeclarado: number | null = null;
    let completo = true;

    for (;;) {
      const params: Record<string, string> = {
        per_page: String(POR_PAGINA),
        page: String(pagina),
        orderby: 'date',
        order: 'asc',
        // TODOS los estados: excluir alguno sería decidir por la fuente qué cuenta como venta.
        status: 'any',
      };
      if (opts.desde) params.after = opts.desde;
      if (opts.hasta) params.before = opts.hasta;

      const res = await this.leer('/orders', params);
      if (pagina === 1) totalDeclarado = res.total;
      const lote = Array.isArray(res.cuerpo) ? (res.cuerpo as PedidoWoo[]) : [];
      for (const p of lote) pedidos.push(this.aPedido(organizationId, p, ahora));
      if (lote.length < POR_PAGINA) break;
      pagina += 1;
      if (pagina > MAX_PAGINAS) {
        completo = false;
        advertencias.push(`lectura interrumpida en la página ${MAX_PAGINAS}`);
        break;
      }
    }

    if (totalDeclarado !== null && totalDeclarado !== pedidos.length) {
      completo = false;
      advertencias.push(
        `la fuente declara ${totalDeclarado} pedidos y se leyeron ${pedidos.length}`,
      );
    }

    const camposDesconocidos = ['costo de venta', 'margen', 'atribución de canal'];
    return {
      organizationId,
      source: this.source,
      observedAt: ahora,
      pedidos,
      completo,
      advertencias,
      camposDesconocidos,
    };
  }

  async obtenerPedido(
    organizationId: string,
    externalOrderId: string,
    ahora: string,
  ): Promise<CommerceOrderObserved | null> {
    if (!/^\d+$/.test(externalOrderId)) {
      throw new OperacionPrivadaNoPermitidaError('identificador de pedido inválido');
    }
    const res = await this.leer('/orders', { include: externalOrderId, per_page: '1' });
    const lote = Array.isArray(res.cuerpo) ? (res.cuerpo as PedidoWoo[]) : [];
    const p = lote[0];
    return p ? this.aPedido(organizationId, p, ahora) : null;
  }

  /** Convierte a dominio DESCARTANDO toda PII. Lo que no se puede afirmar, queda desconocido. */
  private aPedido(organizationId: string, p: PedidoWoo, ahora: string): CommerceOrderObserved {
    const estado = textoOpcional(p.status) ?? 'unknown';
    const pagadoEn = textoOpcional(p.date_paid_gmt);
    const transaccion = textoOpcional(p.transaction_id);

    // La EVIDENCIA manda sobre el nombre del estado: `processing` con fecha de pago está PAGADO.
    let evidenciaDePago: EvidenciaDePago = 'UNKNOWN';
    if (pagadoEn !== null || transaccion !== null) evidenciaDePago = 'CONFIRMED';
    else if (ESTADOS_SIN_PAGO.has(estado)) evidenciaDePago = 'NOT_CONFIRMED';

    let estadoDeEntrega: EstadoDeEntrega = 'UNKNOWN';
    if (ESTADOS_DEVUELTOS.has(estado)) estadoDeEntrega = 'RETURNED';
    else if (ESTADOS_ENTREGADOS.has(estado) || textoOpcional(p.date_completed_gmt) !== null)
      estadoDeEntrega = 'FULFILLED';
    else if (estado === 'processing' || estado === 'on-hold') estadoDeEntrega = 'NOT_FULFILLED';

    // Sin instrumentación no hay atribución. No se infiere por referrer ni por fecha.
    const atribucion: AtribucionPedido = 'NOT_AVAILABLE';

    const monto = (v: string | undefined): DesconocidoOValor => {
      const n = numeroOpcional(v);
      return n === null ? desconocido('NO_MEDIDO') : conocido(n);
    };

    // Identidad del cliente: se usa SÓLO para derivar la huella y se descarta acto seguido.
    const identificador =
      textoOpcional(p.billing?.email) ??
      (p.customer_id && p.customer_id > 0 ? `customer:${p.customer_id}` : null) ??
      textoOpcional(p.billing?.phone);
    const huella = identificador
      ? huellaDeCliente(this.opts.claveDeHuella, organizationId, identificador)
      : null;
    const tipo =
      p.customer_id && p.customer_id > 0 ? 'REGISTERED' : identificador ? 'GUEST' : 'UNKNOWN';

    const lineas: CommerceOrderLineObserved[] = (p.line_items ?? []).map((l) => ({
      productoExternalId: l.product_id && l.product_id > 0 ? String(l.product_id) : null,
      nombre: textoOpcional(l.name) ?? '(sin nombre)',
      cantidad: numeroOpcional(l.quantity) ?? 0,
      totalLinea: monto(l.total),
    }));

    const envio = p.shipping_lines?.[0];

    return {
      organizationId,
      procedencia: {
        source: this.source,
        externalId: String(p.id),
        observedAt: ahora,
        // Endpoint sin credenciales ni parámetros de identidad.
        endpoint: `${this.baseUrl}/orders`,
      },
      estadoOriginal: estado,
      evidenciaDePago,
      estadoDeEntrega,
      atribucion,
      creadoEn: textoOpcional(p.date_created_gmt),
      pagadoEn,
      moneda: textoOpcional(p.currency),
      total: monto(p.total),
      descuento: monto(p.discount_total),
      totalDeEnvio: monto(p.shipping_total),
      impuestos: monto(p.total_tax),
      medioDePago: textoOpcional(p.payment_method),
      metodoDeEnvio: textoOpcional(envio?.method_id),
      // Geografía COMERCIAL: país, región y ciudad. Nada de calle, número ni código postal.
      geografia: {
        pais: textoOpcional(p.shipping?.country) ?? textoOpcional(p.billing?.country),
        region: textoOpcional(p.shipping?.state) ?? textoOpcional(p.billing?.state),
        ciudad: textoOpcional(p.shipping?.city) ?? textoOpcional(p.billing?.city),
      },
      cliente: { organizationId, huella, tipo },
      lineas,
      ...SIN_COSTOS,
    };
  }
}
