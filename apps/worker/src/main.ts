import { makePool, PgOutbox } from '@soec/event-store/pg';
import { PgProjectionStore, drenarProyecciones } from '@soec/models/pg';

/**
 * Worker de proyecciones: drena el outbox y actualiza las proyecciones actuales
 * de MED y MDM. Idempotente; no decide ni ejecuta acciones reservadas a la
 * persona (frontera del ECE, #12).
 */
const pool = makePool();
const outbox = new PgOutbox(pool);
const store = new PgProjectionStore(pool);

drenarProyecciones(outbox, store)
  .then(async (n) => {
    console.log(JSON.stringify({ proyectados: n }));
    await pool.end();
    process.exit(0);
  })
  .catch(async (err: unknown) => {
    console.error(err);
    await pool.end().catch(() => undefined);
    process.exit(1);
  });
