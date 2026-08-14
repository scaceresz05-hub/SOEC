/**
 * apps/api · SCRIPT · INGESTA DE VENTAS (SOLO LECTURA sobre WooCommerce).
 *
 *   npx tsx apps/api/scripts/ingest-ventas.ts [organizationId] [--persistir]
 *
 * Sin `--persistir` hace DRY RUN: lee el histórico completo y emite un preview SIN PII, sin escribir
 * absolutamente nada (ni en WooCommerce, que es sólo lectura por construcción, ni en SOEC).
 *
 * Con `--persistir` guarda las observaciones EN SOEC bajo la organización indicada. WooCommerce
 * nunca se modifica: el adaptador no tiene forma de emitir una escritura.
 *
 * El preview no contiene nombres, direcciones, emails, teléfonos ni identificadores de cliente:
 * la recurrencia se cuenta con huellas HMAC irreversibles y propias de la organización.
 */
import { ActorId, OrganizationId, type Attribution, type RequestContext } from '@soec/contracts';
import { makePool, PgEventStore, runMigrations } from '@soec/event-store/pg';
import { VentasComercioService, calcularLineaBaseDeVentas } from '@soec/comercio';
import { ORG_CYP } from '../src/plataforma/negocios/org-cyp';
import {
  adaptadorVentasDe,
  credencialesDeVentasListas,
} from '../src/plataforma/woocommerce-privado';
import { buscarFuentes } from '../src/plataforma';

const ORG = process.argv.find((a) => a.startsWith('org-')) ?? ORG_CYP;
const PERSISTIR = process.argv.includes('--persistir');

const ATRIB: Attribution = {
  source: 'ingesta-ventas',
  purpose: 'observación de solo lectura del histórico de pedidos de la tienda',
  assumptions: [
    'lectura autenticada de solo lectura; ninguna escritura sobre la tienda',
    'la evidencia de pago deriva de la fecha/referencia de pago, no del nombre del estado',
    'esta fuente NO representa necesariamente el 100% de las ventas del negocio',
  ],
  claimType: 'observational',
  regime: 'empirical',
  uncertainty: 'baja',
};

function ctx(org: string): RequestContext {
  const o = OrganizationId(org);
  return {
    organizationId: o,
    actor: ActorId('ingesta-ventas'),
    scope: { organizationId: o, permissions: ['events:append', 'events:read'] },
    correlationId: `ingesta-ventas-${org}`,
  };
}

/**
 * Cobertura del negocio: mientras existan canales con estado desconocido (WhatsApp, mostrador),
 * esta fuente es PARCIAL. Se deriva del REGISTRO DE FUENTES, no de los datos.
 */
function coberturaDe(org: string): 'TOTAL_DEL_NEGOCIO' | 'PARCIAL' | 'DESCONOCIDA' {
  const fuentes = buscarFuentes(org);
  const hayCanalesNoMedibles = fuentes.some(
    (f) =>
      f.estado === 'CONNECTED_UNKNOWN' || (f.tipo === 'MESSAGING' && f.estado !== 'NOT_APPLICABLE'),
  );
  return hayCanalesNoMedibles ? 'PARCIAL' : 'DESCONOCIDA';
}

