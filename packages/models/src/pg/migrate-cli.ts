import { makePool, migrations as baseMigrations, runMigrations } from '@soec/event-store/pg';
import { modelMigrations } from './migrations';

/**
 * Migra la Base Técnica y luego el dominio de Modelos, en una sola secuencia
 * idempotente. Las migraciones de modelo se aportan desde este paquete; la
 * infraestructura común solo provee el mecanismo (runMigrations).
 */
const pool = makePool();
runMigrations(pool, [...baseMigrations, ...modelMigrations])
  .then(async (applied) => {
    console.log(JSON.stringify({ migrated: applied }));
    await pool.end();
    process.exit(0);
  })
  .catch(async (err: unknown) => {
    console.error(err);
    await pool.end().catch(() => undefined);
    process.exit(1);
  });
