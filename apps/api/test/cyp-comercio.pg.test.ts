/**
 * SOEC · C Y P — FUNDAMENTOS Y OBSERVABILIDAD DE COMERCIO (FASE 6B).
 *
 * Verifica, con PostgreSQL real (base de PRUEBA), que:
 *   · el catálogo de C Y P es tenant-scoped y no se filtra hacia SmileFlow ni al revés;
 *   · dos organizaciones pueden observar el MISMO `externalId` sin colisionar;
 *   · el SKU NO es clave (129/129 productos sin SKU y aun así identificables);
 *   · el adaptador de WooCommerce es incapaz de mutar la tienda;
 *   · «desconocido» nunca se degrada a «cero»: ventas, margen, analítica y embudo;
 *   · el Director exige FUNDAMENTOS antes de hablar de inversión publicitaria.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { ActorId, OrganizationId, type Attribution, type RequestContext } from '@soec/contracts';
import { runMigrations } from '@soec/event-store/pg';
import { PgEventStore } from '@soec/event-store/pg';
import { ejecutarDestructivoDePrueba, makeTestPool } from '@soec/event-store/test-db';
import {
  CatalogoComercioService,
  FuenteDePedidosNoDisponibleError,
  claveComercial,
  desconocido,
  embudoNoInstrumentado,
  resumirCatalogo,
  type CommerceCatalogSnapshot,
  type CommerceProduct,
  type CommerceOrdersSource,
} from '@soec/comercio';
import {
  WooCommerceStoreAdapter,
  OperacionNoPermitidaError,
} from '../src/ingesta/woocommerce-store-adapter';
import {
  buscarFuentes,
  buscarPerfilComercial,
  buscarProfile,
  evaluarFundamentos,
  getBusiness,
  ORG_SMILEFLOW,
} from '../src/plataforma';
import { ORG_CYP, SOURCE_CATALOGO_CYP } from '../src/plataforma/negocios/org-cyp';

const AQUI = dirname(fileURLToPath(import.meta.url));
const AHORA = '2026-08-14T12:00:00.000Z';
const SOURCE = SOURCE_CATALOGO_CYP;

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
const svc = new CatalogoComercioService(store);

function ctx(org: string): RequestContext {
  const o = OrganizationId(org);
  return {
    organizationId: o,
    actor: ActorId('t'),
    scope: { organizationId: o, permissions: ['events:append', 'events:read'] },
    correlationId: `c-${org}`,
  };
}

/** Producto de prueba: sin SKU, como los 129 reales de la tienda observada. */
function producto(org: string, externalId: string, nombre: string): CommerceProduct {
  return {
    organizationId: org,
    procedencia: {
      source: SOURCE,
      externalId,
      observedAt: AHORA,
      endpoint: 'https://ejemplo/products',
    },
    nombre,
    urlPublica: null,
    sku: null,
    precio: { valor: 1190, valorRegular: 1190, moneda: 'CLP', unidadMinima: 0, enOferta: false },
    disponibilidad: 'EN_STOCK',
    comprable: true,
    imagenes: 1,
    marcas: [],
    atributos: [],
    categoriasDeclaradas: [],
    relacionCategorias: 'NO_DEMOSTRABLE',
  };
}

