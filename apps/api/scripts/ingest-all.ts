/**
 * apps/api · SCRIPT one-shot · Ingesta AUTÓNOMA multi-fuente (Growth + Google Ads) → SOEC.
 *
 * Entrypoint pensado para una tarea programada. Carga secretos desde un archivo gitignored
 * `C:/proyectos/SOEC/.env.google-ads` (KEY=VALUE, sin dotenv, sin sobrescribir process.env ya seteado), wirea
 * la frontera real (PgEventStore + SecretStoreEnv + GoogleAdsAdapter/SmileFlowGrowthAdapter) y corre el
 * scheduler UNA vez, imprimiendo el resumen JSON SIN secretos. Ejecutable con:
 *
 *   npx tsx apps/api/scripts/ingest-all.ts
 */
import { readFileSync } from 'node:fs';
import { makePool, PgEventStore, runMigrations } from '@soec/event-store/pg';
import { ActorId, OrganizationId, type RequestContext } from '@soec/contracts';
import { SecretStoreEnv } from '@soec/secretos';
import { ObservacionService } from '@soec/motor-medicion';
import type { EsquemaSalida } from '@soec/adaptadores';
import { GoogleAdsAdapter } from '../src/ingesta/google-ads-adapter';
import { IngestaGoogleAds } from '../src/ingesta/ingesta-google-ads-service';
import { SmileFlowGrowthAdapter } from '../src/ingesta/smileflow-growth-adapter';
import { IngestaSmileFlowGrowth } from '../src/ingesta/ingesta-smileflow-service';
import { SchedulerIngesta } from '../src/ingesta/scheduler';
import { LecturaDirectorRealService } from '../src/real-director/lectura-director-real';
import { PlanAccionDryRunService } from '../src/autonomia-ads/plan-accion-service';
import { G2AService } from '../src/autonomia-ads/g2a-service';

const ORG = 'org-smileflow';
const ARCHIVO_ENV = 'C:/proyectos/SOEC/.env.google-ads';

/** Egress cerrado y tipado para Google Ads: sólo query/customerId (strings) pueden salir. READ ONLY. */
const ESQUEMA_EGRESS_ADS: EsquemaSalida = {
  operacion: 'ingesta-ads',
  campos: [
    { nombre: 'query', tipo: 'string' },
    { nombre: 'customerId', tipo: 'string' },
  ],
};

/** Egress cerrado y tipado para Growth: sólo cursor/limit/since (strings). */
const ESQUEMA_EGRESS_GROWTH: EsquemaSalida = {
  operacion: 'growth-events',
  campos: [
    { nombre: 'cursor', tipo: 'string' },
    { nombre: 'limit', tipo: 'string' },
    { nombre: 'since', tipo: 'string' },
  ],
};

/** Carga un archivo KEY=VALUE a process.env sin sobrescribir lo ya seteado. Strip de \r y espacios. */
function cargarEnv(ruta: string): void {
  let contenido: string;
  try {
    contenido = readFileSync(ruta, 'utf8');
  } catch {
    return; // el archivo es opcional: si no está, se confía en process.env
  }
  for (const rawLinea of contenido.split('\n')) {
    const linea = rawLinea.replace(/\r/g, '').trim();
    if (!linea || linea.startsWith('#')) continue;
    const idx = linea.indexOf('=');
    if (idx <= 0) continue;
    const clave = linea.slice(0, idx).trim();
    const valor = linea.slice(idx + 1).trim();
    if (!clave || process.env[clave] !== undefined) continue; // respeta lo ya seteado
    process.env[clave] = valor;
  }
}

function ctx(org: string): RequestContext {
  const o = OrganizationId(org);
  return {
    organizationId: o,
    actor: ActorId('ingesta-scheduler'),
    scope: { organizationId: o, permissions: ['events:append', 'events:read'] },
    correlationId: `ingesta-scheduler-${org}`,
  };
}

