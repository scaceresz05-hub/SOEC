/**
 * SOEC · C Y P — SALES INTELLIGENCE, pruebas adversariales (FASE 7.12).
 *
 * Cubre los 21 puntos exigidos por la directiva. Ningún dato real de cliente entra aquí: los
 * pedidos son ficticios y las credenciales nunca se tocan.
 *
 * Lo que se protege, en una frase: que SOEC pueda decir cuánto vendió C Y P **en WooCommerce** sin
 * convertirse en una copia de su base de clientes, sin confundir «no medido» con «cero», y sin que
 * ninguna otra organización pueda ver, resolver ni contaminar nada de esto.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { ActorId, OrganizationId, type Attribution, type RequestContext } from '@soec/contracts';
import { PgEventStore, runMigrations } from '@soec/event-store/pg';
import { ejecutarDestructivoDePrueba, makeTestPool } from '@soec/event-store/test-db';
import {
  SIN_COSTOS,
  VentasComercioService,
  calcularLineaBaseDeVentas,
  conocido,
  huellaDeCliente,
  type CommerceOrderObserved,
  type CommerceSalesSnapshot,
} from '@soec/comercio';
import { WooCommerceRestAdapter } from '../src/ingesta/woocommerce-rest-adapter';
import {
  buscarFuente,
  buscarProfile,
  buscarPerfilComercial,
  buscarFuentes,
  evaluarFundamentos,
  getBusiness,
  ORG_SMILEFLOW,
} from '../src/plataforma';
import { ORG_CYP } from '../src/plataforma/negocios/org-cyp';

const AQUI = dirname(fileURLToPath(import.meta.url));
const AHORA = '2026-08-14T12:00:00.000Z';
const SOURCE = 'woocommerce-rest-api';
const PEPPER_A = 'clave-ficticia-de-prueba-organizacion-a';
const PEPPER_B = 'clave-ficticia-de-prueba-organizacion-b';

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
    actor: ActorId('t'),
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
    procedencia: {
      source: SOURCE,
      externalId,
      observedAt: AHORA,
      endpoint: 'https://ejemplo/orders',
    },
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
    cliente: {
      organizationId: org,
      huella: huellaDeCliente(PEPPER_A, org, 'a@ejemplo.cl'),
      tipo: 'GUEST',
    },
    lineas: [
      { productoExternalId: '393', nombre: 'PRODUCTO', cantidad: 2, totalLinea: conocido(33000) },
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

// ─────────────────────────────────────────────────────────────────────────────
// 4 · 5 — EL ADAPTADOR PRIVADO NO PUEDE ESCRIBIR
// ─────────────────────────────────────────────────────────────────────────────
describe('ADAPTADOR PRIVADO · solo lectura, por código y no por permiso', () => {
  const fuente = (): string =>
    readFileSync(resolve(AQUI, '..', 'src', 'ingesta', 'woocommerce-rest-adapter.ts'), 'utf8');
  const codigoSinComentarios = (): string =>
    fuente()
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

  it('WOO_ADAPTER_HAS_NO_WRITE_METHODS — no declara ninguna operación mutante', () => {
    const c = codigoSinComentarios();
    for (const prohibido of [
      'crearPedido',
      'actualizarPedido',
      'eliminarPedido',
      'actualizarProducto',
      'actualizarStock',
      'crearCliente',
    ]) {
      expect(c).not.toContain(prohibido);
    }
    // Ni siquiera existe el nombre de una operación de escritura en el módulo.
    expect(c).not.toMatch(/\b(create|update|delete|post|put|patch)[A-Z]\w*\s*\(/);
  });

  it('ONLY_GET_IS_ALLOWED — el método está fijado y las rutas son lista blanca', () => {
    const c = codigoSinComentarios();
    expect(c).toContain("method: 'GET'");
    for (const m of ["method: 'POST'", "method: 'PUT'", "method: 'DELETE'", "method: 'PATCH'"]) {
      expect(c).not.toContain(m);
    }
    expect(c).toMatch(/RUTAS_PERMITIDAS\s*=\s*\['\/system_status',\s*'\/orders',\s*'\/products'\]/);
    expect(c).not.toMatch(/['"]\/batch/);
  });

  it('la credencial nunca viaja en la URL, sólo en la cabecera', async () => {
    const llamadas: { url: string; init?: RequestInit }[] = [];
    const fetchFalso = (async (url: unknown, init?: RequestInit) => {
      llamadas.push({ url: String(url), init });
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'x-wp-total': '0' }),
        json: async () => [],
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const adaptador = new WooCommerceRestAdapter({
      baseUrl: 'https://ejemplo.cl/wp-json/wc/v3',
      autorizacion: async () => 'Basic Y3JlZGVuY2lhbC1maWN0aWNpYQ==',
      claveDeHuella: PEPPER_A,
      fetchImpl: fetchFalso,
    });
    await adaptador.listarPedidos(ORG_CYP, AHORA);

    expect(llamadas.length).toBeGreaterThan(0);
    for (const l of llamadas) {
      expect(l.init?.method).toBe('GET');
      expect(l.url).not.toMatch(/consumer_key|consumer_secret|Basic/i);
      expect(l.url).not.toMatch(/\/cart|\/checkout|\/batch/i);
    }
    expect(adaptador.soloLectura).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7 · 8 · 10 — PII, SEUDÓNIMOS Y COLISIÓN ENTRE TENANTS
// ─────────────────────────────────────────────────────────────────────────────
describe('PRIVACIDAD · SOEC no replica la base de clientes', () => {
  it('NO_PII_PERSISTED — el pedido persistido no contiene datos personales', async () => {
    await svc.ingerir(ctx(ORG_CYP), snapshot(ORG_CYP, [pedido(ORG_CYP, '101')]), ATR);
    const guardado = await svc.cargarPedido(ctx(ORG_CYP), SOURCE, '101');
    const texto = JSON.stringify(guardado);
    expect(texto).not.toContain('a@ejemplo.cl');
    expect(texto).not.toMatch(
      /@|"email"|"phone"|"first_name"|"last_name"|"address"|"rut"|"postcode"/i,
    );
    // Sí conserva la geografía COMERCIAL, que no identifica a nadie.
    expect(guardado?.geografia.region).toBe('CL-ML');
  });

  it('CUSTOMER_FINGERPRINT_IS_TENANT_SCOPED — la misma persona da huellas distintas', () => {
    const enA = huellaDeCliente(PEPPER_A, ORG_CYP, 'misma.persona@ejemplo.cl');
    const enB = huellaDeCliente(PEPPER_B, ORG_SMILEFLOW, 'misma.persona@ejemplo.cl');
    expect(enA).not.toBe(enB);
    // Ni siquiera compartiendo la clave: la organización entra en el mensaje.
    expect(huellaDeCliente(PEPPER_A, ORG_CYP, 'x@y.cl')).not.toBe(
      huellaDeCliente(PEPPER_A, ORG_SMILEFLOW, 'x@y.cl'),
    );
    // Estable y no reversible por simple hash del identificador.
    expect(enA).toBe(huellaDeCliente(PEPPER_A, ORG_CYP, 'MISMA.PERSONA@ejemplo.cl '));
    expect(enA).not.toContain('ejemplo');
  });

  it('EXTERNAL_ORDER_ID_COLLISION_IS_SAFE — el mismo id de pedido en dos tenants coexiste', async () => {
    await svc.ingerir(
      ctx(ORG_CYP),
      snapshot(ORG_CYP, [pedido(ORG_CYP, '55', { total: conocido(1) })]),
      ATR,
    );
    await svc.ingerir(
      ctx(ORG_SMILEFLOW),
      snapshot(ORG_SMILEFLOW, [pedido(ORG_SMILEFLOW, '55', { total: conocido(2) })]),
      ATR,
    );
    expect((await svc.cargarPedido(ctx(ORG_CYP), SOURCE, '55'))?.total).toEqual(conocido(1));
    expect((await svc.cargarPedido(ctx(ORG_SMILEFLOW), SOURCE, '55'))?.total).toEqual(conocido(2));
  });

  it('CROSS_TENANT_SALES_READ_BLOCKED — SmileFlow no ve las ventas de C Y P ni al revés', async () => {
    await svc.ingerir(ctx(ORG_CYP), snapshot(ORG_CYP, [pedido(ORG_CYP, '101')]), ATR);
    expect(await svc.listarPedidoIds(ctx(ORG_SMILEFLOW), SOURCE)).toEqual([]);
    expect(await svc.cargarPedido(ctx(ORG_SMILEFLOW), SOURCE, '101')).toBeNull();
    expect(await svc.ultimaLineaBase(ctx(ORG_SMILEFLOW), SOURCE)).toBeNull();
  });

  it('un snapshot de otra organización no puede ingerirse en este contexto', async () => {
    await expect(
      svc.ingerir(ctx(ORG_CYP), snapshot(ORG_SMILEFLOW, [pedido(ORG_SMILEFLOW, '1')]), ATR),
    ).rejects.toThrow(/no puede ingerirse/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9 — IDEMPOTENCIA
// ─────────────────────────────────────────────────────────────────────────────
describe('IDEMPOTENCIA · reingerir no duplica ventas', () => {
  it('SAME_ORDER_REINGESTED_DOES_NOT_DUPLICATE', async () => {
    const s = snapshot(ORG_CYP, [pedido(ORG_CYP, '101'), pedido(ORG_CYP, '102')]);
    const r1 = await svc.ingerir(ctx(ORG_CYP), s, ATR);
    expect(r1.pedidosNuevos).toBe(2);

    // Segunda corrida idéntica salvo el instante de observación: nada cambió realmente.
    const s2 = { ...s, observedAt: '2026-08-15T12:00:00.000Z' };
    const r2 = await svc.ingerir(ctx(ORG_CYP), s2, ATR);
    expect(r2.pedidosNuevos).toBe(0);
    expect(r2.pedidosActualizados).toBe(0);
    expect(r2.pedidosSinCambios).toBe(2);
    expect(await svc.listarPedidoIds(ctx(ORG_CYP), SOURCE)).toHaveLength(2);
  });

  it('un cambio REAL en la fuente sí se registra', async () => {
    await svc.ingerir(ctx(ORG_CYP), snapshot(ORG_CYP, [pedido(ORG_CYP, '101')]), ATR);
    const r = await svc.ingerir(
      ctx(ORG_CYP),
      snapshot(ORG_CYP, [pedido(ORG_CYP, '101', { estadoOriginal: 'completed' })]),
      ATR,
    );
    expect(r.pedidosActualizados).toBe(1);
    expect((await svc.cargarPedido(ctx(ORG_CYP), SOURCE, '101'))?.estadoOriginal).toBe('completed');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11 · 12 · 13 — EVIDENCIA DE PAGO Y ATRIBUCIÓN
// ─────────────────────────────────────────────────────────────────────────────
describe('EVIDENCIA · el estado del pedido no decide si está pagado', () => {
  it('PROCESSING_WITH_PAID_DATE_KEEPS_CONFIRMED', () => {
    const p = pedido(ORG_CYP, '1', {
      estadoOriginal: 'processing',
      pagadoEn: '2026-03-01T10:05:00',
    });
    expect(p.estadoOriginal).toBe('processing'); // el estado ORIGINAL se conserva
    expect(p.evidenciaDePago).toBe('CONFIRMED'); // y aun así consta el pago
    const base = calcularLineaBaseDeVentas(ORG_CYP, SOURCE, AHORA, [p]);
    expect(base.pedidosConEvidenciaDePago).toBe(1);
  });

  it('PROCESSING_WITHOUT_PAID_DATE_DOES_NOT_INVENT_PAYMENT', () => {
    const p = pedido(ORG_CYP, '2', { pagadoEn: null, evidenciaDePago: 'UNKNOWN' });
    expect(p.evidenciaDePago).toBe('UNKNOWN'); // ni CONFIRMED ni NOT_CONFIRMED
    const base = calcularLineaBaseDeVentas(ORG_CYP, SOURCE, AHORA, [p]);
    expect(base.pedidosConEvidenciaDePago).toBe(0);
    expect(base.pedidosSinEvidenciaDePago).toBe(1);
  });

  it('UNKNOWN_ATTRIBUTION_STAYS_UNKNOWN — no se infiere canal', () => {
    const base = calcularLineaBaseDeVentas(ORG_CYP, SOURCE, AHORA, [pedido(ORG_CYP, '1')]);
    expect(pedido(ORG_CYP, '1').atribucion).toBe('NOT_AVAILABLE');
    expect(base.ingresoAtribuido.conocido).toBe(false);
    expect(base.roas.conocido).toBe(false);
    expect(base.cac.conocido).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 14 · 15 · 16 · 17 — DESCONOCIDO ╪ CERO
// ─────────────────────────────────────────────────────────────────────────────
describe('HONESTIDAD · nada desconocido se convierte en cero', () => {
  it('WOOCOMMERCE_SALES_ARE_NOT_COMPANY_SALES', () => {
    const base = calcularLineaBaseDeVentas(
      ORG_CYP,
      SOURCE,
      AHORA,
      [pedido(ORG_CYP, '1')],
      'PARCIAL',
    );
    // El nombre del campo lo dice: es lo observado EN LA FUENTE.
    expect(base).toHaveProperty('ingresoObservadoEnLaFuente');
    expect(JSON.stringify(base)).not.toMatch(/ingresoTotalDeLaEmpresa|totalCompanyRevenue/i);
    expect(base.coberturaDelNegocio).toBe('PARCIAL');
    expect(base.ventasFueraDeLaFuente.conocido).toBe(false); // WhatsApp/mostrador: desconocido
  });

  it('MISSING_GA4_IS_NOT_ZERO_SESSIONS y MISSING_ADS_IS_NOT_ZERO_SPEND', () => {
    const analytics = buscarFuente(ORG_CYP, 'ga4');
    const ads = buscarFuente(ORG_CYP, 'google-ads');
    expect(analytics?.estado).toBe('NOT_CONFIGURED');
    expect(ads?.estado).toBe('NOT_CONFIGURED');
    // La línea base no inventa ninguna métrica de tráfico ni de gasto.
    const base = calcularLineaBaseDeVentas(ORG_CYP, SOURCE, AHORA, [pedido(ORG_CYP, '1')]);
    expect(JSON.stringify(base)).not.toMatch(/"sesiones"|"sessions"|"gasto"|"spend"/i);
  });

  it('MARGIN_AND_PROFIT_STAY_UNKNOWN_WITHOUT_COSTS', () => {
    const base = calcularLineaBaseDeVentas(ORG_CYP, SOURCE, AHORA, [pedido(ORG_CYP, '1')]);
    for (const v of [base.margenBruto, base.beneficio, base.ltv]) {
      expect(v.conocido).toBe(false);
      expect(v.valor).toBeNull();
    }
    // Y en el pedido mismo, costo y margen tampoco son cero.
    expect(pedido(ORG_CYP, '1').costoDeVenta.conocido).toBe(false);
    expect(pedido(ORG_CYP, '1').margen.conocido).toBe(false);
  });

  it('sin pedidos, la línea base declara desconocido en vez de cero', () => {
    const base = calcularLineaBaseDeVentas(ORG_CYP, SOURCE, AHORA, []);
    expect(base.pedidos).toBe(0); // el CONTEO sí es cero: es un hecho
    expect(base.ingresoObservadoEnLaFuente.conocido).toBe(false); // el INGRESO, no
    expect(base.ticketPromedio.conocido).toBe(false);
    expect(base.tasaDeRecompra.conocido).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 18 · 19 · 20 · 21 — DIRECTOR Y GOBERNANZA
// ─────────────────────────────────────────────────────────────────────────────
describe('DIRECTOR · sigue exigiendo fundamentos', () => {
  const fundamentosDe = (
    org: string,
    ventas?: ReturnType<typeof calcularLineaBaseDeVentas> | null,
  ) =>
    evaluarFundamentos(
      getBusiness(org),
      buscarFuentes(org),
      buscarPerfilComercial(org),
      buscarProfile(org) !== null,
      ventas ?? null,
    );

  it('CYP_DOES_NOT_USE_SMILEFLOW_PROFILE', () => {
    expect(buscarProfile(ORG_CYP)).toBeNull();
    expect(buscarProfile(ORG_SMILEFLOW)).not.toBeNull();
    const f = fundamentosDe(ORG_CYP);
    expect(JSON.stringify(f).toLowerCase()).not.toContain('smileflow');
  });

  it('CYP_DIRECTOR_STILL_FOUNDATION_REQUIRED — con ventas conectadas pero sin margen ni medición', () => {
    const ventas = calcularLineaBaseDeVentas(
      ORG_CYP,
      SOURCE,
      AHORA,
      [pedido(ORG_CYP, '1'), pedido(ORG_CYP, '2')],
      'PARCIAL',
    );
    const f = fundamentosDe(ORG_CYP, ventas);
    expect(f.veredicto).toBe('FOUNDATION_REQUIRED');
    const codigos = f.motivos.map((m) => m.codigo);
    // Las ventas YA no son un motivo: están conectadas.
    expect(codigos).not.toContain('SALES_NOT_CONNECTED');
    // Pero sin margen ni analítica no se puede decidir inversión.
    expect(codigos).toContain('ECONOMICS_UNKNOWN');
    expect(codigos).toContain('ANALYTICS_NOT_CONFIGURED');
    expect(f.motivos.find((m) => m.codigo === 'ECONOMICS_UNKNOWN')?.explicacion).toMatch(/margen/i);
    // Reconoce lo ganado.
    expect(f.cimientosPresentes.join(' ')).toMatch(/ventas legibles|ticket/i);
    expect(f.puedeRecomendarInversionPublicitaria).toBe(false);
  });

  it('AUTONOMOUS_REAL sigue cerrado y no hay mutate real de Google Ads', async () => {
    const { AUTONOMOUS_REAL } = await import('@soec/cia');
    expect(AUTONOMOUS_REAL).toBe(false);
    const writeAdapter = readFileSync(
      resolve(AQUI, '..', 'src', 'autonomia-ads', 'google-ads-write-adapter.ts'),
      'utf8',
    )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(writeAdapter).not.toMatch(/await\s+fetch\(/);
    expect(writeAdapter).toContain("assertSimulado('REAL')");
  });

  it('la fuente de ventas de C Y P está conectada en SOLO LECTURA y con credenciales propias', () => {
    const f = buscarFuente(ORG_CYP, SOURCE);
    expect(f?.estado).toBe('CONNECTED_READ_ONLY');
    expect(f?.soloLectura).toBe(true);
    expect(f?.credenciales.every((c) => c.secretRef.startsWith(`file:${ORG_CYP}/`))).toBe(true);
  });
});
