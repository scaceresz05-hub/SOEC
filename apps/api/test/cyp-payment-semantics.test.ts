/**
 * SOEC · C Y P — SEMÁNTICA DE PAGO (FASE 7.6A). Contratos PERMANENTES.
 *
 * En una frase: el NOMBRE del estado de un pedido no decide si está pagado. Lo decide la EVIDENCIA
 * (fecha de pago, referencia de transacción). De ahí se derivan las reglas que este archivo fija:
 *   · `processing` no implica pagado; la ausencia de fecha de pago no inventa un pago;
 *   · el REVENUE cuenta SÓLO pedidos elegibles (pago confirmado) y los reembolsos demostrables lo bajan;
 *   · el VALOR BRUTO puede incluir pedidos con pago desconocido — es "lo que pasó por la tienda";
 *   · nada de PII sobrevive al mapeo; los tenants no se cruzan; C Y P no hereda el perfil de SmileFlow.
 *
 * PURO / SIN base de datos: la clasificación se prueba con un `fetch` falso (no se toca WooCommerce ni
 * credencial real); el revenue, con la línea base determinista.
 */
import { describe, expect, it } from 'vitest';
import {
  SIN_COSTOS,
  calcularLineaBaseDeVentas,
  conocido,
  desconocido,
  huellaDeCliente,
  type CommerceOrderObserved,
} from '@soec/comercio';
import { WooCommerceRestAdapter } from '../src/ingesta/woocommerce-rest-adapter';
import { buscarProfile, ORG_SMILEFLOW } from '../src/plataforma';
import { ORG_CYP } from '../src/plataforma/negocios/org-cyp';

const AHORA = '2026-08-14T12:00:00.000Z';
const SOURCE = 'woocommerce-rest-api';
const PEPPER = 'clave-ficticia-de-prueba';

/** Adaptador de solo lectura sobre un `fetch` falso: devuelve los pedidos Woo dados sin salir a la red. */
async function mapearWoo(pedidosWoo: readonly Record<string, unknown>[]): Promise<CommerceOrderObserved[]> {
  const fetchFalso = (async () => ({
    ok: true,
    status: 200,
    headers: new Headers({ 'x-wp-total': String(pedidosWoo.length) }),
    json: async () => pedidosWoo,
  })) as unknown as typeof fetch;
  const adaptador = new WooCommerceRestAdapter({
    baseUrl: 'https://ejemplo.cl/wp-json/wc/v3',
    autorizacion: async () => 'Basic Y3JlZGVuY2lhbC1maWN0aWNpYQ==',
    claveDeHuella: PEPPER,
    fetchImpl: fetchFalso,
  });
  return (await adaptador.listarPedidos(ORG_CYP, AHORA)).pedidos.slice();
}

/** Pedido de dominio para las pruebas de revenue. Confirmado y sin reembolso salvo que se indique. */
function ped(over: Partial<CommerceOrderObserved> = {}): CommerceOrderObserved {
  return {
    organizationId: ORG_CYP,
    procedencia: { source: SOURCE, externalId: 'x', observedAt: AHORA, endpoint: 'https://e/orders' },
    estadoOriginal: 'processing',
    evidenciaDePago: 'CONFIRMED',
    estadoDeEntrega: 'NOT_FULFILLED',
    atribucion: 'NOT_AVAILABLE',
    creadoEn: '2026-03-01T10:00:00',
    pagadoEn: '2026-03-01T10:05:00',
    moneda: 'CLP',
    total: conocido(33000),
    descuento: conocido(0),
    totalDeEnvio: conocido(0),
    impuestos: conocido(0),
    reembolso: conocido(0),
    medioDePago: 'flowpayment',
    metodoDeEnvio: 'flat_rate',
    geografia: { pais: 'CL', region: 'CL-ML', ciudad: 'Curicó' },
    cliente: { organizationId: ORG_CYP, huella: null, tipo: 'UNKNOWN' },
    lineas: [{ productoExternalId: '1', nombre: 'X', cantidad: 1, totalLinea: conocido(33000) }],
    ...SIN_COSTOS,
    ...over,
  };
}

describe('C Y P · semántica de pago — clasificación por EVIDENCIA', () => {
  it('PROCESSING_DOES_NOT_IMPLY_PAID — `processing` sin fecha de pago ni transacción ⇒ UNKNOWN', async () => {
    const [p] = await mapearWoo([{ id: 1, status: 'processing', total: '1000', currency: 'CLP' }]);
    expect(p!.estadoOriginal).toBe('processing'); // el estado ORIGINAL se conserva tal cual
    expect(p!.evidenciaDePago).toBe('UNKNOWN'); // NO se traduce a pagado por convención
  });

  it('DATE_PAID_CONFIRMS_PAYMENT — con fecha de pago ⇒ CONFIRMED aunque el estado sea `processing`', async () => {
    const [p] = await mapearWoo([
      { id: 2, status: 'processing', date_paid_gmt: '2026-03-01T10:05:00', total: '33000', currency: 'CLP' },
    ]);
    expect(p!.evidenciaDePago).toBe('CONFIRMED');
    expect(p!.pagadoEn).toBe('2026-03-01T10:05:00');
  });

  it('MISSING_DATE_PAID_DOES_NOT_INVENT_PAYMENT — sin fecha de pago no se afirma un pago', async () => {
    const [p] = await mapearWoo([{ id: 3, status: 'on-hold', total: '1000', currency: 'CLP' }]);
    expect(p!.pagadoEn).toBeNull();
    expect(p!.evidenciaDePago).not.toBe('CONFIRMED');
  });

  it('TRANSACTION_REF_IS_SUPPORTING_EVIDENCE — sin fecha de pago pero con transacción ⇒ CONFIRMED', async () => {
    const [p] = await mapearWoo([{ id: 4, status: 'processing', transaction_id: 'FLOW-abc123', total: '1000', currency: 'CLP' }]);
    expect(p!.evidenciaDePago).toBe('CONFIRMED');
  });
});

