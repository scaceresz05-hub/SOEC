import { makePool, runMigrations } from '@soec/event-store/pg';
import { migracionesHastaCapacidades } from '@soec/capacidades/pg';
import { operacionalMigrations } from './migrations';

/** Migra toda la cadena (Base → Modelos → ECE → Operaciones → Capacidades → Operacional). */
const pool = makePool();
runMigrations(pool, [...migracionesHastaCapacidades, ...operacionalMigrations])
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
