/**
 * apps/api · SCRIPT one-shot · INGESTA DE CATÁLOGO DE COMERCIO (SOLO LECTURA).
 *
 * Lee el catálogo público de la tienda de una organización y lo persiste como observaciones SOEC
 * bajo ESA organización. No escribe absolutamente nada en la tienda: el adaptador sólo emite GET
 * sobre dos rutas públicas de catálogo y no envía credenciales.
 *
 *   npx tsx apps/api/scripts/ingest-comercio.ts [organizationId]
 *
 * La organización debe estar REGISTRADA y declarar una fuente de catálogo observable; si no, aborta.
 * Nunca cae en la configuración de otra organización.
 */
import { ActorId, OrganizationId, type Attribution, type RequestContext } from '@soec/contracts';
import { makePool, PgEventStore, runMigrations } from '@soec/event-store/pg';
import { CatalogoComercioService } from '@soec/comercio';
import { WooCommerceStoreAdapter } from '../src/ingesta/woocommerce-store-adapter';
import { buscarFuente, getBusiness } from '../src/plataforma';
import { ORG_CYP, STORE_API_CYP } from '../src/plataforma/negocios/org-cyp';

const ORG = process.argv[2] ?? ORG_CYP;

const ATRIB: Attribution = {
  source: 'ingesta-comercio',
  purpose: 'observación de solo lectura del catálogo público de la tienda',
  assumptions: [
    'lectura anónima de la Store API pública; ninguna escritura sobre la tienda',
    'la relación producto↔categoría sólo se afirma cuando la fuente la expone',
  ],
  claimType: 'observational',
  regime: 'empirical',
  uncertainty: 'baja',
};

function ctx(org: string): RequestContext {
  const o = OrganizationId(org);
  return {
    organizationId: o,
    actor: ActorId('ingesta-comercio'),
    scope: { organizationId: o, permissions: ['events:append', 'events:read'] },
    correlationId: `ingesta-comercio-${org}`,
  };
}

/** Base de la Store API por organización. Hoy sólo C Y P tiene tienda observable. */
function storeApiDe(org: string): string {
  if (org === ORG_CYP) return STORE_API_CYP;
  throw new Error(`la organización '${org}' no declara una Store API de catálogo observable`);
}

async function main(): Promise<void> {
  const negocio = getBusiness(ORG); // lanza si no está registrada
  const fuente = buscarFuente(ORG, 'woocommerce-store-api');
  if (!fuente || fuente.estado !== 'OBSERVED') {
    throw new Error(`la fuente de catálogo de '${ORG}' no está en estado OBSERVED`);
  }

  const pool = makePool();
  try {
    await runMigrations(pool);
    const store = new PgEventStore(pool);
    const adaptador = new WooCommerceStoreAdapter({ baseUrl: storeApiDe(ORG) });
    const ahora = new Date().toISOString();

    const snapshot = await adaptador.leerCatalogo(ORG, ahora);
    const resultado = await new CatalogoComercioService(store).ingerir(ctx(ORG), snapshot, ATRIB);

    console.log(
      JSON.stringify(
        {
          organizacion: negocio.organizationId,
          negocio: negocio.displayName,
          source: resultado.source,
          completo: snapshot.completo,
          advertencias: snapshot.advertencias,
          persistidos: {
            productos: resultado.productosPersistidos,
            categorias: resultado.categoriasPersistidas,
          },
          resumen: resultado.resumen,
          hallazgos: resultado.hallazgos.map((h) => ({
            codigo: h.codigo,
            severidad: h.severidad,
            afectados: h.afectados,
            total: h.total,
          })),
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
  console.error(e);
  process.exit(1);
});