function snapshot(org: string, productos: readonly CommerceProduct[]): CommerceCatalogSnapshot {
  return {
    organizationId: org,
    source: SOURCE,
    observedAt: AHORA,
    productos,
    categorias: [],
    hallazgos: [],
    completo: true,
    advertencias: [],
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
// AISLAMIENTO DEL CATÁLOGO
// ─────────────────────────────────────────────────────────────────────────────
describe('CATÁLOGO · aislamiento por organización', () => {
  it('CYP_CATALOG_IS_TENANT_SCOPED y SMILEFLOW_CANNOT_READ_CYP_CATALOG', async () => {
    await svc.ingerir(
      ctx(ORG_CYP),
      snapshot(ORG_CYP, [producto(ORG_CYP, '613', 'MASCARILLA 3P')]),
      ATR,
    );

    expect(await svc.listarProductoIds(ctx(ORG_CYP), SOURCE)).toEqual(['613']);
    expect((await svc.cargarProducto(ctx(ORG_CYP), SOURCE, '613'))?.nombre).toBe('MASCARILLA 3P');

    // SmileFlow no ve el catálogo de C Y P ni enumerándolo ni adivinando el identificador.
    expect(await svc.listarProductoIds(ctx(ORG_SMILEFLOW), SOURCE)).toEqual([]);
    expect(await svc.cargarProducto(ctx(ORG_SMILEFLOW), SOURCE, '613')).toBeNull();
    expect(await svc.ultimoCatalogo(ctx(ORG_SMILEFLOW), SOURCE)).toBeNull();
  });

  it('CYP_CANNOT_READ_SMILEFLOW_DATA — la dirección inversa también está cerrada', async () => {
    await svc.ingerir(
      ctx(ORG_SMILEFLOW),
      snapshot(ORG_SMILEFLOW, [producto(ORG_SMILEFLOW, '999', 'PRODUCTO AJENO')]),
      ATR,
    );
    expect(await svc.listarProductoIds(ctx(ORG_CYP), SOURCE)).toEqual([]);
    expect(await svc.cargarProducto(ctx(ORG_CYP), SOURCE, '999')).toBeNull();
  });

  it('EXTERNAL_ID_COLLISION_IS_SAFE — el mismo externalId en dos organizaciones coexiste', async () => {
    await svc.ingerir(ctx(ORG_CYP), snapshot(ORG_CYP, [producto(ORG_CYP, '613', 'DE C Y P')]), ATR);
    await svc.ingerir(
      ctx(ORG_SMILEFLOW),
      snapshot(ORG_SMILEFLOW, [producto(ORG_SMILEFLOW, '613', 'DE SMILEFLOW')]),
      ATR,
    );

    expect((await svc.cargarProducto(ctx(ORG_CYP), SOURCE, '613'))?.nombre).toBe('DE C Y P');
    expect((await svc.cargarProducto(ctx(ORG_SMILEFLOW), SOURCE, '613'))?.nombre).toBe(
      'DE SMILEFLOW',
    );
    // La clave lógica incluye la organización: por eso no colisionan.
    expect(claveComercial(ORG_CYP, SOURCE, '613')).not.toBe(
      claveComercial(ORG_SMILEFLOW, SOURCE, '613'),
    );
  });

  it('un snapshot de otra organización no puede ingerirse en este contexto', async () => {
    await expect(
      svc.ingerir(ctx(ORG_CYP), snapshot(ORG_SMILEFLOW, [producto(ORG_SMILEFLOW, '1', 'x')]), ATR),
    ).rejects.toThrow(/no puede ingerirse/i);
  });

  it('SKU_IS_NOT_PRIMARY_KEY — 129 productos sin SKU siguen siendo identificables uno a uno', async () => {
    const muchos = Array.from({ length: 129 }, (_, i) =>
      producto(ORG_CYP, String(1000 + i), `P${i}`),
    );
    expect(muchos.every((p) => p.sku === null)).toBe(true);
    await svc.ingerir(ctx(ORG_CYP), snapshot(ORG_CYP, muchos), ATR);

    const ids = await svc.listarProductoIds(ctx(ORG_CYP), SOURCE);
    expect(ids).toHaveLength(129); // si el SKU fuera clave, colapsarían en 1
    expect(resumirCatalogo(snapshot(ORG_CYP, muchos)).conSku).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EL ADAPTADOR NO PUEDE MUTAR LA TIENDA
// ─────────────────────────────────────────────────────────────────────────────
describe('ADAPTADOR · sólo lectura, demostrable', () => {
  it('PUBLIC_WOO_ADAPTER_IS_READ_ONLY — sólo emite GET y sin credenciales', async () => {
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

    const adaptador = new WooCommerceStoreAdapter({
      baseUrl: 'https://ejemplo.cl/wp-json/wc/store/v1',
      fetchImpl: fetchFalso,
    });
    await adaptador.leerCatalogo(ORG_CYP, AHORA);

    expect(llamadas.length).toBeGreaterThan(0);
    for (const l of llamadas) {
      expect(l.init?.method).toBe('GET');
      const headers = (l.init?.headers ?? {}) as Record<string, string>;
      expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain('authorization');
      expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain('cookie');
      // Nunca toca rutas capaces de mutar.
      expect(l.url).not.toMatch(/\/cart|\/checkout|\/order|\/batch/i);
    }
    expect(adaptador.soloLectura).toBe(true);
  });

  it('NO_WOOCOMMERCE_MUTATION — el módulo no contiene ninguna operación de escritura', () => {
    const bruto = readFileSync(
      resolve(AQUI, '..', 'src', 'ingesta', 'woocommerce-store-adapter.ts'),
      'utf8',
    );
    // Se analiza el CÓDIGO, sin comentarios: la documentación nombra las rutas prohibidas
    // precisamente para explicar que no se usan, y no debe disparar el detector.
    const codigo = bruto.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    for (const prohibido of [
      "method: 'POST'",
      "method: 'PUT'",
      "method: 'DELETE'",
      "method: 'PATCH'",
    ]) {
      expect(codigo).not.toContain(prohibido);
    }
    expect(codigo).not.toMatch(/['"]\/(cart|checkout|orders?|batch)\b/);
    // El método HTTP está fijado en código, no es parametrizable.
    expect(codigo).toContain("method: 'GET'");
    // La lista blanca de rutas es cerrada y sólo contiene catálogo.
    expect(codigo).toMatch(/RUTAS_PERMITIDAS\s*=\s*\['\/products',\s*'\/products\/categories'\]/);
  });

  it('el protocolo y las rutas están restringidos', () => {
    expect(() => new WooCommerceStoreAdapter({ baseUrl: 'ftp://x/y' })).toThrow(
      OperacionNoPermitidaError,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DESCONOCIDO ╪ CERO
// ─────────────────────────────────────────────────────────────────────────────
describe('HONESTIDAD · lo desconocido nunca se reporta como cero', () => {
  it('UNKNOWN_SALES_IS_NOT_ZERO — la fuente de pedidos no puede afirmar «no hay ventas»', async () => {
    const fuentePedidos: CommerceOrdersSource = {
      source: 'woocommerce-orders',
      soloLectura: true,
      estado: 'CREDENTIALS_REQUIRED',
      leerPedidos: async () => {
        throw new FuenteDePedidosNoDisponibleError('woocommerce-orders', 'CREDENTIALS_REQUIRED');
      },
    };
    await expect(fuentePedidos.leerPedidos(ORG_CYP, AHORA, AHORA)).rejects.toBeInstanceOf(
      FuenteDePedidosNoDisponibleError,
    );
    // El contrato impide afirmar «no hay ventas» cuando la fuente no es legible: lanza en vez de
    // devolver una lista vacía. (Desde FASE 7 la fuente de C Y P SÍ está conectada en solo lectura;
    // lo que aquí se prueba es el invariante del puerto, no el estado actual de esa organización.)
    const ventas = buscarFuentes(ORG_CYP).find((f) => f.tipo === 'SALES');
    expect(ventas?.estado).toBe('CONNECTED_READ_ONLY');
    expect(ventas?.soloLectura).toBe(true);
  });

  it('UNKNOWN_MARGIN_IS_NOT_ZERO — toda la economía es desconocida, no cero', () => {
    const perfil = buscarPerfilComercial(ORG_CYP);
    expect(perfil).not.toBeNull();
    const e = perfil!.economia;
    for (const v of Object.values(e)) {
      expect(v.conocido).toBe(false);
      expect(v.valor).toBeNull();
    }
    // El tipo obliga a mirar `conocido` antes de leer `valor`: no hay forma de leer un 0.
    expect(desconocido('NO_MEDIDO').valor).toBeNull();
  });

  it('ANALYTICS_NOT_CONFIGURED_IS_NOT_ZERO — el embudo no reporta ceros', () => {
    const analytics = buscarFuentes(ORG_CYP).find((f) => f.tipo === 'ANALYTICS');
    expect(analytics?.estado).toBe('NOT_CONFIGURED');

    const embudo = embudoNoInstrumentado(ORG_CYP);
    expect(embudo.evaluable).toBe(false);
    expect(embudo.pasos).toHaveLength(7);
    for (const paso of embudo.pasos) {
      expect(paso.estado).toBe('NO_INSTRUMENTADO');
      // El tipo hace imposible que un paso no instrumentado tenga un conteo.
      expect((paso as { eventos?: number }).eventos).toBeUndefined();
    }
    expect(JSON.stringify(embudo)).not.toContain('"eventos":0');
  });

  it('el envío «$0» del checkout no se interpreta como ingreso ni costo cero', () => {
    const envio = buscarFuentes(ORG_CYP).find((f) => f.tipo === 'SHIPPING');
    expect(envio?.estado).toBe('PARTIAL_CONFIGURATION');
    expect(envio?.faltantes.join(' ')).toMatch(/por pagar|externo/i);
  });

  it('WhatsApp existe pero su contribución es desconocida: no se le atribuyen ventas', () => {
    const perfil = buscarPerfilComercial(ORG_CYP)!;
    const wa = perfil.canales.find((c) => c.canal === 'WHATSAPP');
    expect(wa?.estado).toBe('CONNECTED_UNKNOWN');
    expect(wa?.contribucionComercial.conocido).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EL DIRECTOR EXIGE FUNDAMENTOS
// ─────────────────────────────────────────────────────────────────────────────
describe('DIRECTOR · fundamentos antes que inversión', () => {
  const fundamentosDe = (org: string) =>
    evaluarFundamentos(
      getBusiness(org),
      buscarFuentes(org),
      buscarPerfilComercial(org),
      buscarProfile(org) !== null,
    );

  it('CYP_DIRECTOR_REQUIRES_FOUNDATION — veredicto FOUNDATION_REQUIRED con motivos estructurados', () => {
    const f = fundamentosDe(ORG_CYP);
    expect(f.veredicto).toBe('FOUNDATION_REQUIRED');
    const codigos = f.motivos.map((m) => m.codigo);
    expect(codigos).toContain('ANALYTICS_NOT_CONFIGURED');
    // Desde FASE 7 las ventas SÍ son legibles: ya no es un motivo. Los demás siguen en pie.
    expect(codigos).not.toContain('SALES_NOT_CONNECTED');
    expect(codigos).toContain('ECONOMICS_UNKNOWN');
    expect(codigos).toContain('NATIONWIDE_SHIPPING_NOT_READY');
    // Nunca autoriza inversión publicitaria: es del tipo literal `false`.
    expect(f.puedeRecomendarInversionPublicitaria).toBe(false);
    // Y reconoce lo que SÍ está: el catálogo es observable.
    expect(f.cimientosPresentes.join(' ')).toMatch(/catálogo/i);
  });

  it('CYP_DOES_NOT_INHERIT_SMILEFLOW_POLICY — sin política propia, y sin la ajena', () => {
    expect(buscarProfile(ORG_CYP)).toBeNull();
    const f = fundamentosDe(ORG_CYP);
    expect(f.motivos.map((m) => m.codigo)).toContain('BUSINESS_PROFILE_NOT_CONFIGURED');
    // Nada del veredicto menciona a la otra organización ni sus recursos.
    const s = JSON.stringify(f).toLowerCase();
    expect(s).not.toContain('smileflow');
    expect(s).not.toContain('24120966895');
    // SmileFlow conserva la suya.
    expect(buscarProfile(ORG_SMILEFLOW)).not.toBeNull();
  });

  it('el veredicto de C Y P NO es el OBSERVAR de SmileFlow: son estados semánticamente distintos', () => {
    // SmileFlow sí tiene política; su estado de fundamentos no puede ser FOUNDATION_REQUIRED
    // por las mismas causas que C Y P.
    const cyp = fundamentosDe(ORG_CYP);
    const sf = fundamentosDe(ORG_SMILEFLOW);
    expect(cyp.veredicto).toBe('FOUNDATION_REQUIRED');
    expect(sf.motivos.map((m) => m.codigo)).not.toContain('BUSINESS_PROFILE_NOT_CONFIGURED');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EL MODELO ES GENÉRICO
// ─────────────────────────────────────────────────────────────────────────────
describe('MODELO · reutilizable por una tercera organización de comercio', () => {
  it('THIRD_ECOMMERCE_ORG_CAN_REUSE_MODEL — el mismo servicio sirve a otra organización', async () => {
    const TERCERA = 'org-tercera-comercio-de-prueba';
    await svc.ingerir(
      ctx(TERCERA),
      snapshot(TERCERA, [producto(TERCERA, '613', 'DE LA TERCERA')]),
      ATR,
    );

    expect((await svc.cargarProducto(ctx(TERCERA), SOURCE, '613'))?.nombre).toBe('DE LA TERCERA');
    // Sin colisión con las otras dos, pese al mismo externalId.
    expect(await svc.cargarProducto(ctx(ORG_CYP), SOURCE, '613')).toBeNull();
    expect(await svc.cargarProducto(ctx(ORG_SMILEFLOW), SOURCE, '613')).toBeNull();
  });

  it('el modelo de comercio no nombra a ninguna empresa ni plataforma', () => {
    const raiz = resolve(AQUI, '..', '..', '..', 'packages', 'comercio', 'src');
    for (const rel of [
      'index.ts',
      'puertos.ts',
      'dominio/catalogo.ts',
      'dominio/pedido.ts',
      'dominio/embudo.ts',
    ]) {
      const fuente = readFileSync(resolve(raiz, rel), 'utf8');
      expect(fuente).not.toMatch(/\bCyp[A-Z]/); // nada de CypProduct, CypOrder…
      expect(fuente).not.toMatch(/distribuidoracyp|smileflow/i);
      expect(fuente).not.toMatch(/\bWooCommerce[A-Z]\w*\s*(class|interface)/);
    }
  });
});
