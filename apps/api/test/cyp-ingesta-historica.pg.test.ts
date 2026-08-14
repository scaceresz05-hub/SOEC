/**
 * SOEC · C Y P — INGESTA HISTÓRICA DE VENTAS (FASE 7.7). Contratos adversariales sobre PostgreSQL real.
 *
 * Protege la primera persistencia del histórico REAL de WooCommerce en el event store de SOEC:
 * que reingerir no duplique nada, que la identidad de pedido sea tenant-scoped, que un producto
 * faltante no borre el pedido, que el enlace a catálogo use el id externo (no el SKU), que lo
 * desconocido siga desconocido, y que ninguna proyección de una organización lea la de otra.
 *
 * Ningún dato real de cliente entra aquí: los pedidos son ficticios y las credenciales nunca se tocan.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ActorId, OrganizationId, type Attribution, type RequestContext } from '@soec/contracts';
import { PgEventStore, runMigrations } from '@soec/event-store/pg';
import { ejecutarDestructivoDePrueba, makeTestPool } from '@soec/event-store/test-db';
import {
  SIN_COSTOS,
  VentasComercioService,
  calcularLineaBaseDeVentas,
  conocido,
  desconocido,
  huellaDeCliente,
  type CommerceOrderObserved,
  type CommerceSalesSnapshot,
} from '@soec/comercio';
import {
  buscarFuentes,
  buscarPerfilComercial,
  buscarProfile,
  evaluarFundamentos,
  getBusiness,
  ORG_SMILEFLOW,
} from '../src/plataforma';
import { ORG_CYP } from '../src/plataforma/negocios/org-cyp';

const AHORA = '2026-08-14T12:00:00.000Z';
const SOURCE = 'woocommerce-rest-api';
const PEPPER = 'clave-ficticia-de-prueba';

const ATR: Attribution = {
  source: 't',
  purpose: 't',
  assumptions: [],
  claimType: 'observational',
  regime: 'empirical',
  uncertainty: 'baja',
};

const pool = makeTestPool();
const store = new PgEventStore(pool);
const svc = new VentasComercioService(store);

function ctx(org: string): RequestContext {
  const o = OrganizationId(org);
  return {
    organizationId: o,
    actor: ActorId('ingesta-test'),
    scope: { organizationId: o, permissions: ['events:append', 'events:read'] },
    correlationId: `c-${org}`,
  };
}

function pedido(
  org: string,
  externalId: string,
  over: Partial<CommerceOrderObserved> = {},
): CommerceOrderObserved {
  return {
    organizationId: org,
    procedencia: { source: SOURCE, externalId, observedAt: AHORA, endpoint: 'https://e/orders' },
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
    cliente: { organizationId: org, huella: huellaDeCliente(PEPPER, org, 'a@ejemplo.cl'), tipo: 'GUEST' },
    lineas: [
      { productoExternalId: '393', nombre: 'Guantes', cantidad: 2, totalLinea: conocido(33000) },
    ],
    ...SIN_COSTOS,
    ...over,
  };
}

function snapshot(org: string, pedidos: readonly CommerceOrderObserved[]): CommerceSalesSnapshot {
  return {
    organizationId: org,
    source: SOURCE,
    observedAt: AHORA,
    pedidos,
    completo: true,
    advertencias: [],
    camposDesconocidos: ['costo de venta', 'margen', 'atribución de canal'],
  };
}

beforeEach(async () => {
  await runMigrations(pool);
  await ejecutarDestructivoDePrueba(pool, 'truncate table events, outbox restart identity cascade');
});
afterAll(async () => {
  await pool.end();
});

describe('C Y P · ingesta histórica — idempotencia y no doble conteo', () => {
  it('ORDER_INGESTION_IS_IDEMPOTENT / SECOND_INGEST_CREATES_ZERO_DUPLICATES', async () => {
    const s = snapshot(ORG_CYP, [pedido(ORG_CYP, '101'), pedido(ORG_CYP, '102')]);
    const r1 = await svc.ingerir(ctx(ORG_CYP), s, ATR);
    expect(r1.pedidosNuevos).toBe(2);

    const r2 = await svc.ingerir(ctx(ORG_CYP), { ...s, observedAt: '2026-08-15T00:00:00.000Z' }, ATR);
    expect(r2.pedidosNuevos).toBe(0);
    expect(r2.pedidosActualizados).toBe(0);
    expect(r2.pedidosSinCambios).toBe(2);
    expect(await svc.listarPedidoIds(ctx(ORG_CYP), SOURCE)).toHaveLength(2);
  });

  it('REVENUE_NOT_DOUBLE_COUNTED / REFUND_NOT_DOUBLE_COUNTED — reingerir no infla revenue ni reembolsos', async () => {
    const s = snapshot(ORG_CYP, [
      pedido(ORG_CYP, '201', { total: conocido(33000), reembolso: conocido(3000) }),
      pedido(ORG_CYP, '202', { total: conocido(20000), reembolso: conocido(0) }),
    ]);
    await svc.ingerir(ctx(ORG_CYP), s, ATR);
    const base1 = await svc.ultimaLineaBase(ctx(ORG_CYP), SOURCE);
    // Reingerir 3 veces más: el hecho no cambia, la proyección tampoco.
    await svc.ingerir(ctx(ORG_CYP), s, ATR);
    await svc.ingerir(ctx(ORG_CYP), s, ATR);
    await svc.ingerir(ctx(ORG_CYP), s, ATR);
    const base2 = await svc.ultimaLineaBase(ctx(ORG_CYP), SOURCE);

    expect(base1?.ingresoConfirmado).toEqual(conocido(50000)); // 33000+20000−3000
    expect(base2?.ingresoConfirmado).toEqual(conocido(50000)); // idéntico tras reingestas
    expect(base2?.reembolsosConfirmados).toEqual(conocido(3000)); // no se acumula 4×
    expect(base2?.pedidos).toBe(2);
    expect(base2?.unidadesVendidas).toBe(4); // 2u × 2 pedidos, no ×4
    expect(await svc.listarPedidoIds(ctx(ORG_CYP), SOURCE)).toHaveLength(2);
  });
});

describe('C Y P · ingesta histórica — identidad, catálogo y desconocido', () => {
  it('ORDER_IDENTITY_IS_TENANT_SCOPED — el mismo externalOrderId en dos organizaciones no colisiona', async () => {
    await svc.ingerir(ctx(ORG_CYP), snapshot(ORG_CYP, [pedido(ORG_CYP, '55', { total: conocido(1) })]), ATR);
    await svc.ingerir(
      ctx(ORG_SMILEFLOW),
      snapshot(ORG_SMILEFLOW, [pedido(ORG_SMILEFLOW, '55', { total: conocido(2) })]),
      ATR,
    );
    expect((await svc.cargarPedido(ctx(ORG_CYP), SOURCE, '55'))?.total).toEqual(conocido(1));
    expect((await svc.cargarPedido(ctx(ORG_SMILEFLOW), SOURCE, '55'))?.total).toEqual(conocido(2));
  });

  it('PRODUCT_LINK_USES_EXTERNAL_ID_NOT_SKU — el producto se agrupa por id externo, no por SKU', () => {
    // Dos líneas con MISMO id externo pero SKU distinto son el MISMO producto en la proyección.
    const p = pedido(ORG_CYP, '301', {
      lineas: [
        { productoExternalId: '393', nombre: 'Guantes SKU-A', cantidad: 1, totalLinea: conocido(10000) },
        { productoExternalId: '393', nombre: 'Guantes SKU-B', cantidad: 1, totalLinea: conocido(10000) },
      ],
    });
    const base = calcularLineaBaseDeVentas(ORG_CYP, SOURCE, AHORA, [p]);
    const real = base.porProducto.filter((x) => x.clave !== '(desconocido)');
    expect(real).toHaveLength(1);
    expect(real[0]!.clave).toBe('393'); // la clave es el id externo
    expect(base.productosConVentasObservadas).toBe(1);
  });

  it('MISSING_PRODUCT_DOES_NOT_DELETE_ORDER — una línea sin id de producto no borra el pedido', async () => {
    const p = pedido(ORG_CYP, '401', {
      total: conocido(19000),
      lineas: [
        { productoExternalId: null, nombre: 'Ítem sin id', cantidad: 1, totalLinea: conocido(19000) },
      ],
    });
    const r = await svc.ingerir(ctx(ORG_CYP), snapshot(ORG_CYP, [p]), ATR);
    expect(r.pedidosNuevos).toBe(1); // el pedido SÍ se persiste
    const base = await svc.ultimaLineaBase(ctx(ORG_CYP), SOURCE);
    expect(base?.pedidos).toBe(1);
    // La línea sin id va a un cubo '(desconocido)', no se inventa un producto ni se descarta.
    expect(base?.porProducto.some((x) => x.clave === '(desconocido)')).toBe(true);
    expect(base?.productosConVentasObservadas).toBe(0); // ningún producto identificable vendió
  });

  it('UNKNOWN_REMAINS_UNKNOWN — sin costos, margen/beneficio/CAC/ROAS siguen desconocidos (no cero)', async () => {
    await svc.ingerir(ctx(ORG_CYP), snapshot(ORG_CYP, [pedido(ORG_CYP, '501')]), ATR);
    const base = await svc.ultimaLineaBase(ctx(ORG_CYP), SOURCE);
    for (const v of [base!.margenBruto, base!.beneficio, base!.cac, base!.roas, base!.ltv]) {
      expect(v.conocido).toBe(false);
      expect(v.valor).toBeNull();
    }
  });
});

describe('C Y P · ingesta histórica — aislamiento y gobernanza del Director', () => {
  it('CYP_PROJECTION_ONLY_READS_CYP / SMILEFLOW_PROJECTION_CANNOT_READ_CYP', async () => {
    await svc.ingerir(ctx(ORG_CYP), snapshot(ORG_CYP, [pedido(ORG_CYP, '601')]), ATR);
    // SmileFlow no ve nada de C Y P:
    expect(await svc.listarPedidoIds(ctx(ORG_SMILEFLOW), SOURCE)).toEqual([]);
    expect(await svc.cargarPedido(ctx(ORG_SMILEFLOW), SOURCE, '601')).toBeNull();
    expect(await svc.ultimaLineaBase(ctx(ORG_SMILEFLOW), SOURCE)).toBeNull();
    // C Y P sólo ve lo suyo:
    expect(await svc.listarPedidoIds(ctx(ORG_CYP), SOURCE)).toEqual(['601']);
  });

  it('NO_ADS_RECOMMENDATION_WITHOUT_ECONOMICS — con ventas pero sin margen, el Director no recomienda invertir', async () => {
    const ventas = calcularLineaBaseDeVentas(ORG_CYP, SOURCE, AHORA, [
      pedido(ORG_CYP, '701'),
      pedido(ORG_CYP, '702'),
    ]);
    const f = evaluarFundamentos(
      getBusiness(ORG_CYP),
      buscarFuentes(ORG_CYP),
      buscarPerfilComercial(ORG_CYP),
      buscarProfile(ORG_CYP) !== null,
      ventas,
    );
    expect(f.veredicto).toBe('FOUNDATION_REQUIRED');
    expect(f.puedeRecomendarInversionPublicitaria).toBe(false);
    const codigos = f.motivos.map((m) => m.codigo);
    expect(codigos).toContain('ECONOMICS_UNKNOWN');
    expect(codigos).toContain('ANALYTICS_NOT_CONFIGURED');
    // No hereda ninguna política de SmileFlow.
    expect(JSON.stringify(f).toLowerCase()).not.toContain('smileflow');
  });
});