async function main(): Promise<void> {
  cargarEnv(ARCHIVO_ENV);

  const pool = makePool();
  try {
    await runMigrations(pool); // asegura el esquema del event store
    const store = new PgEventStore(pool);
    const secretStore = new SecretStoreEnv(process.env);
    const observaciones = new ObservacionService(store, {} as never);

    // ── Fuente: Google Ads (READ ONLY) ────────────────────────────────────────
    const loginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
    const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
    if (!loginCustomerId || !customerId) throw new Error('Faltan GOOGLE_ADS_LOGIN_CUSTOMER_ID / GOOGLE_ADS_CUSTOMER_ID');
    const adaptadorAds = new GoogleAdsAdapter({
      secretStore,
      esquemaEgress: ESQUEMA_EGRESS_ADS,
      secretRefs: {
        developerToken: 'env:GOOGLE_ADS_DEVELOPER_TOKEN',
        clientId: 'env:GOOGLE_ADS_CLIENT_ID',
        clientSecret: 'env:GOOGLE_ADS_CLIENT_SECRET',
        refreshToken: 'env:GOOGLE_ADS_REFRESH_TOKEN',
      },
      loginCustomerId,
    });
    const ingestaAds = new IngestaGoogleAds({ adaptador: adaptadorAds, observaciones, store, org: ORG, customerId });

    // ── Fuente: SmileFlow Growth ──────────────────────────────────────────────
    const baseUrl = process.env.SMILEFLOW_M2M_URL;
    if (!baseUrl) throw new Error('Falta SMILEFLOW_M2M_URL');
    const adaptadorGrowth = new SmileFlowGrowthAdapter({
      secretStore,
      secretRef: 'env:SMILEFLOW_GROWTH_TOKEN',
      esquemaEgress: ESQUEMA_EGRESS_GROWTH,
      baseUrl,
    });
    const ingestaGrowth = new IngestaSmileFlowGrowth({ adaptador: adaptadorGrowth, observaciones, store, org: ORG });

    // ── Scheduler autónomo ────────────────────────────────────────────────────
    const scheduler = new SchedulerIngesta({
      store,
      org: ORG,
      fuentes: [
        { provider: 'smileflow-growth', ingesta: ingestaGrowth },
        { provider: 'google-ads', ingesta: ingestaAds },
      ],
    });

    const resultado = await scheduler.correrTodo(ctx(ORG), { ahora: new Date().toISOString() });
    console.log(JSON.stringify(resultado, null, 2)); // sin secretos

    // Reconciliación CONVERGENTE de naturaleza TEST/REAL (ventana acotada). Cubre reclasificaciones en la
    // fuente (is_test false→true) POSTERIORES a la ingesta, que `registrarReal` (first-wins) no releía.
    // Idempotente y fail-closed; envuelto para NO afectar el tick de ingesta si falla.
    try {
      const desde = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(); // ventana de 30 días
      const rec = await ingestaGrowth.reconciliarDiagnostico(ctx(ORG), { ahora: new Date().toISOString(), since: desde });
      if (rec.reconciliados > 0) console.log(JSON.stringify({ reconcileGrowth: rec }, null, 2));
    } catch (e) {
      console.error('reconcile-growth falló (no afecta la ingesta):', e instanceof Error ? e.message : String(e));
    }

    // Tras ingerir, recalcular la LECTURA DEL DIRECTOR sobre datos REALES (M8→MeasurementService→M9→ResultadoCampania).
    // No debe romper el tick de ingesta: si falla, se registra pero no cambia el código de salida.
    try {
      const lectura = await new LecturaDirectorRealService(store).recalcular(ORG, new Date().toISOString());
      // G1 · Plan de acción en DRY-RUN (sin efecto externo; AUTONOMOUS_REAL apagado).
      const plan = await new PlanAccionDryRunService(store).generar(ORG, new Date().toISOString());
      // G2-A · propuesta gobernada desde datos REALES (crea intención + solicita aprobación SÓLO si hay evidencia).
      const g2a = await new G2AService(store).proponerDesdeReal(ORG, new Date().toISOString());
      console.log(JSON.stringify({ lecturaDirector: { veredicto: lectura.veredicto }, planAccion: { modo: plan.modo, propuestas: plan.totalPropuestas }, g2a }, null, 2));
    } catch (e) {
      console.error('lectura-director/plan-accion falló (no afecta la ingesta):', e instanceof Error ? e.message : String(e));
    }
    // Código de salida = observabilidad del scheduler (el launcher lo propaga a Task Scheduler):
    //   GLOBAL_OK ⇒ 0 · PARTIAL_FAILURE ⇒ 3 (una fuente/consulta falló, el resto SÍ persistió) · TOTAL_FAILURE ⇒ 2
    process.exitCode = resultado.estado === 'GLOBAL_OK' ? 0 : resultado.estado === 'PARTIAL_FAILURE' ? 3 : 2;
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1); // fallo infra (DB/env): distinto de los estados de negocio (0/2/3)
});
