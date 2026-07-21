import { makePool, runMigrations } from '@soec/event-store/pg';
import { migracionesHastaOperaciones } from '@soec/operaciones/pg';
import { capMigrations } from './migrations';

/** Migra Base Técnica + Modelos + ECE + Operaciones + Capacidades, idempotente. */
const pool = makePool();
runMigrations(pool, [...migracionesHastaOperaciones, ...capMigrations])
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
