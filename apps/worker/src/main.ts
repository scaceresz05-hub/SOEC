import { makePool, PgOutbox } from '@soec/event-store/pg';
import { drainOutbox } from './index';

const pool = makePool();
const outbox = new PgOutbox(pool);

drainOutbox(outbox, async (event) => {
  // Vertical técnica: la proyección real se define en incrementos posteriores.
  console.log(JSON.stringify({ processed: event.eventId, type: event.type }));
})
  .then(async (n) => {
    console.log(JSON.stringify({ drained: n }));
    await pool.end();
    process.exit(0);
  })
  .catch(async (err: unknown) => {
    console.error(err);
    await pool.end().catch(() => undefined);
    process.exit(1);
  });