async function main(): Promise<void> {
  if (!credencialesDeVentasListas(ORG)) {
    console.error(`credenciales de ventas no depositadas para '${ORG}'. FAIL-CLOSED.`);
    process.exit(3);
  }

  const ahora = new Date().toISOString();
  const adaptador = adaptadorVentasDe(ORG);
  const snapshot = await adaptador.listarPedidos(ORG, ahora);
  const lineaBase = calcularLineaBaseDeVentas(
    ORG,
    snapshot.source,
    ahora,
    snapshot.pedidos,
    coberturaDe(ORG),
  );

  // ── PREVIEW SIN PII ─────────────────────────────────────────────────────────
  const preview = {
    modo: PERSISTIR ? 'PERSISTENCIA' : 'DRY_RUN',
    organizationId: ORG,
    source: snapshot.source,
    lecturaCompleta: snapshot.completo,
    advertencias: snapshot.advertencias,
    camposDesconocidos: snapshot.camposDesconocidos,

    ORDERS_DISCOVERED: lineaBase.pedidos,
    DATE_MIN: lineaBase.fechaMin,
    DATE_MAX: lineaBase.fechaMax,
    CURRENCY: lineaBase.moneda,
    TOTAL_OBSERVED: lineaBase.ingresoObservadoEnLaFuente,
    AVERAGE_ORDER_VALUE: lineaBase.ticketPromedio,
    ITEMS_PER_ORDER: lineaBase.articulosPorPedido,
    PRODUCT_LINES: lineaBase.unidadesVendidas,
    PAID_EVIDENCE_COUNT: {
      CONFIRMED: lineaBase.pedidosConEvidenciaDePago,
      NO_CONFIRMADO_O_DESCONOCIDO: lineaBase.pedidosSinEvidenciaDePago,
    },
    STATUS_COUNTS: lineaBase.estados,
    PAYMENT_METHOD_COUNTS: lineaBase.mediosDePago,
    SHIPPING_METHOD_COUNTS: lineaBase.metodosDeEnvio,
    REGION_COUNTS: lineaBase.porRegion.map((r) => ({ clave: r.clave, pedidos: r.pedidos })),
    UNIQUE_CUSTOMER_FINGERPRINTS: lineaBase.clientesUnicosSeudonimos,
    REPEAT_CUSTOMERS: lineaBase.clientesRecurrentes,
    GUEST_VS_REGISTERED: {
      invitado: lineaBase.pedidosDeInvitado,
      registrado: lineaBase.pedidosDeRegistrado,
    },
    SALES_BY_MONTH: lineaBase.porMes,
    TOP_PRODUCTS: lineaBase.porProducto.slice(0, 10),
    REVENUE_CONCENTRATION_TOP5: lineaBase.concentracionTop5,
    COBERTURA_DEL_NEGOCIO: lineaBase.coberturaDelNegocio,
    NO_DEMOSTRABLE: {
      margenBruto: lineaBase.margenBruto,
      beneficio: lineaBase.beneficio,
      cac: lineaBase.cac,
      roas: lineaBase.roas,
      ltv: lineaBase.ltv,
      ingresoAtribuido: lineaBase.ingresoAtribuido,
      ventasFueraDeLaFuente: lineaBase.ventasFueraDeLaFuente,
    },
  };

  // Salvaguarda: el preview NO debe contener PII. Se comprueba antes de imprimir.
  const serializado = JSON.stringify(preview);
  if (/@|\+?56\d{8}|"email"|"phone"|"first_name"|"last_name"|"address"/i.test(serializado)) {
    console.error('ABORTADO: el preview contendría datos personales.');
    process.exit(5);
  }
  console.log(serializado === '' ? '{}' : JSON.stringify(preview, null, 2));

  if (!PERSISTIR) {
    console.log('\nDRY RUN: no se escribió nada, ni en WooCommerce ni en SOEC.');
    return;
  }

  const pool = makePool();
  try {
    await runMigrations(pool);
    const resultado = await new VentasComercioService(new PgEventStore(pool)).ingerir(
      ctx(ORG),
      snapshot,
      ATRIB,
      coberturaDe(ORG),
    );
    console.log(
      JSON.stringify(
        {
          persistido: {
            organizationId: resultado.organizationId,
            source: resultado.source,
            pedidosLeidos: resultado.pedidosLeidos,
            pedidosNuevos: resultado.pedidosNuevos,
            pedidosActualizados: resultado.pedidosActualizados,
            pedidosSinCambios: resultado.pedidosSinCambios,
          },
        },
        null,
        2,
      ),
    );
  } finally {
    await pool.end();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