describe('C Y P · semántica de pago — revenue, bruto y reembolsos', () => {
  it('REVENUE_COUNTS_ONLY_ELIGIBLE_ORDERS — el revenue suma sólo pedidos con pago CONFIRMED', () => {
    const base = calcularLineaBaseDeVentas(ORG_CYP, SOURCE, AHORA, [
      ped({ total: conocido(33000) }), // CONFIRMED
      ped({ evidenciaDePago: 'UNKNOWN', pagadoEn: null, total: conocido(10000) }), // no elegible
    ]);
    expect(base.ingresoConfirmado).toEqual(conocido(33000)); // NO incluye el de pago desconocido
    expect(base.pedidosConEvidenciaDePago).toBe(1);
    expect(base.pedidosSinEvidenciaDePago).toBe(1);
  });

  it('GROSS_ORDER_VALUE_CAN_INCLUDE_UNKNOWN_PAYMENT — el bruto sí incluye el pago desconocido', () => {
    const base = calcularLineaBaseDeVentas(ORG_CYP, SOURCE, AHORA, [
      ped({ total: conocido(33000) }),
      ped({ evidenciaDePago: 'UNKNOWN', pagadoEn: null, total: conocido(10000) }),
    ]);
    // Bruto = 43.000 (todo lo que pasó por la tienda); revenue = 33.000 (sólo lo cobrado).
    expect(base.ingresoObservadoEnLaFuente).toEqual(conocido(43000));
    expect(base.ingresoConfirmado).toEqual(conocido(33000));
  });

  it('REFUNDS_REDUCE_CONFIRMED_REVENUE_WHEN_DEMONSTRABLE — un reembolso demostrable baja el revenue', () => {
    const base = calcularLineaBaseDeVentas(ORG_CYP, SOURCE, AHORA, [
      ped({ total: conocido(33000), reembolso: conocido(3000) }),
    ]);
    expect(base.ingresoConfirmado).toEqual(conocido(30000)); // 33.000 − 3.000
    expect(base.reembolsosConfirmados).toEqual(conocido(3000));
  });

  it('un reembolso DESCONOCIDO no se resta ni se inventa cero (queda visible en el pedido)', () => {
    const base = calcularLineaBaseDeVentas(ORG_CYP, SOURCE, AHORA, [
      ped({ total: conocido(33000), reembolso: desconocido('NO_MEDIDO') }),
    ]);
    expect(base.ingresoConfirmado).toEqual(conocido(33000)); // no se descuenta lo no demostrable
    expect(base.reembolsosConfirmados.conocido).toBe(false); // y NO se afirma que fue 0
  });
});

describe('C Y P · privacidad y aislamiento', () => {
  it('PII_NOT_PERSISTED — el pedido mapeado no conserva email, teléfono ni nombre', async () => {
    const [p] = await mapearWoo([
      {
        id: 5,
        status: 'processing',
        date_paid_gmt: '2026-03-01T10:05:00',
        total: '1000',
        currency: 'CLP',
        customer_id: 9,
        billing: { email: 'juan.perez@ejemplo.cl', phone: '+56990001111', first_name: 'Juan', city: 'Curicó', state: 'CL-ML', country: 'CL' },
      },
    ]);
    const texto = JSON.stringify(p);
    expect(texto).not.toContain('juan.perez@ejemplo.cl');
    expect(texto).not.toContain('+56990001111');
    expect(texto).not.toMatch(/@|"email"|"phone"|"first_name"|"last_name"|"address"|"rut"/i);
    expect(p!.cliente.huella).not.toBeNull(); // sí sobrevive una huella irreversible
    expect(p!.cliente.huella).not.toContain('juan'); // que no revela el identificador
    expect(p!.geografia.region).toBe('CL-ML'); // geografía comercial: no identifica a nadie
  });

  it('TENANT_ISOLATION — la misma persona produce huellas distintas por organización y por clave', () => {
    const a = huellaDeCliente(PEPPER, ORG_CYP, 'misma.persona@ejemplo.cl');
    const b = huellaDeCliente(PEPPER, ORG_SMILEFLOW, 'misma.persona@ejemplo.cl');
    expect(a).not.toBe(b); // distinta organización ⇒ distinta huella (aunque compartan clave)
    expect(huellaDeCliente('otra-clave', ORG_CYP, 'misma.persona@ejemplo.cl')).not.toBe(a);
    expect(a).not.toContain('ejemplo'); // irreversible: no contiene el identificador
  });

  it('CYP_DOES_NOT_INHERIT_SMILEFLOW — C Y P no usa el perfil publicitario de SmileFlow', () => {
    expect(buscarProfile(ORG_CYP)).toBeNull(); // C Y P no tiene perfil de Ads: fundamentos requeridos
    expect(buscarProfile(ORG_SMILEFLOW)).not.toBeNull(); // SmileFlow sí; son mundos separados
  });
});
