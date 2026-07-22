import { makePool, runMigrations } from '@soec/event-store/pg';
import { migracionesHastaCapacidades } from '@soec/capacidades/pg';
import { operacionalMigrations } from '@soec/operacional/pg';
import { marketingMigrations } from '@soec/marketing/pg';
import { contenidoMigrations } from '@soec/contenido/pg';
import { canalesMigrations } from '@soec/canales/pg';
import { medicionMigrations } from '@soec/medicion/pg';
import { controlMigrations } from './migrations';

/** Migra toda la cadena (… → Medición → Control). */
const pool = makePool();
runMigrations(pool, [...migracionesHastaCapacidades, ...operacionalMigrations, ...marketingMigrations, ...contenidoMigrations, ...canalesMigrations, ...medicionMigrations, ...controlMigrations])
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
