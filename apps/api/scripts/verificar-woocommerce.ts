/**
 * apps/api · SCRIPT · VERIFICACIÓN DE LA CREDENCIAL PRIVADA DE WOOCOMMERCE (FASE 7.2).
 *
 *   npx tsx apps/api/scripts/verificar-woocommerce.ts [organizationId]
 *
 * Emite exclusivamente peticiones GET a rutas de la lista blanca. No crea, no modifica y no borra
 * nada en WooCommerce. No imprime credenciales, ni cabeceras, ni URLs con parámetros de identidad,
 * ni datos personales del pedido usado como sonda.
 *
 * FAIL-CLOSED: ante 401/403 informa el código y se detiene. No busca otra credencial, no prueba
 * Application Passwords, no degrada la seguridad.
 */
import { ORG_CYP } from '../src/plataforma/negocios/org-cyp';
import {
  adaptadorVentasDe,
  claveDeHuellaDe,
  credencialesDeVentasListas,
  rutaDelDeposito,
} from '../src/plataforma/woocommerce-privado';
import { estadoDeposito } from '../src/plataforma/deposito-secretos';
import { buscarFuente } from '../src/plataforma';

const ORG = process.argv[2] ?? ORG_CYP;

async function main(): Promise<void> {
  const fuente = buscarFuente(ORG, 'woocommerce-rest-api');
  if (!fuente) {
    console.log(
      JSON.stringify({ organizationId: ORG, error: 'SIN_FUENTE_DE_VENTAS_REGISTRADA' }, null, 2),
    );
    process.exitCode = 2;
    return;
  }

  // (1) Presencia del depósito — booleanos, nunca valores.
  const deposito = estadoDeposito(
    ORG,
    fuente.credenciales.map((c) => c.nombreLogico),
  );
  if (!credencialesDeVentasListas(ORG)) {
    console.log(
      JSON.stringify(
        {
          organizationId: ORG,
          AUTHENTICATION: 'NO_INTENTADA',
          motivo: 'CREDENCIALES_NO_DEPOSITADAS',
          deposito: { ruta: rutaDelDeposito(ORG), credenciales: deposito.credenciales },
        },
        null,
        2,
      ),
    );
    process.exitCode = 3;
    return;
  }

  // (2) Clave de seudonimización (se genera una sola vez y se deja en el depósito).
  const { generada } = claveDeHuellaDe(ORG);

  // (3) Verificación con GET inocuos.
  const adaptador = adaptadorVentasDe(ORG);
  const acceso = await adaptador.verificarAcceso();

  console.log(
    JSON.stringify(
      {
        organizationId: ORG,
        source: adaptador.source,
        soloLectura: adaptador.soloLectura,
        claveDeSeudonimizacion: generada ? 'GENERADA_AHORA' : 'YA_EXISTIA',
        AUTHENTICATION: acceso.autenticado ? 'PASS' : 'FAIL',
        READ_ORDERS: acceso.puedeLeerPedidos ? 'PASS' : 'FAIL',
        READ_PRODUCTS: acceso.puedeLeerProductos ? 'PASS' : 'FAIL',
        estadoHttp: acceso.estadoHttp,
        detalle: acceso.detalle,
      },
      null,
      2,
    ),
  );

  if (!acceso.autenticado) {
    console.error('FAIL-CLOSED: la credencial no autenticó. No se intentará ninguna alternativa.');
    process.exitCode = 4;
  }
}

main().catch((e: unknown) => {
  // El mensaje del adaptador nunca contiene credenciales ni cabeceras.
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
