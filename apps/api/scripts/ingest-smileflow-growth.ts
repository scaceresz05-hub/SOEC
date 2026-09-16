/**
 * apps/api · SCRIPT one-shot · Ingesta REAL GROWTH → SOEC (por organización).
 *
 * Wirea la frontera real (PgEventStore + SecretStoreEnv + GrowthAdapter) y corre una vez la ingesta,
 * imprimiendo el resumen JSON (sin el token). La fuente —provider, origen, hosts, ruta y credencial— se
 * resuelve del registro de negocios; `SMILEFLOW_M2M_URL` sigue funcionando porque la propia fuente de
 * SmileFlow lo declara como override de su `baseUrl`. Ejecutable con:
 *
 *   SMILEFLOW_GROWTH_TOKEN=... DATABASE_URL=... \
 *     npx tsx apps/api/scripts/ingest-smileflow-growth.ts
 */
import { makePool, PgEventStore, runMigrations } from '@soec/event-store/pg';
import { ActorId, OrganizationId, type RequestContext } from '@soec/contracts';
import { SecretStoreEnv } from '@soec/secretos';
import { ObservacionService } from '@soec/motor-medicion';
import { ESQUEMA_EGRESS_GROWTH, crearGrowthAdapter } from '../src/ingesta/growth-adapter';
import { IngestaGrowth } from '../src/ingesta/ingesta-growth-service';
import { ORG_SMILEFLOW, getFuenteGrowth } from '../src/plataforma';

/**
 * Organización de esta corrida. Sigue siendo una por ejecución, pero su fuente Growth (provider, origen,
 * hosts autorizados, ruta y credencial) se RESUELVE del registro: el script ya no cablea proveedor alguno.
 */
const ORG = process.env.SOEC_INGESTA_ORG ?? ORG_SMILEFLOW;

function ctx(org: string): RequestContext {
  const o = OrganizationId(org);
  return {
    organizationId: o,
    actor: ActorId('ingesta-smileflow'),
    scope: { organizationId: o, permissions: ['events:append', 'events:read'] },
    correlationId: `ingesta-smileflow-${org}`,
  };
}

async function main(): Promise<void> {
  // Fuente GROWTH registrada de la organización. Lanza si no está configurada: nunca hereda la de otra.
  const fuenteGrowth = getFuenteGrowth(ORG);

  const pool = makePool();
  try {
    await runMigrations(pool); // asegura el esquema del event store
    const store = new PgEventStore(pool);
    const secretStore = new SecretStoreEnv(process.env);
    const adaptador = crearGrowthAdapter(fuenteGrowth, {
      secretStore,
      esquemaEgress: ESQUEMA_EGRESS_GROWTH,
      env: process.env,
    });
    const observaciones = new ObservacionService(store, {} as never);
    const ingesta = new IngestaGrowth({ adaptador, observaciones, store, org: ORG, provider: fuenteGrowth.provider });

    const resumen = await ingesta.correrUnaVez(ctx(ORG), { ahora: new Date().toISOString() });
    console.log(JSON.stringify(resumen, null, 2)); // sin token
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
