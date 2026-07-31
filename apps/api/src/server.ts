import { makePool, PgEventStore, runMigrations } from '@soec/event-store/pg';
import { identityMigrations } from '@soec/identity/pg';
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
}

main().catch(async (err: unknown) => {
  console.error(err);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
