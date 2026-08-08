/**
 * apps/api · SCRIPT one-shot · Ingesta REAL SmileFlow Growth → SOEC.
 *
 * Wirea la frontera real (PgEventStore + SecretStoreEnv + SmileFlowGrowthAdapter) y corre una vez la ingesta,
 * imprimiendo el resumen JSON (sin el token). Ejecutable con:
 *
 *   SMILEFLOW_M2M_URL=... SMILEFLOW_GROWTH_TOKEN=... DATABASE_URL=... \
 *     npx tsx apps/api/scripts/ingest-smileflow-growth.ts
 */
import { makePool, PgEventStore, runMigrations } from '@soec/event-store/pg';
import { ActorId, OrganizationId, type RequestContext } from '@soec/contracts';
import { SecretStoreEnv } from '@soec/secretos';
import { ObservacionService } from '@soec/motor-medicion';
import type { EsquemaSalida } from '@soec/adaptadores';
import { SmileFlowGrowthAdapter } from '../src/ingesta/smileflow-growth-adapter';
import { IngestaSmileFlowGrowth } from '../src/ingesta/ingesta-smileflow-service';

const ORG = 'org-smileflow';

/** Egress cerrado y tipado: sólo cursor/limit/since (strings) pueden salir hacia el proveedor. */
const ESQUEMA_EGRESS: EsquemaSalida = {
  operacion: 'growth-events',
  campos: [
    { nombre: 'cursor', tipo: 'string' },
    { nombre: 'limit', tipo: 'string' },
    { nombre: 'since', tipo: 'string' },
  ],
};

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
  const baseUrl = process.env.SMILEFLOW_M2M_URL;
  if (!baseUrl) throw new Error('Falta SMILEFLOW_M2M_URL');

  const pool = makePool();
  try {
    await runMigrations(pool); // asegura el esquema del event store
    const store = new PgEventStore(pool);
    const secretStore = new SecretStoreEnv(process.env);
    const adaptador = new SmileFlowGrowthAdapter({
      secretStore,
      secretRef: 'env:SMILEFLOW_GROWTH_TOKEN',
      esquemaEgress: ESQUEMA_EGRESS,
      baseUrl,
    });
    const observaciones = new ObservacionService(store, {} as never);
    const ingesta = new IngestaSmileFlowGrowth({ adaptador, observaciones, store, org: ORG });

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
