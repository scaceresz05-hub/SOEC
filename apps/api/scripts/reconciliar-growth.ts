/**
 * apps/api · SCRIPT one-shot · RECONCILIACIÓN CONVERGENTE Growth → SOEC.
 *
 * Cubre el hueco de `registrarReal` (first-wins): cuando SmileFlow reclasifica eventos is_test=false→true
 * DESPUÉS de que SOEC ya los ingirió, un tick normal no los reeleva (cursor avanzado) ni los actualiza
 * (idempotencia por observacionId). Este backfill re-lee TODA la ventana del puente y converge el flag
 * `diagnostico` de cada observación existente a la fuente estructural (`is_test`). NO crea/borra eventos,
 * NO mueve el cursor, NO toca eventos reales. READ del puente + append de reconciliación acotado.
 *
 *   npx tsx apps/api/scripts/reconciliar-growth.ts
 */
import { readFileSync } from 'node:fs';
import { makePool, PgEventStore, runMigrations } from '@soec/event-store/pg';
import { ActorId, OrganizationId, type RequestContext } from '@soec/contracts';
import { SecretStoreEnv } from '@soec/secretos';
import { ObservacionService } from '@soec/motor-medicion';
import type { EsquemaSalida } from '@soec/adaptadores';
import { SmileFlowGrowthAdapter } from '../src/ingesta/smileflow-growth-adapter';
import { IngestaSmileFlowGrowth } from '../src/ingesta/ingesta-smileflow-service';

const ORG = 'org-smileflow';
const ARCHIVO_ENV = 'C:/proyectos/SOEC/.env.google-ads';

const ESQUEMA_EGRESS_GROWTH: EsquemaSalida = {
  operacion: 'growth-events',
  campos: [
    { nombre: 'cursor', tipo: 'string' },
    { nombre: 'limit', tipo: 'string' },
    { nombre: 'since', tipo: 'string' },
  ],
};

function cargarEnv(ruta: string): void {
  let contenido: string;
  try { contenido = readFileSync(ruta, 'utf8'); } catch { return; }
  for (const rawLinea of contenido.split('\n')) {
    const linea = rawLinea.replace(/\r/g, '').trim();
    if (!linea || linea.startsWith('#')) continue;
    const idx = linea.indexOf('=');
    if (idx <= 0) continue;
    const clave = linea.slice(0, idx).trim();
    if (!clave || process.env[clave] !== undefined) continue;
    process.env[clave] = linea.slice(idx + 1).trim();
  }
}

function ctx(org: string): RequestContext {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('reconcile-growth'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: `reconcile-growth-${org}` };
}

async function main(): Promise<void> {
  cargarEnv(ARCHIVO_ENV);
  const pool = makePool();
  try {
    await runMigrations(pool);
    const store = new PgEventStore(pool);
    const secretStore = new SecretStoreEnv(process.env);
    const observaciones = new ObservacionService(store, {} as never);
    const baseUrl = process.env.SMILEFLOW_M2M_URL;
    if (!baseUrl) throw new Error('Falta SMILEFLOW_M2M_URL');
    const adaptadorGrowth = new SmileFlowGrowthAdapter({ secretStore, secretRef: 'env:SMILEFLOW_GROWTH_TOKEN', esquemaEgress: ESQUEMA_EGRESS_GROWTH, baseUrl });
    const ingestaGrowth = new IngestaSmileFlowGrowth({ adaptador: adaptadorGrowth, observaciones, store, org: ORG });

    const r = await ingestaGrowth.reconciliarDiagnostico(ctx(ORG), { ahora: new Date().toISOString() }); // sin `since` = toda la historia
    console.log(JSON.stringify({ reconcileGrowth: r }, null, 2)); // sin secretos
  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
