import { makePool, runMigrations } from '@soec/event-store/pg';
import { migracionesHastaEce } from '@soec/ece/pg';
import { oiMigrations } from './migrations';

/** Migra Base Técnica + Modelos + ECE + Operaciones en una sola secuencia idempotente. */
const pool = makePool();
runMigrations(pool, [...migracionesHastaEce, ...oiMigrations])
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
