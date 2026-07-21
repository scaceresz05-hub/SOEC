import { makePool, migrations as baseMigrations, runMigrations } from '@soec/event-store/pg';
import { modelMigrations } from '@soec/models/pg';
import { eceMigrations } from './migrations';

/** Migra Base Técnica + Modelos + ECE en una sola secuencia idempotente. */
const pool = makePool();
runMigrations(pool, [...baseMigrations, ...modelMigrations, ...eceMigrations])
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
