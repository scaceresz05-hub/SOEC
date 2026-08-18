import { makePool, PgEventStore, runMigrations } from '@soec/event-store/pg';
import { identityMigrations } from '@soec/identity/pg';
import { metaOAuthMigrations } from './acquisition/meta-oauth-pg';
import { metaSyncMigrations } from './acquisition/meta-sync-pg';
import { accionMigrations } from './accion/accion-pg';
import { autonomiaMigrations } from './autonomia/autonomia-pg';
import { metaWriteMigrations } from './campana/meta-write-pg';
import { dataDeletionMigrations } from './acquisition/meta-data-deletion';
import { crearComposicionMetaOAuth } from './acquisition/meta-runtime';
import { iniciarMetaScheduler, INTERVALO_SCHEDULER_MS } from './acquisition/meta-scheduler';
import { ejecutarBootstrap } from '@soec/identity';
import { DeterministicIntelligenceProvider } from '@soec/intelligence';
import { buildApp } from './app';

/**
 * Arranque de la API con postura de seguridad explícita:
 *  - SOEC_AUTH_REQUIRED (default true): en producción, obligatorio.
 *  - SOEC_LEGACY_DEMO_ACCESS_ENABLED (default false): re-registra la demo sin auth SOLO en
 *    test/dev; en producción el arranque FALLA si se intenta habilitar.
 * La ausencia de sesión NUNCA es autorización.
 */
const esProduccion = (process.env.NODE_ENV ?? process.env.SOEC_ENV) === 'production';
const authRequired = (process.env.SOEC_AUTH_REQUIRED ?? 'true') === 'true';
const legacyDemoAccess = process.env.SOEC_LEGACY_DEMO_ACCESS_ENABLED === 'true';

// Orígenes permitidos para operaciones mutativas (CSRF, F-01). En producción DEBE ser una lista
// explícita; en dev se asume el front local. NUNCA se deriva del request.
const allowedOrigins = (process.env.SOEC_ALLOWED_ORIGINS ?? (esProduccion ? '' : 'http://localhost:3080,http://localhost:3000'))
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

// Rate limiting (F-06): configurable por entorno; defaults razonables para una sola instancia.
const rateLimit = {
  loginMax: Number(process.env.SOEC_RL_LOGIN_MAX ?? 5),
  ipMax: Number(process.env.SOEC_RL_IP_MAX ?? 30),
  resetMax: Number(process.env.SOEC_RL_RESET_MAX ?? 5),
  windowMin: Number(process.env.SOEC_RL_WINDOW_MIN ?? 15),
};

if (esProduccion && legacyDemoAccess) {
  console.error('FATAL: SOEC_LEGACY_DEMO_ACCESS_ENABLED=true está PROHIBIDO en producción. Arranque abortado.');
  process.exit(1);
}
if (esProduccion && !authRequired) {
  console.error('FATAL: SOEC_AUTH_REQUIRED debe ser true en producción. Arranque abortado.');
  process.exit(1);
}
if (esProduccion && allowedOrigins.length === 0) {
  console.error('FATAL: SOEC_ALLOWED_ORIGINS debe declarar al menos un origen en producción (protección CSRF). Arranque abortado.');
  process.exit(1);
}
if (legacyDemoAccess) {
  console.warn('ADVERTENCIA: acceso DEMO LEGACY habilitado (rutas /experience/* SIN autenticacion). Solo test/dev/demo. NO usar con datos u organizaciones reales.');
}

const pool = makePool();

async function main(): Promise<void> {
  await runMigrations(pool, identityMigrations); // asegura el esquema de identidad
  await runMigrations(pool, metaOAuthMigrations); // esquema de persistencia OAuth Meta (Parte 2)
  await runMigrations(pool, metaSyncMigrations); // esquema de sync read-only + observabilidad Meta
  await runMigrations(pool, accionMigrations); // Safe Action Plane (V2-A): mandatos + action ledger
  await runMigrations(pool, autonomiaMigrations); // V2-C: shadow runs (autonomía en sombra)
  await runMigrations(pool, metaWriteMigrations); // V2 pre-real: reconciliación del write path (dormante)
  await runMigrations(pool, dataDeletionMigrations); // Meta data deletion callback (App Review)
  const boot = await ejecutarBootstrap(pool);
  if (boot.ejecutado) console.log(JSON.stringify({ bootstrap: boot }));

  const app = buildApp({
    store: new PgEventStore(pool),
    intelligence: new DeterministicIntelligenceProvider(),
    pool,
    legacyDemoAccess,
    secureCookies: esProduccion,
    allowedOrigins,
    rateLimit,
  });

  const port = Number(process.env.PORT ?? 3000);
  const addr = await app.listen({ port, host: '0.0.0.0' });
  console.log(JSON.stringify({ listening: addr, authRequired, legacyDemoAccess, produccion: esProduccion, allowedOrigins }));

  // Scheduler autónomo READ-ONLY de sync Meta (freshness-aware, tenant-aware). Habilitado por defecto;
  // apagable con SOEC_META_SCHEDULER_ENABLED=false. Sólo arranca si Meta está configurado (composición != null).
  if (process.env.SOEC_META_SCHEDULER_ENABLED !== 'false') {
    const compSched = crearComposicionMetaOAuth(pool, process.env);
    if (compSched !== null) {
      iniciarMetaScheduler({ comp: compSched, scheduleRepo: compSched.scheduleRepo, ahora: () => new Date().toISOString() });
      console.log(JSON.stringify({ metaScheduler: 'started', intervaloMs: INTERVALO_SCHEDULER_MS }));
    } else {
      console.log(JSON.stringify({ metaScheduler: 'idle_no_meta_config' }));
    }
  }
}

main().catch(async (err: unknown) => {
  console.error(err);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
